const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET / — List all sourced units with deal info
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sourced_units')
      .select(`
        *,
        deals (
          stock_number,
          year,
          make,
          model,
          customer_name
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:dealId — Get sourced unit for specific deal
router.get('/:dealId', async (req, res) => {
  try {
    const { dealId } = req.params;

    const { data, error } = await supabase
      .from('sourced_units')
      .select('*')
      .eq('deal_id', dealId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json(data || {
      deal_id: dealId,
      seller_name: null,
      seller_location: null,
      pickup_date: null,
      picked_up_delivered: null,
      vehicle_paid: false,
      bill_of_sale_received: false,
      bill_of_sale_file_url: null,
      deposit_premium_paid: false,
      deposit_amount: null,
      payment_method: null,
      proof_of_payment_url: null,
      drivers_booked_for_pickup: false,
      pickup_driver_names: null,
      pickup_company: null,
      pickup_datetime: null,
      comes_with_safety: false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:dealId — Upsert sourced unit
router.put('/:dealId', async (req, res) => {
  try {
    const { dealId } = req.params;
    const body = { ...req.body, deal_id: dealId, updated_at: new Date().toISOString() };

    // Try update first
    const { data: updated, error: updateError } = await supabase
      .from('sourced_units')
      .update(body)
      .eq('deal_id', dealId)
      .select()
      .single();

    if (updateError && updateError.code === 'PGRST116') {
      // No existing row — insert
      const { data: inserted, error: insertError } = await supabase
        .from('sourced_units')
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
