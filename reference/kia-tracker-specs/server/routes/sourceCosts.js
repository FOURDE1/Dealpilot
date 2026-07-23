const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET / — list, filterable by ?month= and ?source=
router.get('/', async (req, res) => {
  try {
    const { month, source } = req.query;
    let query = supabase
      .from('source_costs')
      .select('*')
      .order('month', { ascending: false })
      .order('source', { ascending: true });

    if (month) query = query.eq('month', month);
    if (source) query = query.eq('source', source);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to list source costs', detail: error.message });
    res.json(data || []);
  } catch (err) {
    console.error('List source costs exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — upsert spend for source/month
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.source || !b.month) return res.status(400).json({ error: 'source and month are required' });

    const { data, error } = await supabase
      .from('source_costs')
      .upsert({
        source: b.source,
        month: b.month,
        spend: b.spend ?? 0,
        notes: b.notes || null,
        store_id: b.store_id || null,
        created_by: b.created_by || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source,month,store_id' })
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Failed to upsert source cost', detail: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error('Create source cost exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — update spend/notes
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('source_costs')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Source cost not found' });
    res.json(data);
  } catch (err) {
    console.error('Update source cost exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('source_costs')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Source cost not found' });
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Delete source cost exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
