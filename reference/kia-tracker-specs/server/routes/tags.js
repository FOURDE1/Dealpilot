const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/tags — List all tags
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tags')
      .select('id, name, color, created_at')
      .order('name', { ascending: true });

    if (error) {
      console.error('List tags error:', error);
      return res.status(500).json({ error: 'Failed to list tags', detail: error.message });
    }
    res.json({ data: data || [] });
  } catch (err) {
    console.error('List tags exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tags — Create or upsert a tag (idempotent on name)
router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    const payload = {
      name: name.trim().slice(0, 50),
      color: color || '#3B82F6',
    };

    const { data, error } = await supabase
      .from('tags')
      .upsert(payload, { onConflict: 'name' })
      .select('id, name, color, created_at')
      .single();

    if (error) {
      console.error('Create tag error:', error);
      return res.status(500).json({ error: 'Failed to create tag', detail: error.message });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('Create tag exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tags/:id — Delete a tag (cascades to lead_tags)
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('tags')
      .delete()
      .eq('id', req.params.id);

    if (error) {
      console.error('Delete tag error:', error);
      return res.status(500).json({ error: 'Failed to delete tag', detail: error.message });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Delete tag exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
