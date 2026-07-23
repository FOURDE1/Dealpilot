const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/notifications?user_id= — Get notifications for a user
router.get('/', async (req, res) => {
  try {
    const { user_id, unread_only } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    let query = supabase
      .from('notifications')
      .select('id, type, title, body, urgency, acknowledged, acknowledged_at, entity_type, entity_id, created_at')
      .eq('target_user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (unread_only === 'true') {
      query = query.eq('acknowledged', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching notifications:', error);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in GET /notifications:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/notifications/count?user_id= — Unread count
router.get('/count', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('target_user_id', user_id)
      .eq('acknowledged', false);

    if (error) {
      console.error('Error counting notifications:', error);
      return res.status(500).json({ error: 'Failed to count notifications' });
    }

    res.json({ unread: count });
  } catch (err) {
    console.error('Error in GET /notifications/count:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/:id/acknowledge — Mark as read
router.put('/:id/acknowledge', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({
        acknowledged: true,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('id')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Acknowledged', id: data.id });
  } catch (err) {
    console.error('Error in PUT /notifications/:id/acknowledge:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/notifications/acknowledge-all?user_id= — Mark all as read
router.put('/acknowledge-all', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { error } = await supabase
      .from('notifications')
      .update({
        acknowledged: true,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('target_user_id', user_id)
      .eq('acknowledged', false);

    if (error) {
      console.error('Error acknowledging all:', error);
      return res.status(500).json({ error: 'Failed to acknowledge' });
    }

    res.json({ message: 'All notifications acknowledged' });
  } catch (err) {
    console.error('Error in PUT /notifications/acknowledge-all:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notifications — Create notification (internal use)
router.post('/', async (req, res) => {
  try {
    const { type, title, body, target_user_id, urgency, entity_type, entity_id, store_id } = req.body;

    if (!type || !title || !target_user_id) {
      return res.status(400).json({ error: 'type, title, and target_user_id are required' });
    }

    const { data, error } = await supabase
      .from('notifications')
      .insert({
        type, title, body,
        target_user_id,
        urgency: urgency || 'low',
        entity_type, entity_id, store_id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating notification:', error);
      return res.status(500).json({ error: 'Failed to create notification' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /notifications:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
