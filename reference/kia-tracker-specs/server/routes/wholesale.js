const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/wholesale
router.get('/', async (req, res) => {
  try {
    const { result } = req.query;
    let query = supabase
      .from('wholesale_listings')
      .select('id, inventory_id, store_id, auction_house, auction_date, reserve_price, final_price, result, buyer_name, profit_loss, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (result) query = query.eq('result', result);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch wholesale listings' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /wholesale:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/wholesale
router.post('/', async (req, res) => {
  try {
    const { inventory_id, store_id, auction_house, auction_date, reserve_price, buyer_name, notes } = req.body;
    if (!inventory_id) return res.status(400).json({ error: 'inventory_id is required' });

    const { data, error } = await supabase
      .from('wholesale_listings')
      .insert({ inventory_id, store_id, auction_house, auction_date, reserve_price: reserve_price || 0, buyer_name, notes })
      .select().single();
    if (error) return res.status(500).json({ error: 'Failed to create listing' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /wholesale:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/wholesale/:id
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;

    // Calculate P&L when sold
    if (updates.result === 'sold' && updates.final_price != null) {
      // Get acquisition cost from linked inventory
      const { data: listing } = await supabase.from('wholesale_listings').select('inventory_id').eq('id', req.params.id).single();
      if (listing) {
        const { data: inv } = await supabase.from('inventory').select('acquisition_cost, transport_cost, recon_cost').eq('id', listing.inventory_id).single();
        if (inv) {
          const totalInvested = (inv.acquisition_cost || 0) + (inv.transport_cost || 0) + (inv.recon_cost || 0);
          updates.profit_loss = updates.final_price - totalInvested;
        }
      }
    }

    const { data, error } = await supabase
      .from('wholesale_listings')
      .update(updates)
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select().single();
    if (error || !data) return res.status(404).json({ error: 'Listing not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in PUT /wholesale/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
