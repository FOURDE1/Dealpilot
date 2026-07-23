const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');
const { autoAssign, releaseResources } = require('../services/dispatch');

// ============================================================
// CHASERS
// ============================================================

// GET /chasers — list all chaser vehicles
router.get('/chasers', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chaser_vehicles')
      .select('*')
      .order('name');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /chasers — create chaser vehicle
router.post('/chasers', async (req, res) => {
  try {
    const { name } = req.body;
    const { data, error } = await supabase
      .from('chaser_vehicles')
      .insert({ name, status: 'available' })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /chasers/:id — update chaser vehicle
router.put('/chasers/:id', async (req, res) => {
  try {
    const { name, status } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabase
      .from('chaser_vehicles')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /chasers/:id — delete chaser vehicle
router.delete('/chasers/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('chaser_vehicles')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Chaser vehicle deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PLATES
// ============================================================

// GET /plates — list all dealer plates
router.get('/plates', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('dealer_plates')
      .select('*')
      .order('plate_number');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /plates — create dealer plate
router.post('/plates', async (req, res) => {
  try {
    const { plate_number } = req.body;
    const { data, error } = await supabase
      .from('dealer_plates')
      .insert({ plate_number, status: 'available' })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /plates/:id — update dealer plate
router.put('/plates/:id', async (req, res) => {
  try {
    const { plate_number, status, assigned_chaser_id } = req.body;
    const updates = {};
    if (plate_number !== undefined) updates.plate_number = plate_number;
    if (status !== undefined) updates.status = status;
    if (assigned_chaser_id !== undefined) updates.assigned_chaser_id = assigned_chaser_id;

    const { data, error } = await supabase
      .from('dealer_plates')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /plates/:id — delete dealer plate
router.delete('/plates/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('dealer_plates')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Dealer plate deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ASSIGNMENTS
// ============================================================

// GET /assignments — list all with joined deal, chaser, plate data
router.get('/assignments', async (req, res) => {
  try {
    // Fetch assignments
    const { data: assignments, error: aErr } = await supabase
      .from('dispatch_assignments')
      .select('*')
      .order('created_at', { ascending: false });
    if (aErr) throw aErr;

    // Collect unique IDs for batch lookups
    const dealIds = [...new Set(assignments.map(a => a.deal_id).filter(Boolean))];
    const chaserIds = [...new Set(assignments.map(a => a.chaser_vehicle_id).filter(Boolean))];
    const plateIds = [...new Set(assignments.map(a => a.dealer_plate_id).filter(Boolean))];

    // Fetch related records in parallel
    const [dealsRes, chasersRes, platesRes] = await Promise.all([
      dealIds.length > 0
        ? supabase.from('deals').select('id, stock_number, year, make, model, customer_name, has_trade_in, tentative_delivery_date').in('id', dealIds)
        : { data: [] },
      chaserIds.length > 0
        ? supabase.from('chaser_vehicles').select('id, name').in('id', chaserIds)
        : { data: [] },
      plateIds.length > 0
        ? supabase.from('dealer_plates').select('id, plate_number').in('id', plateIds)
        : { data: [] }
    ]);

    // Build lookup maps
    const dealMap = {};
    (dealsRes.data || []).forEach(d => { dealMap[d.id] = d; });
    const chaserMap = {};
    (chasersRes.data || []).forEach(c => { chaserMap[c.id] = c; });
    const plateMap = {};
    (platesRes.data || []).forEach(p => { plateMap[p.id] = p; });

    // Merge
    const result = assignments.map(a => ({
      ...a,
      deal: dealMap[a.deal_id] || null,
      chaser_vehicle: chaserMap[a.chaser_vehicle_id] || null,
      dealer_plate: plateMap[a.dealer_plate_id] || null
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /assignments/:dealId/auto-assign — run AI auto-assignment
router.post('/assignments/:dealId/auto-assign', async (req, res) => {
  try {
    const result = await autoAssign(req.params.dealId, supabase);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /assignments/:id — manual update
router.put('/assignments/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('dispatch_assignments')
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

// POST /assignments/:id/complete — release resources and complete
router.post('/assignments/:id/complete', async (req, res) => {
  try {
    const result = await releaseResources(req.params.id, supabase);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /conflicts — list assignments with conflicts
router.get('/conflicts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('dispatch_assignments')
      .select('*')
      .eq('conflict_flag', true);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
