const express = require('express');
const router = express.Router({ mergeParams: true });
const supabase = require('../middleware/supabase');

const VALID_TYPES = ['call', 'sms', 'email', 'visit', 'note'];
const VALID_DIRECTIONS = ['inbound', 'outbound'];

// GET /api/leads/:id/communications?type=call,email
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;

    let query = supabase
      .from('lead_communications')
      .select('id, lead_id, type, direction, subject, body, duration_seconds, metadata, created_by, created_at')
      .eq('lead_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(500);

    if (type) {
      const types = String(type).split(',').map(t => t.trim()).filter(Boolean);
      if (types.length > 0) query = query.in('type', types);
    }

    const { data, error } = await query;
    if (error) {
      console.error('List lead communications error:', error);
      return res.status(500).json({ error: 'Failed to list communications', detail: error.message });
    }
    res.json(data || []);
  } catch (err) {
    console.error('List lead communications exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/:id/communications
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.type || !VALID_TYPES.includes(b.type)) {
      return res.status(400).json({ error: `type is required and must be one of ${VALID_TYPES.join(', ')}` });
    }
    if (b.direction && !VALID_DIRECTIONS.includes(b.direction)) {
      return res.status(400).json({ error: `direction must be one of ${VALID_DIRECTIONS.join(', ')}` });
    }

    const row = {
      lead_id: req.params.id,
      type: b.type,
      direction: b.direction || null,
      subject: b.subject || null,
      body: b.body || null,
      duration_seconds: Number.isFinite(b.duration_seconds) ? b.duration_seconds : null,
      metadata: b.metadata && typeof b.metadata === 'object' ? b.metadata : {},
      created_by: b.created_by || null,
    };

    const { data, error } = await supabase
      .from('lead_communications')
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error('Create lead communication error:', error);
      return res.status(500).json({ error: 'Failed to create communication', detail: error.message });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('Create lead communication exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/leads/:id/communications/:commId
router.patch('/:commId', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.lead_id;
    delete updates.created_at;
    delete updates.created_by;

    if (updates.type && !VALID_TYPES.includes(updates.type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }
    if (updates.direction && !VALID_DIRECTIONS.includes(updates.direction)) {
      return res.status(400).json({ error: `direction must be one of ${VALID_DIRECTIONS.join(', ')}` });
    }

    const { data, error } = await supabase
      .from('lead_communications')
      .update(updates)
      .eq('id', req.params.commId)
      .eq('lead_id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Communication not found', detail: error?.message });
    }
    res.json(data);
  } catch (err) {
    console.error('Update lead communication exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/leads/:id/communications/:commId
router.delete('/:commId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lead_communications')
      .delete()
      .eq('id', req.params.commId)
      .eq('lead_id', req.params.id)
      .select('id')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Communication not found', detail: error?.message });
    }
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Delete lead communication exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
