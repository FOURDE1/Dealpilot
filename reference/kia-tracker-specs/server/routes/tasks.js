const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/tasks — List tasks with filters
router.get('/', async (req, res) => {
  try {
    const { status, assignee_id, due_before, due_after, entity_type, entity_id, priority } = req.query;

    let query = supabase
      .from('tasks')
      .select('id, title, description, assignee_id, due_date, priority, type, status, entity_type, entity_id, recurring_interval, completed_at, created_at', { count: 'exact' })
      .is('deleted_at', null);

    if (status) query = query.eq('status', status);
    if (assignee_id) query = query.eq('assignee_id', assignee_id);
    if (priority) query = query.eq('priority', priority);
    if (entity_type && entity_id) {
      query = query.eq('entity_type', entity_type).eq('entity_id', entity_id);
    }
    if (due_before) query = query.lte('due_date', due_before);
    if (due_after) query = query.gte('due_date', due_after);

    query = query.order('due_date', { ascending: true, nullsFirst: false });

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching tasks:', error);
      return res.status(500).json({ error: 'Failed to fetch tasks' });
    }

    res.json({ data, total: count });
  } catch (err) {
    console.error('Error in GET /tasks:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/my — Current user's tasks (overdue, today, upcoming)
router.get('/my', async (req, res) => {
  try {
    const userId = req.query.user_id; // Will use req.user.id after auth integration
    if (!userId) {
      return res.json({ overdue: [], today: [], upcoming: [] });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const [overdueRes, todayRes, upcomingRes] = await Promise.all([
      supabase.from('tasks').select('*')
        .eq('assignee_id', userId).is('deleted_at', null)
        .in('status', ['pending', 'in_progress'])
        .lt('due_date', todayStart)
        .order('due_date'),
      supabase.from('tasks').select('*')
        .eq('assignee_id', userId).is('deleted_at', null)
        .in('status', ['pending', 'in_progress'])
        .gte('due_date', todayStart).lt('due_date', todayEnd)
        .order('priority'),
      supabase.from('tasks').select('*')
        .eq('assignee_id', userId).is('deleted_at', null)
        .in('status', ['pending', 'in_progress'])
        .gte('due_date', todayEnd)
        .order('due_date').limit(10),
    ]);

    res.json({
      overdue: overdueRes.data || [],
      today: todayRes.data || [],
      upcoming: upcomingRes.data || [],
    });
  } catch (err) {
    console.error('Error in GET /tasks/my:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks — Create a task
router.post('/', async (req, res) => {
  try {
    const { title, description, assignee_id, due_date, priority, type, entity_type, entity_id, recurring_interval, store_id, created_by } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title, description, assignee_id, due_date,
        priority: priority || 'medium',
        type: type || 'follow_up',
        entity_type, entity_id, recurring_interval,
        store_id, created_by,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating task:', error);
      return res.status(500).json({ error: 'Failed to create task' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /tasks:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tasks/:id — Update a task
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;

    // Auto-set completed_at when status changes to completed
    if (updates.status === 'completed' && !updates.completed_at) {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Handle recurring: create next instance when completed
    if (updates.status === 'completed' && data.recurring_interval) {
      const nextDue = calculateNextDue(data.due_date, data.recurring_interval);
      await supabase.from('tasks').insert({
        title: data.title,
        description: data.description,
        assignee_id: data.assignee_id,
        due_date: nextDue,
        priority: data.priority,
        type: data.type,
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        recurring_interval: data.recurring_interval,
        store_id: data.store_id,
        created_by: data.created_by,
      });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in PUT /tasks/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id — Soft delete
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ message: 'Task deleted', id: data.id });
  } catch (err) {
    console.error('Error in DELETE /tasks/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function calculateNextDue(currentDue, interval) {
  const date = new Date(currentDue);
  switch (interval) {
    case 'daily': date.setDate(date.getDate() + 1); break;
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'biweekly': date.setDate(date.getDate() + 14); break;
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
  }
  return date.toISOString();
}

module.exports = router;
