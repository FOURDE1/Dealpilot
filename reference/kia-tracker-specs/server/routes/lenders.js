const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/lenders
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('lenders')
      .select('id, name, contact_name, contact_email, contact_phone, rate_sheet_url, avg_turnaround_days, active')
      .eq('active', true)
      .order('name');
    if (error) return res.status(500).json({ error: 'Failed to fetch lenders' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /lenders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/lenders
router.post('/', async (req, res) => {
  try {
    const { name, contact_name, contact_email, contact_phone, rate_sheet_url, avg_turnaround_days, store_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { data, error } = await supabase
      .from('lenders')
      .insert({ name, contact_name, contact_email, contact_phone, rate_sheet_url, avg_turnaround_days, store_id })
      .select().single();
    if (error) return res.status(500).json({ error: 'Failed to create lender' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /lenders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/lenders/submissions?deal_id=
router.get('/submissions', async (req, res) => {
  try {
    const { deal_id } = req.query;
    if (!deal_id) return res.status(400).json({ error: 'deal_id is required' });

    const { data, error } = await supabase
      .from('deal_submissions')
      .select('id, deal_id, lender_id, status, rate, term, monthly_payment, conditions, submitted_at, responded_at, funded_at, notes')
      .eq('deal_id', deal_id)
      .order('submitted_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch submissions' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /lenders/submissions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/lenders/submissions — Submit deal to lender
router.post('/submissions', async (req, res) => {
  try {
    const { deal_id, lender_id, rate, term, store_id } = req.body;
    if (!deal_id || !lender_id) return res.status(400).json({ error: 'deal_id and lender_id are required' });

    const { data, error } = await supabase
      .from('deal_submissions')
      .insert({ deal_id, lender_id, rate, term, store_id })
      .select().single();
    if (error) return res.status(500).json({ error: 'Failed to create submission' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /lenders/submissions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/lenders/submissions/:id — Update submission status
router.put('/submissions/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.status === 'approved' || updates.status === 'declined' || updates.status === 'conditional') {
      updates.responded_at = new Date().toISOString();
    }
    if (updates.status === 'funded') {
      updates.funded_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('deal_submissions')
      .update(updates)
      .eq('id', req.params.id)
      .select().single();
    if (error || !data) return res.status(404).json({ error: 'Submission not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in PUT /lenders/submissions/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
