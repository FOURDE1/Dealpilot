const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// Auto-calculate commission for a deal
async function calculateCommission(deal) {
  if (!deal.salesperson_name) return;

  const salePrice = Number(deal.sale_price) || 0;
  const vehicleCost = Number(deal.vehicle_cost) || 0;
  const fiReserve = Number(deal.fi_reserve) || 0;
  const grossProfit = salePrice - vehicleCost;
  const totalGross = grossProfit + fiReserve;

  if (totalGross <= 0) return;

  // Look up salesperson config
  const { data: sp } = await supabase
    .from('salespeople')
    .select('*')
    .ilike('name', deal.salesperson_name)
    .eq('active', true)
    .single();

  if (!sp) return;

  const padAmount = sp.has_pad ? (sp.pad_amount || 0) : 0;
  const grossForCommission = totalGross - padAmount;
  if (grossForCommission <= 0) return;

  // Check tiered rate
  let rate = sp.commission_rate;
  if (sp.has_tiered_rate && sp.tier_threshold && sp.tier_rate) {
    // Check monthly gross for this salesperson
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

    const { data: monthDeals } = await supabase
      .from('deals')
      .select('sale_price, vehicle_cost, fi_reserve')
      .ilike('salesperson_name', deal.salesperson_name)
      .gte('created_at', monthStart)
      .lte('created_at', monthEnd);

    if (monthDeals) {
      const monthlyGross = monthDeals.reduce((sum, d) => {
        return sum + ((Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0) + (Number(d.fi_reserve) || 0));
      }, 0);
      if (monthlyGross > sp.tier_threshold) {
        rate = sp.tier_rate;
      }
    }
  }

  const commissionAmount = grossForCommission * rate;

  // Calculate override
  let overrideSalesperson = null;
  let overrideAmount = 0;
  if (sp.override_on && sp.override_rate) {
    // Someone else gets an override on this salesperson's deals
    // Actually the override_on means THIS salesperson gets an override on override_on's deals
    // So we need to check if someone has override_on = this salesperson's name
    const { data: overriders } = await supabase
      .from('salespeople')
      .select('name, override_rate')
      .ilike('override_on', deal.salesperson_name)
      .eq('active', true);

    if (overriders && overriders.length > 0) {
      for (const o of overriders) {
        overrideSalesperson = o.name;
        overrideAmount = grossForCommission * o.override_rate;
      }
    }
  }

  // Upsert commission
  await supabase
    .from('commissions')
    .upsert(
      {
        deal_id: deal.id,
        salesperson_name: deal.salesperson_name,
        commission_rate: rate,
        pad_amount: padAmount,
        gross_for_commission: grossForCommission,
        commission_amount: commissionAmount,
        override_salesperson: overrideSalesperson,
        override_amount: overrideAmount,
      },
      { onConflict: 'deal_id' }
    );
}

// GET stats summary (MUST be before /:id route)
router.get('/stats/summary', async (req, res) => {
  try {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('deal_status, vehicle_status, finance_status, sale_type, listed_online');

    if (error) throw error;

    const stats = {
      total: deals.length,
      delivered: deals.filter(d => d.vehicle_status === 'delivered').length,
      pending: deals.filter(d => d.finance_status === 'pending').length,
      funded: deals.filter(d => d.finance_status === 'funded').length,
      retail: deals.filter(d => d.sale_type === 'retail').length,
      wholesale: deals.filter(d => d.sale_type === 'wholesale').length,
      listed_online: deals.filter(d => d.listed_online).length,
    };

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all deals (with optional filters)
router.get('/', async (req, res) => {
  try {
    const {
      salesperson, deal_status, vehicle_status, finance_status,
      sale_type, licensing_province, listed_online,
      date_from, date_to, search
    } = req.query;

    let query = supabase
      .from('deals')
      .select('*')
      .order('created_at', { ascending: false });

    if (salesperson) query = query.eq('salesperson_name', salesperson);
    if (deal_status) query = query.eq('deal_status', deal_status);
    if (vehicle_status) query = query.eq('vehicle_status', vehicle_status);
    if (finance_status) query = query.eq('finance_status', finance_status);
    if (sale_type) query = query.eq('sale_type', sale_type);
    if (licensing_province) query = query.eq('licensing_province', licensing_province);
    if (listed_online !== undefined) query = query.eq('listed_online', listed_online === 'true');
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lte('created_at', date_to);
    if (search) {
      query = query.or(
        `customer_name.ilike.%${search}%,stock_number.ilike.%${search}%,vin.ilike.%${search}%`
      );
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single deal by ID
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Deal not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-create related records when deal has delivery date or is sourced
async function ensureRelatedRecords(dealId, dealData) {
  if (dealData.tentative_delivery_date) {
    await supabase
      .from('delivery_checklists')
      .upsert({ deal_id: dealId }, { onConflict: 'deal_id', ignoreDuplicates: true });
  }
  if (dealData.is_sourced_unit) {
    await supabase
      .from('sourced_units')
      .upsert({ deal_id: dealId }, { onConflict: 'deal_id', ignoreDuplicates: true });
  }
}

// POST create new deal
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('deals')
      .insert(req.body)
      .select()
      .single();

    if (error) throw error;
    await ensureRelatedRecords(data.id, data);
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST sync deal_parties buyer → legacy deal columns
router.post('/:id/sync-customer', async (req, res) => {
  try {
    const dealId = req.params.id;
    // Find the buyer party and join to contacts
    const { data: party } = await supabase
      .from('deal_parties')
      .select('contact_id, contacts(first_name, last_name, phone, address)')
      .eq('deal_id', dealId)
      .eq('role', 'buyer')
      .maybeSingle();

    if (!party?.contacts) {
      // No buyer attached — keep last-known values, return current state
      const { data, error } = await supabase
        .from('deals')
        .select('id, customer_name, customer_phone, customer_address')
        .eq('id', dealId)
        .single();
      if (error) throw error;
      return res.json(data);
    }

    const c = party.contacts;
    const update = {
      customer_name: [c.first_name, c.last_name].filter(Boolean).join(' ') || '',
      customer_phone: c.phone || '',
      customer_address: c.address || '',
    };

    const { data, error } = await supabase
      .from('deals')
      .update(update)
      .eq('id', dealId)
      .select('id, customer_name, customer_phone, customer_address')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update deal
router.put('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('deals')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    await ensureRelatedRecords(data.id, data);

    // Auto-calculate commission when deal is funded or complete
    if (data.finance_status === 'funded' || data.deal_status === 'complete') {
      await calculateCommission(data);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE deal
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('deals')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ message: 'Deal deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
