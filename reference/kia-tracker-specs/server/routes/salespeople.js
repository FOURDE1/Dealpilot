const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET all salespeople
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    let query = supabase.from('salespeople').select('*').order('name');
    if (active !== undefined) query = query.eq('active', active === 'true');
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single salesperson
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('salespeople')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Salesperson not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create salesperson
router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('salespeople')
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update salesperson
router.put('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('salespeople')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE (deactivate) salesperson
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('salespeople')
      .update({ active: false })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Salesperson deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
