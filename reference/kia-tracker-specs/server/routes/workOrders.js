const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/work-orders — List with filters
router.get('/', async (req, res) => {
  try {
    const { status, type, garage_id, inventory_id } = req.query;

    let query = supabase
      .from('work_orders')
      .select('id, store_id, inventory_id, garage_id, type, status, description, estimated_cost, actual_cost, safety_result, sent_at, completed_at, created_at', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);
    if (garage_id) query = query.eq('garage_id', garage_id);
    if (inventory_id) query = query.eq('inventory_id', inventory_id);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching work orders:', error);
      return res.status(500).json({ error: 'Failed to fetch work orders' });
    }

    res.json({ data, total: count });
  } catch (err) {
    console.error('Error in GET /work-orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/work-orders/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .select('*')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Work order not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /work-orders/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/work-orders — Create
router.post('/', async (req, res) => {
  try {
    const { store_id, inventory_id, garage_id, type, description, line_items, estimated_cost, safety_province, created_by, assigned_to } = req.body;

    if (!type || !inventory_id) {
      return res.status(400).json({ error: 'type and inventory_id are required' });
    }

    const { data, error } = await supabase
      .from('work_orders')
      .insert({
        store_id, inventory_id, garage_id, type, description,
        line_items: line_items || [],
        estimated_cost: estimated_cost || 0,
        safety_province,
        created_by, assigned_to,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating work order:', error);
      return res.status(500).json({ error: 'Failed to create work order' });
    }

    // Update inventory safety/recon status based on WO type
    if (type === 'safety_inspection') {
      await supabase.from('inventory').update({ safety_status: 'sent_to_garage', safety_sent_at: new Date().toISOString() }).eq('id', inventory_id);
    } else {
      await supabase.from('inventory').update({ recon_status: 'in_progress', location_status: 'at_garage' }).eq('id', inventory_id);
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /work-orders:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/work-orders/:id — Update
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;

    // Auto-set timestamps based on status changes
    if (updates.status === 'sent' && !updates.sent_at) updates.sent_at = new Date().toISOString();
    if (updates.status === 'received' && !updates.received_at) updates.received_at = new Date().toISOString();
    if (updates.status === 'in_progress' && !updates.started_at) updates.started_at = new Date().toISOString();
    if (updates.status === 'completed' && !updates.completed_at) updates.completed_at = new Date().toISOString();
    if (updates.status === 'invoiced' && !updates.invoiced_at) updates.invoiced_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('work_orders')
      .update(updates)
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Work order not found' });

    // Update inventory when work order completes
    if (updates.status === 'completed' && data.inventory_id) {
      if (data.type === 'safety_inspection') {
        const safetyUpdate = {
          safety_status: updates.safety_result === 'passed' ? 'passed' : 'failed',
          safety_completed_at: new Date().toISOString(),
        };
        await supabase.from('inventory').update(safetyUpdate).eq('id', data.inventory_id);
      } else {
        await supabase.from('inventory').update({ recon_status: 'complete' }).eq('id', data.inventory_id);
      }
    }

    res.json(data);
  } catch (err) {
    console.error('Error in PUT /work-orders/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/work-orders/:id — Soft delete
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('work_orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (error || !data) return res.status(404).json({ error: 'Work order not found' });
    res.json({ message: 'Work order deleted', id: data.id });
  } catch (err) {
    console.error('Error in DELETE /work-orders/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === Garages CRUD ===

// GET /api/work-orders/garages/list
router.get('/garages/list', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('garages')
      .select('id, name, email, phone, contact_name, province, services, does_ontario_safety, does_quebec_safety, is_internal, active')
      .eq('active', true)
      .order('name');

    if (error) return res.status(500).json({ error: 'Failed to fetch garages' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /garages/list:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
