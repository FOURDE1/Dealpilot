const express = require('express');
const router = express.Router({ mergeParams: true });
const supabase = require('../middleware/supabase');

// GET /api/leads/:id/appointments
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, lead_id, assigned_to, type, title, description, start_time, end_time, location, status, reminder_sent, created_at, users!appointments_assigned_to_fkey(name)')
      .eq('lead_id', req.params.id)
      .order('start_time', { ascending: false })
      .limit(200);

    if (error) {
      console.error('List lead appointments error:', error);
      return res.status(500).json({ error: 'Failed to list appointments', detail: error.message });
    }
    res.json(data || []);
  } catch (err) {
    console.error('List lead appointments exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
