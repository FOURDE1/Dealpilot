const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/automation-rules
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*')
      .order('name');
    if (error) return res.status(500).json({ error: 'Failed to fetch rules' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /automation-rules:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/automation-rules
router.post('/', async (req, res) => {
  try {
    const { store_id, name, description, trigger_event, trigger_condition, action_type, action_config, escalation_minutes, escalation_target_role, created_by } = req.body;
    if (!name || !trigger_event || !action_type) {
      return res.status(400).json({ error: 'name, trigger_event, and action_type are required' });
    }

    const { data, error } = await supabase
      .from('automation_rules')
      .insert({ store_id, name, description, trigger_event, trigger_condition, action_type, action_config, escalation_minutes, escalation_target_role, created_by })
      .select().single();
    if (error) return res.status(500).json({ error: 'Failed to create rule' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /automation-rules:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/automation-rules/:id
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    const { data, error } = await supabase
      .from('automation_rules')
      .update(updates)
      .eq('id', req.params.id)
      .select().single();
    if (error || !data) return res.status(404).json({ error: 'Rule not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in PUT /automation-rules/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/automation-rules/:id
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('automation_rules').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Failed to delete rule' });
    res.json({ message: 'Rule deleted' });
  } catch (err) {
    console.error('Error in DELETE /automation-rules/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
