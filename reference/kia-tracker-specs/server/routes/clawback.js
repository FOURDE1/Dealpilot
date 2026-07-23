const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// POST /api/clawback — Initiate commission clawback on a deal
router.post('/', async (req, res) => {
  try {
    const { deal_id, reason, initiated_by } = req.body;

    if (!deal_id || !reason) {
      return res.status(400).json({ error: 'deal_id and reason are required' });
    }

    // Get the deal and its commissions
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, salesperson_name, clawback_status, store_id')
      .eq('id', deal_id)
      .single();

    if (dealError || !deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (deal.clawback_status === 'reversed') {
      return res.status(400).json({ error: 'Deal already has a reversed clawback' });
    }

    // Get commission for this deal
    const { data: commissions } = await supabase
      .from('commissions')
      .select('id, amount, salesperson_name')
      .eq('deal_id', deal_id);

    const totalCommission = (commissions || []).reduce(
      (sum, c) => sum + (Number(c.amount) || 0), 0
    );

    // Flag the deal
    await supabase
      .from('deals')
      .update({ clawback_status: 'flagged' })
      .eq('id', deal_id);

    // Log the clawback
    const { data: logEntry, error: logError } = await supabase
      .from('clawback_log')
      .insert({
        deal_id,
        salesperson_name: deal.salesperson_name,
        original_amount: totalCommission,
        reversed_amount: totalCommission,
        reason,
        initiated_by,
        store_id: deal.store_id,
      })
      .select()
      .single();

    if (logError) {
      console.error('Error logging clawback:', logError);
      return res.status(500).json({ error: 'Failed to log clawback' });
    }

    res.status(201).json({
      message: 'Clawback initiated',
      deal_id,
      clawback_status: 'flagged',
      reversed_amount: totalCommission,
      log: logEntry,
    });
  } catch (err) {
    console.error('Error in POST /clawback:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/clawback/:deal_id/confirm — Confirm and reverse the clawback
router.put('/:deal_id/confirm', async (req, res) => {
  try {
    const { deal_id } = req.params;

    const { data: deal, error } = await supabase
      .from('deals')
      .update({ clawback_status: 'reversed' })
      .eq('id', deal_id)
      .eq('clawback_status', 'flagged')
      .select('id, clawback_status')
      .single();

    if (error || !deal) {
      return res.status(404).json({ error: 'Deal not found or not in flagged state' });
    }

    res.json({ message: 'Clawback confirmed', deal });
  } catch (err) {
    console.error('Error in PUT /clawback/:deal_id/confirm:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/clawback/log?deal_id= — Get clawback history
router.get('/log', async (req, res) => {
  try {
    const { deal_id, store_id } = req.query;

    let query = supabase
      .from('clawback_log')
      .select('*')
      .order('created_at', { ascending: false });

    if (deal_id) query = query.eq('deal_id', deal_id);
    if (store_id) query = query.eq('store_id', store_id);

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching clawback log:', error);
      return res.status(500).json({ error: 'Failed to fetch clawback log' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in GET /clawback/log:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
