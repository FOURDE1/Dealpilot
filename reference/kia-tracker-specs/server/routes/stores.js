const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/stores — List all stores
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, code, province, tax_rate, city, phone, email, aging_threshold_days, safety_overdue_days, funding_overdue_days, bill_of_sale_system')
      .order('name');

    if (error) {
      console.error('Error fetching stores:', error);
      return res.status(500).json({ error: 'Failed to fetch stores' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in GET /stores:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stores/:id — Get single store
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Store not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in GET /stores/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/stores/:id — Update store settings
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Don't allow updating system fields
    delete updates.id;
    delete updates.created_at;
    delete updates.updated_at;

    const { data, error } = await supabase
      .from('stores')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating store:', error);
      return res.status(500).json({ error: 'Failed to update store' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Store not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in PUT /stores/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
