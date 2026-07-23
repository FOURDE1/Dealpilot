const express = require('express');
const router = express.Router({ mergeParams: true });
const supabase = require('../middleware/supabase');

// GET /api/leads/:id/tasks
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lead_tasks')
      .select('id, lead_id, title, due_at, assigned_to, priority, completed, completed_at, notes, task_type, created_at')
      .eq('lead_id', req.params.id)
      .order('completed', { ascending: true })
      .order('due_at', { ascending: true, nullsFirst: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch tasks' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /leads/:id/tasks:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/:id/tasks
router.post('/', async (req, res) => {
  try {
    const { title, due_at, assigned_to, priority, notes, task_type, store_id, created_by } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const { data, error } = await supabase
      .from('lead_tasks')
      .insert({
        lead_id: req.params.id,
        title,
        due_at: due_at || null,
        assigned_to: assigned_to || null,
        priority: priority || 'medium',
        notes: notes || null,
        task_type: task_type || 'follow_up',
        store_id: store_id || null,
        created_by: created_by || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating lead task:', JSON.stringify(error));
      return res.status(500).json({ error: 'Failed to create task' });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /leads/:id/tasks:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/leads/:id/tasks/:taskId
router.patch('/:taskId', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.lead_id;
    delete updates.created_at;

    if (updates.completed === true && !updates.completed_at) {
      updates.completed_at = new Date().toISOString();
    }
    if (updates.completed === false) {
      updates.completed_at = null;
    }

    const { data, error } = await supabase
      .from('lead_tasks')
      .update(updates)
      .eq('id', req.params.taskId)
      .eq('lead_id', req.params.id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Task not found' });

    // Log task completion as activity
    if (updates.completed === true) {
      await supabase.from('lead_activities').insert({
        lead_id: req.params.id,
        type: 'task_completed',
        note: `Completed: ${data.title}`,
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in PATCH /leads/:id/tasks/:taskId:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
