const express = require('express');
const router = express.Router({ mergeParams: true });
const supabase = require('../middleware/supabase');

// GET /api/leads/:id/activities
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, lead_id, type, note, created_by, created_at')
      .eq('lead_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ error: 'Failed to fetch activities' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /leads/:id/activities:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/:id/activities
router.post('/', async (req, res) => {
  try {
    const { type, note, created_by, store_id } = req.body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const { data, error } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: req.params.id,
        type,
        note: note || null,
        created_by: created_by || null,
        store_id: store_id || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating lead activity:', JSON.stringify(error));
      return res.status(500).json({ error: 'Failed to create activity' });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /leads/:id/activities:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
