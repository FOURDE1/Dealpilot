const supabaseDefault = require('../middleware/supabase');

/**
 * Auto-assign dispatch resources (chaser, plate, drivers) for a deal delivery.
 */
async function autoAssign(dealId, supabase = supabaseDefault) {
  // 1. Fetch the deal
  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, has_trade_in, tentative_delivery_date')
    .eq('id', dealId)
    .single();
  if (dealErr) throw new Error(`Deal fetch failed: ${dealErr.message}`);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  // 2. Fetch delivery checklist for booked_delivery_time
  const { data: checklists, error: clErr } = await supabase
    .from('delivery_checklists')
    .select('booked_delivery_time')
    .eq('deal_id', dealId);
  if (clErr) throw new Error(`Checklist fetch failed: ${clErr.message}`);

  const bookedTime = checklists && checklists.length > 0
    ? checklists[0].booked_delivery_time
    : deal.tentative_delivery_date;

  // 3. Determine requirements based on trade-in
  const hasTrade = deal.has_trade_in;
  const needsChaser = !hasTrade;
  const numDrivers = hasTrade ? 1 : 2;

  // 4. Find available dealer plate
  const { data: plates, error: plateErr } = await supabase
    .from('dealer_plates')
    .select('*')
    .eq('status', 'available')
    .limit(1);
  if (plateErr) throw new Error(`Plate fetch failed: ${plateErr.message}`);
  if (!plates || plates.length === 0) throw new Error('No available dealer plates');

  const selectedPlate = plates[0];

  // 5. Find available chaser if needed
  let selectedChaser = null;
  if (needsChaser) {
    const { data: chasers, error: chaserErr } = await supabase
      .from('chaser_vehicles')
      .select('*')
      .eq('status', 'available')
      .limit(1);
    if (chaserErr) throw new Error(`Chaser fetch failed: ${chaserErr.message}`);
    if (!chasers || chasers.length === 0) throw new Error('No available chaser vehicles');
    selectedChaser = chasers[0];
  }

  // 6. Conflict detection — check if plate or chaser is already assigned
  //    to another deal with an overlapping delivery time (within 4 hours)
  let conflictFlag = false;
  let conflictReason = null;

  if (bookedTime) {
    const windowMs = 4 * 60 * 60 * 1000;
    const bookedDate = new Date(bookedTime);
    const windowStart = new Date(bookedDate.getTime() - windowMs).toISOString();
    const windowEnd = new Date(bookedDate.getTime() + windowMs).toISOString();

    // Check plate conflicts
    const { data: plateConflicts } = await supabase
      .from('dispatch_assignments')
      .select('id, deal_id')
      .eq('dealer_plate_id', selectedPlate.id)
      .neq('deal_id', dealId)
      .in('status', ['assigned'])
      .gte('assigned_at', windowStart)
      .lte('assigned_at', windowEnd);

    if (plateConflicts && plateConflicts.length > 0) {
      conflictFlag = true;
      conflictReason = `Dealer plate ${selectedPlate.plate_number} is assigned to deal ${plateConflicts[0].deal_id} within 4-hour window`;
    }

    // Check chaser conflicts
    if (selectedChaser && !conflictFlag) {
      const { data: chaserConflicts } = await supabase
        .from('dispatch_assignments')
        .select('id, deal_id')
        .eq('chaser_vehicle_id', selectedChaser.id)
        .neq('deal_id', dealId)
        .in('status', ['assigned'])
        .gte('assigned_at', windowStart)
        .lte('assigned_at', windowEnd);

      if (chaserConflicts && chaserConflicts.length > 0) {
        conflictFlag = true;
        conflictReason = `Chaser ${selectedChaser.name} is assigned to deal ${chaserConflicts[0].deal_id} within 4-hour window`;
      }
    }
  }

  // 7. If no conflict, mark resources as in_use
  if (!conflictFlag) {
    await supabase
      .from('dealer_plates')
      .update({
        status: 'in_use',
        assigned_chaser_id: selectedChaser ? selectedChaser.id : null
      })
      .eq('id', selectedPlate.id);

    if (selectedChaser) {
      await supabase
        .from('chaser_vehicles')
        .update({ status: 'in_use' })
        .eq('id', selectedChaser.id);
    }
  }

  // 8 & 9. Upsert dispatch_assignment
  const assignmentData = {
    deal_id: dealId,
    chaser_vehicle_id: selectedChaser ? selectedChaser.id : null,
    dealer_plate_id: selectedPlate.id,
    num_drivers_needed: numDrivers,
    dispatch_company: 'supreme',
    has_trade_in: hasTrade,
    status: 'assigned',
    conflict_flag: conflictFlag,
    conflict_reason: conflictReason,
    assigned_at: new Date().toISOString()
  };

  const { data: assignment, error: upsertErr } = await supabase
    .from('dispatch_assignments')
    .upsert(assignmentData, { onConflict: 'deal_id' })
    .select()
    .single();
  if (upsertErr) throw new Error(`Assignment upsert failed: ${upsertErr.message}`);

  // 10. Return
  return assignment;
}

/**
 * Release resources tied to a dispatch assignment and mark it completed.
 */
async function releaseResources(assignmentId, supabase = supabaseDefault) {
  // 1. Fetch the assignment
  const { data: assignment, error: fetchErr } = await supabase
    .from('dispatch_assignments')
    .select('*')
    .eq('id', assignmentId)
    .single();
  if (fetchErr) throw new Error(`Assignment fetch failed: ${fetchErr.message}`);
  if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);

  // 2. Release chaser vehicle
  if (assignment.chaser_vehicle_id) {
    await supabase
      .from('chaser_vehicles')
      .update({ status: 'available' })
      .eq('id', assignment.chaser_vehicle_id);
  }

  // 3. Release dealer plate
  if (assignment.dealer_plate_id) {
    await supabase
      .from('dealer_plates')
      .update({ status: 'available', assigned_chaser_id: null })
      .eq('id', assignment.dealer_plate_id);
  }

  // 4. Update assignment to completed
  const { data: updated, error: updateErr } = await supabase
    .from('dispatch_assignments')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .select()
    .single();
  if (updateErr) throw new Error(`Assignment update failed: ${updateErr.message}`);

  // 5. Return updated
  return updated;
}

module.exports = { autoAssign, releaseResources };
