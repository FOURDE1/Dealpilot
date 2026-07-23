const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

const CRITICAL_ITEMS = [
  { key: 'client_insurance_uploaded', label: 'Client Insurance' },
  { key: 'deal_funded', label: 'Deal Funded' },
  { key: 'safety_done', label: 'Safety Inspection' },
  { key: 'registration_done', label: 'Registration' },
];

// GET /dashboard — Delivery priority dashboard
router.get('/dashboard', async (req, res) => {
  try {
    // Fetch deals with a tentative delivery date set
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('*')
      .not('tentative_delivery_date', 'is', null)
      .order('tentative_delivery_date', { ascending: true });

    if (dealsError) throw dealsError;

    if (!deals || deals.length === 0) {
      return res.json([]);
    }

    const dealIds = deals.map(d => d.id);

    // Fetch all checklists for those deals
    const { data: checklists, error: checklistError } = await supabase
      .from('delivery_checklists')
      .select('*')
      .in('deal_id', dealIds);

    if (checklistError) throw checklistError;

    // Index checklists by deal_id
    const checklistMap = {};
    if (checklists) {
      checklists.forEach(cl => {
        checklistMap[cl.deal_id] = cl;
      });
    }

    // Merge deals with checklists and compute readiness
    const result = deals.map(deal => {
      const checklist = checklistMap[deal.id] || {};

      const missing_items = [];
      CRITICAL_ITEMS.forEach(item => {
        if (!checklist[item.key]) {
          missing_items.push(item.label);
        }
      });

      return {
        ...deal,
        checklist,
        is_ready: missing_items.length === 0,
        missing_items,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:dealId — Get checklist for specific deal
router.get('/:dealId', async (req, res) => {
  try {
    const { dealId } = req.params;

    const { data, error } = await supabase
      .from('delivery_checklists')
      .select('*')
      .eq('deal_id', dealId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json(data || {
      deal_id: dealId,
      client_insurance_uploaded: false,
      client_insurance_file_url: null,
      deal_funded: false,
      deal_funded_proof_url: null,
      safety_done: false,
      registration_done: false,
      drivers_booked: false,
      driver_names: null,
      booking_company: null,
      booked_delivery_time: null,
      chaser_car_required: false,
      chaser_car_booked: false,
      dealer_plate_required: false,
      dealer_plate_assigned: null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:dealId — Upsert checklist
router.put('/:dealId', async (req, res) => {
  try {
    const { dealId } = req.params;
    const body = { ...req.body, deal_id: dealId, updated_at: new Date().toISOString() };

    // Try update first
    const { data: updated, error: updateError } = await supabase
      .from('delivery_checklists')
      .update(body)
      .eq('deal_id', dealId)
      .select()
      .single();

    if (updateError && updateError.code === 'PGRST116') {
      // No existing row — insert
      const { data: inserted, error: insertError } = await supabase
        .from('delivery_checklists')
        .insert(body)
        .select()
        .single();

      if (insertError) throw insertError;
      return res.json(inserted);
    }

    if (updateError) throw updateError;

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
