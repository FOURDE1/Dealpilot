const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET / — list active lost reasons
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lost_reasons')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error) return res.status(500).json({ error: 'Failed to list lost reasons', detail: error.message });
    res.json(data || []);
  } catch (err) {
    console.error('List lost reasons exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create custom reason
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name is required' });

    const { data, error } = await supabase
      .from('lost_reasons')
      .insert({
        name: b.name,
        name_fr: b.name_fr || null,
        icon: b.icon || '📝',
        display_order: b.display_order || 0,
        store_id: b.store_id || null,
      })
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Failed to create lost reason', detail: error.message });
    res.status(201).json(data);
  } catch (err) {
    console.error('Create lost reason exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — update reason
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.created_at;

    const { data, error } = await supabase
      .from('lost_reasons')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Lost reason not found' });
    res.json(data);
  } catch (err) {
    console.error('Update lost reason exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — deactivate
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lost_reasons')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Lost reason not found' });
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Delete lost reason exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
