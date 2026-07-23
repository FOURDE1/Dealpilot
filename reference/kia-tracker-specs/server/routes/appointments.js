const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

const VALID_TYPES = ['test_drive', 'showroom_visit', 'follow_up', 'phone_call'];
const VALID_STATUSES = ['scheduled', 'confirmed', 'showed', 'no_show', 'rescheduled', 'cancelled'];

async function checkConflict(assignedTo, startTime, endTime, excludeId) {
  if (!assignedTo) return null;

  let query = supabase
    .from('appointments')
    .select('id, title, start_time, end_time')
    .eq('assigned_to', assignedTo)
    .in('status', ['scheduled', 'confirmed'])
    .lt('start_time', endTime)
    .gt('end_time', startTime);

  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) {
    console.error('Conflict check error:', error);
    return null;
  }
  return data && data.length > 0 ? data : null;
}

async function checkVehicleConflict(vehicleId, startTime, endTime, excludeId) {
  if (!vehicleId) return null;

  let query = supabase
    .from('appointments')
    .select('id, title, start_time, end_time, vehicle_id')
    .eq('vehicle_id', vehicleId)
    .eq('type', 'test_drive')
    .not('status', 'in', '("cancelled","no_show","rescheduled")')
    .lt('start_time', endTime)
    .gt('end_time', startTime);

  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) {
    console.error('Vehicle conflict check error:', error);
    return null;
  }
  return data && data.length > 0 ? data : null;
}

// GET /api/appointments — list with filters
router.get('/', async (req, res) => {
  try {
    const { start, end, lead_id, contact_id, deal_id, vehicle_id, assigned_to, status, type } = req.query;

    let query = supabase
      .from('appointments')
      .select('id, lead_id, contact_id, deal_id, vehicle_id, store_id, assigned_to, type, title, description, start_time, end_time, location, status, reminder_sent, created_by, created_at, updated_at, leads!left(first_name, last_name, phone), contacts!left(first_name, last_name, phone, email), users!appointments_assigned_to_fkey(name), inventory!left(stock_number, year, make, model)')
      .order('start_time', { ascending: true });

    if (start) query = query.gte('start_time', start);
    if (end) query = query.lte('start_time', end);
    if (lead_id) query = query.eq('lead_id', lead_id);
    if (contact_id) query = query.eq('contact_id', contact_id);
    if (deal_id) query = query.eq('deal_id', deal_id);
    if (vehicle_id) query = query.eq('vehicle_id', vehicle_id);
    if (assigned_to) query = query.eq('assigned_to', assigned_to);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);

    const { data, error } = await query;
    if (error) {
      console.error('List appointments error:', error);
      return res.status(500).json({ error: 'Failed to list appointments', detail: error.message });
    }
    res.json(data || []);
  } catch (err) {
    console.error('List appointments exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/appointments — create with conflict detection
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title || !b.start_time || !b.end_time || !b.type) {
      return res.status(400).json({ error: 'title, type, start_time, and end_time are required' });
    }
    if (!VALID_TYPES.includes(b.type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }
    if (new Date(b.end_time) <= new Date(b.start_time)) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }

    if (!b.force) {
      const [salespersonConflicts, vehicleConflicts] = await Promise.all([
        checkConflict(b.assigned_to, b.start_time, b.end_time),
        checkVehicleConflict(b.vehicle_id, b.start_time, b.end_time),
      ]);
      if (salespersonConflicts || vehicleConflicts) {
        const formatConflict = c => ({ id: c.id, title: c.title, start_time: c.start_time, end_time: c.end_time });
        return res.status(409).json({
          error: 'Scheduling conflict',
          salesperson_conflicts: salespersonConflicts ? salespersonConflicts.map(formatConflict) : [],
          vehicle_conflicts: vehicleConflicts ? vehicleConflicts.map(formatConflict) : [],
        });
      }
    }

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        lead_id: b.lead_id || null,
        contact_id: b.contact_id || null,
        deal_id: b.deal_id || null,
        vehicle_id: b.vehicle_id || null,
        store_id: b.store_id || null,
        assigned_to: b.assigned_to || null,
        type: b.type,
        title: b.title,
        description: b.description || null,
        start_time: b.start_time,
        end_time: b.end_time,
        location: b.location || null,
        status: 'scheduled',
        created_by: b.created_by || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Create appointment error:', error);
      return res.status(500).json({ error: 'Failed to create appointment', detail: error.message });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('Create appointment exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/appointments/:id — update / reschedule
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;
    updates.updated_at = new Date().toISOString();

    if (updates.type && !VALID_TYPES.includes(updates.type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }
    if (updates.status && !VALID_STATUSES.includes(updates.status)) {
      return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
    }

    if (updates.start_time || updates.end_time) {
      const { data: existing } = await supabase
        .from('appointments')
        .select('assigned_to, start_time, end_time, vehicle_id, type')
        .eq('id', req.params.id)
        .single();

      const newStart = updates.start_time || existing?.start_time;
      const newEnd = updates.end_time || existing?.end_time;
      const assignee = updates.assigned_to || existing?.assigned_to;
      const vehicleId = updates.vehicle_id !== undefined ? updates.vehicle_id : existing?.vehicle_id;

      if (new Date(newEnd) <= new Date(newStart)) {
        return res.status(400).json({ error: 'end_time must be after start_time' });
      }

      const [salespersonConflicts, vehicleConflicts] = await Promise.all([
        checkConflict(assignee, newStart, newEnd, req.params.id),
        checkVehicleConflict(vehicleId, newStart, newEnd, req.params.id),
      ]);
      if (salespersonConflicts || vehicleConflicts) {
        const formatConflict = c => ({ id: c.id, title: c.title, start_time: c.start_time, end_time: c.end_time });
        return res.status(409).json({
          error: 'Scheduling conflict',
          salesperson_conflicts: salespersonConflicts ? salespersonConflicts.map(formatConflict) : [],
          vehicle_conflicts: vehicleConflicts ? vehicleConflicts.map(formatConflict) : [],
        });
      }
    }

    const { data, error } = await supabase
      .from('appointments')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Appointment not found', detail: error?.message });
    }

    // P0-5: Auto-task on status change
    if (updates.status && (updates.status === 'no_show' || updates.status === 'showed')) {
      try {
        let leadId = data.lead_id;

        // If no lead_id but contact_id exists, find or create a lead from the contact
        if (!leadId && data.contact_id) {
          // Check for existing lead linked to this contact (by phone or email)
          const { data: contact } = await supabase
            .from('contacts')
            .select('first_name, last_name, phone, email')
            .eq('id', data.contact_id)
            .single();

          if (contact) {
            let existingLead = null;
            if (contact.phone) {
              const { data: phoneLead } = await supabase
                .from('leads')
                .select('id')
                .eq('phone', contact.phone)
                .is('deleted_at', null)
                .limit(1);
              if (phoneLead?.length) existingLead = phoneLead[0];
            }
            if (!existingLead && contact.email) {
              const { data: emailLead } = await supabase
                .from('leads')
                .select('id')
                .ilike('email', contact.email)
                .is('deleted_at', null)
                .limit(1);
              if (emailLead?.length) existingLead = emailLead[0];
            }

            if (existingLead) {
              leadId = existingLead.id;
            } else {
              // Auto-promote: create a lead from the contact
              const { data: newLead } = await supabase
                .from('leads')
                .insert({
                  first_name: contact.first_name,
                  last_name: contact.last_name,
                  phone: contact.phone,
                  email: contact.email,
                  source: 'appointment_promotion',
                  status: 'contacted',
                  assigned_to: data.assigned_to,
                })
                .select('id')
                .single();
              if (newLead) leadId = newLead.id;
            }

            // Link the lead back to the appointment
            if (leadId && !data.lead_id) {
              await supabase.from('appointments').update({ lead_id: leadId }).eq('id', data.id);
            }
          }
        }

        if (!leadId) {
          console.warn('Auto-task skipped: no lead_id and could not resolve one from contact');
        }

        const taskBase = {
          lead_id: leadId,
          assigned_to: data.assigned_to,
        };

        if (leadId && updates.status === 'no_show') {
          // Dedup: check by title pattern to avoid dependency on optional columns
          const { data: existing } = await supabase
            .from('lead_tasks')
            .select('id')
            .eq('lead_id', leadId)
            .ilike('title', `%Be-Back:%${data.title}%`)
            .limit(1);

          if (!existing || existing.length === 0) {
            const row = {
              ...taskBase,
              title: `Be-Back: ${data.title} (no-show)`,
              due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            };
            // Try with optional columns; fall back without them
            const { error: insertErr } = await supabase.from('lead_tasks').insert({
              ...row, source: 'appointment_no_show', appointment_id: data.id,
            });
            if (insertErr) {
              console.warn('Retrying insert without optional columns:', insertErr.message);
              await supabase.from('lead_tasks').insert(row);
            }
          }
        } else if (leadId && updates.status === 'showed' && !data.deal_id) {
          // Check if a deal was created for this appointment (via deal_id link)
          // deals table doesn't have lead_id, so we check appointment.deal_id only
          {
            const { data: existing } = await supabase
              .from('lead_tasks')
              .select('id')
              .eq('lead_id', leadId)
              .ilike('title', `%Follow up after visit%${data.title}%`)
              .limit(1);

            if (!existing || existing.length === 0) {
              const row = {
                ...taskBase,
                title: `Follow up after visit (${data.title})`,
                due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              };
              const { error: insertErr } = await supabase.from('lead_tasks').insert({
                ...row, source: 'appointment_showed_no_deal', appointment_id: data.id,
              });
              if (insertErr) {
                console.warn('Retrying insert without optional columns:', insertErr.message);
                await supabase.from('lead_tasks').insert(row);
              }
            }
          }
        }
      } catch (taskErr) {
        console.warn('Auto-task creation failed:', taskErr.message);
      }
    }

    res.json(data);
  } catch (err) {
    console.error('Update appointment exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Appointment not found', detail: error?.message });
    }
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Delete appointment exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
