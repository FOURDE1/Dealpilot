const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// POST /api/bulk/deals/update-stage — Bulk change deal stage
router.post('/deals/update-stage', async (req, res) => {
  try {
    const { deal_ids, new_status } = req.body;

    if (!deal_ids || !Array.isArray(deal_ids) || deal_ids.length === 0) {
      return res.status(400).json({ error: 'deal_ids array is required' });
    }
    if (deal_ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 deals per bulk operation' });
    }
    if (!new_status) {
      return res.status(400).json({ error: 'new_status is required' });
    }

    const { data, error } = await supabase
      .from('deals')
      .update({ deal_status: new_status })
      .in('id', deal_ids)
      .is('deleted_at', null)
      .select('id, deal_status');

    if (error) {
      console.error('Error bulk updating deals:', error);
      return res.status(500).json({ error: 'Failed to update deals' });
    }

    res.json({ updated: data.length, deals: data });
  } catch (err) {
    console.error('Error in POST /bulk/deals/update-stage:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bulk/deals/reassign — Bulk reassign salesperson
router.post('/deals/reassign', async (req, res) => {
  try {
    const { deal_ids, salesperson_name } = req.body;

    if (!deal_ids || !Array.isArray(deal_ids) || deal_ids.length === 0) {
      return res.status(400).json({ error: 'deal_ids array is required' });
    }
    if (deal_ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 deals per bulk operation' });
    }
    if (!salesperson_name) {
      return res.status(400).json({ error: 'salesperson_name is required' });
    }

    const { data, error } = await supabase
      .from('deals')
      .update({ salesperson_name })
      .in('id', deal_ids)
      .is('deleted_at', null)
      .select('id, salesperson_name');

    if (error) {
      console.error('Error bulk reassigning deals:', error);
      return res.status(500).json({ error: 'Failed to reassign deals' });
    }

    res.json({ updated: data.length, deals: data });
  } catch (err) {
    console.error('Error in POST /bulk/deals/reassign:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bulk/tasks/complete — Bulk complete tasks
router.post('/tasks/complete', async (req, res) => {
  try {
    const { task_ids } = req.body;

    if (!task_ids || !Array.isArray(task_ids) || task_ids.length === 0) {
      return res.status(400).json({ error: 'task_ids array is required' });
    }
    if (task_ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 tasks per bulk operation' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .in('id', task_ids)
      .is('deleted_at', null)
      .in('status', ['pending', 'in_progress'])
      .select('id, status');

    if (error) {
      console.error('Error bulk completing tasks:', error);
      return res.status(500).json({ error: 'Failed to complete tasks' });
    }

    res.json({ completed: data.length, tasks: data });
  } catch (err) {
    console.error('Error in POST /bulk/tasks/complete:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bulk/tasks/reassign — Bulk reassign tasks
router.post('/tasks/reassign', async (req, res) => {
  try {
    const { task_ids, assignee_id } = req.body;

    if (!task_ids || !Array.isArray(task_ids) || task_ids.length === 0) {
      return res.status(400).json({ error: 'task_ids array is required' });
    }
    if (task_ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 tasks per bulk operation' });
    }
    if (!assignee_id) {
      return res.status(400).json({ error: 'assignee_id is required' });
    }

    const { data, error } = await supabase
      .from('tasks')
      .update({ assignee_id })
      .in('id', task_ids)
      .is('deleted_at', null)
      .select('id, assignee_id');

    if (error) {
      console.error('Error bulk reassigning tasks:', error);
      return res.status(500).json({ error: 'Failed to reassign tasks' });
    }

    res.json({ reassigned: data.length, tasks: data });
  } catch (err) {
    console.error('Error in POST /bulk/tasks/reassign:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
