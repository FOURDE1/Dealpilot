const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/activity-events?entity_type=deal&entity_id=:id
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_id, limit, offset } = req.query;

    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'entity_type and entity_id are required' });
    }

    let query = supabase
      .from('activity_events')
      .select('id, entity_type, entity_id, action, actor_id, old_value, new_value, metadata, created_at', { count: 'exact' })
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .order('created_at', { ascending: false });

    const pageLimit = Math.min(parseInt(limit) || 50, 100);
    const pageOffset = parseInt(offset) || 0;
    query = query.range(pageOffset, pageOffset + pageLimit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching activity events:', error);
      return res.status(500).json({ error: 'Failed to fetch activity events' });
    }

    res.json({ data, total: count });
  } catch (err) {
    console.error('Error in GET /activity-events:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
