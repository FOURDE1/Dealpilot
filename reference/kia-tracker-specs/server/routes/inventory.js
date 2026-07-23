const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

const INVENTORY_COLUMNS = 'id, store_id, vin, stock_number, year, make, model, trim, exterior_color, mileage, vehicle_type, acquisition_type, acquisition_date, acquisition_cost, transport_cost, recon_cost, list_price, location_status, safety_status, recon_status, photo_count, photo_complete, deal_status, days_on_lot, lot_arrival_date, created_at';

// GET /api/inventory — List inventory with filters
router.get('/', async (req, res) => {
  try {
    const { location_status, deal_status, safety_status, recon_status, search, sort_by, sort_dir } = req.query;

    let query = supabase
      .from('inventory')
      .select(INVENTORY_COLUMNS, { count: 'exact' })
      .is('deleted_at', null);

    if (location_status) query = query.eq('location_status', location_status);
    if (deal_status) query = query.eq('deal_status', deal_status);
    if (safety_status) query = query.eq('safety_status', safety_status);
    if (recon_status) query = query.eq('recon_status', recon_status);

    if (search) {
      query = query.or(`stock_number.ilike.%${search}%,vin.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%`);
    }

    const sortColumn = sort_by || 'created_at';
    const sortAsc = sort_dir === 'asc';
    query = query.order(sortColumn, { ascending: sortAsc });

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching inventory:', error);
      return res.status(500).json({ error: 'Failed to fetch inventory' });
    }

    res.json({ data, total: count });
  } catch (err) {
    console.error('Error in GET /inventory:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/:id — Single vehicle detail
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .select('*')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // Get photos
    const { data: photos } = await supabase
      .from('vehicle_photos')
      .select('id, angle_type, storage_path, file_name, created_at')
      .eq('inventory_id', req.params.id)
      .order('created_at');

    res.json({ ...data, photos: photos || [] });
  } catch (err) {
    console.error('Error in GET /inventory/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory — Add vehicle to inventory
router.post('/', async (req, res) => {
  try {
    const {
      store_id, vin, stock_number, year, make, model, trim,
      body_type, engine, drive_type, fuel_type, doors,
      exterior_color, interior_color, mileage, country_of_origin,
      vehicle_type, acquisition_type, acquisition_date,
      acquisition_cost, transport_cost, list_price,
      location_status, location_details, safety_province,
    } = req.body;

    if (!stock_number || !year || !make || !model || !acquisition_type) {
      return res.status(400).json({ error: 'stock_number, year, make, model, and acquisition_type are required' });
    }

    // Default store_id to the first store if not provided
    let resolvedStoreId = store_id;
    if (!resolvedStoreId) {
      const { data: defaultStore } = await supabase
        .from('stores')
        .select('id')
        .limit(1)
        .single();
      resolvedStoreId = defaultStore?.id || null;
    }

    const { data, error } = await supabase
      .from('inventory')
      .insert({
        store_id: resolvedStoreId, vin, stock_number, year, make, model, trim,
        body_type, engine, drive_type, fuel_type, doors,
        exterior_color, interior_color, mileage, country_of_origin,
        vehicle_type: vehicle_type || 'used',
        acquisition_type,
        acquisition_date: acquisition_date || new Date().toISOString().split('T')[0],
        acquisition_cost: acquisition_cost || 0,
        transport_cost: transport_cost || 0,
        list_price,
        location_status: location_status || 'on_lot',
        location_details,
        safety_province,
        lot_arrival_date: location_status === 'on_lot' ? new Date().toISOString().split('T')[0] : null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating inventory:', error);
      return res.status(500).json({ error: 'Failed to create inventory record' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /inventory:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory/:id — Update vehicle
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;
    delete updates.updated_at;
    delete updates.deleted_at;

    const { data, error } = await supabase
      .from('inventory')
      .update(updates)
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in PUT /inventory/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/inventory/:id — Soft delete
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json({ message: 'Vehicle removed', id: data.id });
  } catch (err) {
    console.error('Error in DELETE /inventory/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
