const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET / — list user's filters + shared
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('saved_filters')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });
    if (error) return res.status(500).json({ error: 'Failed to list filters', detail: error.message });
    res.json(data || []);
  } catch (err) {
    console.error('List saved filters exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.filters) return res.status(400).json({ error: 'name and filters are required' });

    const { data, error } = await supabase
      .from('saved_filters')
      .insert({
        name: b.name,
        filters: b.filters,
        is_default: b.is_default || false,
        is_shared: b.is_shared || false,
        created_by: b.created_by || null,
        store_id: b.store_id || null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Failed to create filter', detail: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error('Create saved filter exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — update
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('saved_filters')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Filter not found' });
    res.json(data);
  } catch (err) {
    console.error('Update saved filter exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('saved_filters')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Filter not found' });
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Delete saved filter exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/set-default — set as default, unset previous
router.post('/:id/set-default', async (req, res) => {
  try {
    const { data: filter } = await supabase
      .from('saved_filters')
      .select('created_by')
      .eq('id', req.params.id)
      .single();
    if (!filter) return res.status(404).json({ error: 'Filter not found' });

    await supabase
      .from('saved_filters')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('created_by', filter.created_by)
      .eq('is_default', true);

    const { data, error } = await supabase
      .from('saved_filters')
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Failed to set default', detail: error.message });
    res.json(data);
  } catch (err) {
    console.error('Set default filter exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
