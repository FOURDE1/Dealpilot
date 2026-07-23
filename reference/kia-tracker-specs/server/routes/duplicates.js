const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
}

function normalizeEmail(email) {
  if (!email) return null;
  return email.toLowerCase().trim() || null;
}

function normalizeName(first, last) {
  const full = `${(first || '').toLowerCase().trim()} ${(last || '').toLowerCase().trim()}`.trim();
  return full.length > 1 ? full : null;
}

function computeMatchType(phoneMatch, emailMatch, nameMatch) {
  const parts = [];
  if (phoneMatch) parts.push('phone');
  if (emailMatch) parts.push('email');
  if (nameMatch) parts.push('name');
  return parts.join('_') || 'name';
}

function computeConfidence(phoneMatch, emailMatch, nameMatch) {
  if (phoneMatch || emailMatch) return 100;
  if (nameMatch) return 90;
  return 80;
}

async function scanLeadForDuplicates(leadId, storeId) {
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, first_name, last_name, phone, email, store_id, created_at')
    .eq('id', leadId)
    .is('deleted_at', null)
    .single();
  if (leadErr || !lead) return { found: 0, new: 0 };

  const effectiveStore = storeId || lead.store_id;
  const normPhone = normalizePhone(lead.phone);
  const normEmail = normalizeEmail(lead.email);
  const normName = normalizeName(lead.first_name, lead.last_name);

  if (!normPhone && !normEmail && !normName) return { found: 0, new: 0 };

  let query = supabase
    .from('leads')
    .select('id, first_name, last_name, phone, email, created_at')
    .is('deleted_at', null)
    .neq('id', leadId);
  if (effectiveStore) query = query.eq('store_id', effectiveStore);

  const { data: others, error: othersErr } = await query;
  if (othersErr || !others) return { found: 0, new: 0 };

  let found = 0;
  let newCount = 0;

  for (const other of others) {
    const otherPhone = normalizePhone(other.phone);
    const otherEmail = normalizeEmail(other.email);
    const otherName = normalizeName(other.first_name, other.last_name);

    const phoneMatch = normPhone && otherPhone && normPhone === otherPhone;
    const emailMatch = normEmail && otherEmail && normEmail === otherEmail;
    const nameMatch = normName && otherName && normName === otherName;

    if (!phoneMatch && !emailMatch && !nameMatch) continue;
    found++;

    const older = new Date(lead.created_at) <= new Date(other.created_at) ? lead : other;
    const newer = older.id === lead.id ? other : lead;

    const { data: existing } = await supabase
      .from('lead_duplicates')
      .select('id')
      .or(`and(lead_id.eq.${newer.id},duplicate_of.eq.${older.id}),and(lead_id.eq.${older.id},duplicate_of.eq.${newer.id})`)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const matchType = computeMatchType(phoneMatch, emailMatch, nameMatch);
    const confidence = computeConfidence(phoneMatch, emailMatch, nameMatch);

    const { error: insertErr } = await supabase
      .from('lead_duplicates')
      .insert({
        lead_id: newer.id,
        duplicate_of: older.id,
        match_type: matchType,
        confidence,
        store_id: effectiveStore || null,
      });
    if (!insertErr) newCount++;
  }

  return { found, new: newCount };
}

// GET / — list duplicate pairs with lead data
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;

    let query = supabase
      .from('lead_duplicates')
      .select('*, lead:lead_id(id, first_name, last_name, phone, email, source, status, created_at), canonical:duplicate_of(id, first_name, last_name, phone, email, source, status, created_at)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      console.error('List duplicates error:', error);
      return res.status(500).json({ error: 'Failed to list duplicates', detail: error.message });
    }
    res.json(data || []);
  } catch (err) {
    console.error('List duplicates exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /scan — scan all leads for duplicates
router.post('/scan', async (req, res) => {
  try {
    const storeId = req.body?.store_id || '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907';

    let query = supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email, store_id, created_at')
      .is('deleted_at', null);
    if (storeId) query = query.eq('store_id', storeId);

    const { data: leads, error: leadsErr } = await query;
    if (leadsErr) throw leadsErr;
    if (!leads || leads.length < 2) return res.json({ found: 0, new: 0 });

    const phoneGroups = {};
    const emailGroups = {};
    const nameGroups = {};

    for (const lead of leads) {
      const np = normalizePhone(lead.phone);
      const ne = normalizeEmail(lead.email);
      const nn = normalizeName(lead.first_name, lead.last_name);
      if (np) { if (!phoneGroups[np]) phoneGroups[np] = []; phoneGroups[np].push(lead); }
      if (ne) { if (!emailGroups[ne]) emailGroups[ne] = []; emailGroups[ne].push(lead); }
      if (nn) { if (!nameGroups[nn]) nameGroups[nn] = []; nameGroups[nn].push(lead); }
    }

    const pairs = new Map();

    function addPair(a, b, field) {
      const older = new Date(a.created_at) <= new Date(b.created_at) ? a : b;
      const newer = older.id === a.id ? b : a;
      const key = `${newer.id}:${older.id}`;
      if (!pairs.has(key)) pairs.set(key, { newer, older, phone: false, email: false, name: false });
      pairs.get(key)[field] = true;
    }

    for (const group of Object.values(phoneGroups)) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          addPair(group[i], group[j], 'phone');
        }
      }
    }
    for (const group of Object.values(emailGroups)) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          addPair(group[i], group[j], 'email');
        }
      }
    }
    for (const group of Object.values(nameGroups)) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          addPair(group[i], group[j], 'name');
        }
      }
    }

    let found = pairs.size;
    let newCount = 0;

    for (const [, pair] of pairs) {
      const { data: existing } = await supabase
        .from('lead_duplicates')
        .select('id')
        .or(`and(lead_id.eq.${pair.newer.id},duplicate_of.eq.${pair.older.id}),and(lead_id.eq.${pair.older.id},duplicate_of.eq.${pair.newer.id})`)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const matchType = computeMatchType(pair.phone, pair.email, pair.name);
      const confidence = computeConfidence(pair.phone, pair.email, pair.name);

      const { error: insertErr } = await supabase
        .from('lead_duplicates')
        .insert({
          lead_id: pair.newer.id,
          duplicate_of: pair.older.id,
          match_type: matchType,
          confidence,
          store_id: storeId || null,
        });
      if (!insertErr) newCount++;
    }

    res.json({ found, new: newCount });
  } catch (err) {
    console.error('Scan duplicates exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /scan-lead/:leadId — scan a single lead
router.post('/scan-lead/:leadId', async (req, res) => {
  try {
    const result = await scanLeadForDuplicates(req.params.leadId);
    res.json(result);
  } catch (err) {
    console.error('Scan-lead exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id/dismiss
router.patch('/:id/dismiss', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lead_duplicates')
      .update({
        status: 'dismissed',
        resolved_by: req.body?.resolved_by || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Duplicate not found' });
    res.json(data);
  } catch (err) {
    console.error('Dismiss duplicate exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /:id/merge
router.post('/:id/merge', async (req, res) => {
  try {
    const { data: dup, error: dupErr } = await supabase
      .from('lead_duplicates')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (dupErr || !dup) return res.status(404).json({ error: 'Duplicate record not found' });

    const sourceId = dup.lead_id;
    const keeperId = dup.duplicate_of;

    const [sourceRes, keeperRes] = await Promise.all([
      supabase.from('leads').select('*').eq('id', sourceId).single(),
      supabase.from('leads').select('*').eq('id', keeperId).single(),
    ]);
    if (!sourceRes.data || !keeperRes.data) return res.status(404).json({ error: 'Lead not found' });

    const source = sourceRes.data;
    const keeper = keeperRes.data;

    // Fill NULL fields on keeper from source
    const fillFields = [
      'phone','email','first_name','last_name','vehicle_interest','monthly_budget',
      'current_vehicle','employment_status','monthly_income','income_timeframe',
      'job_title','address','housing_status','monthly_housing','address_length',
      'income_threshold','preferred_language','date_of_birth','notes',
      'source_platform','source_campaign','source_url',
    ];
    const keeperUpdates = {};
    for (const field of fillFields) {
      if ((keeper[field] === null || keeper[field] === undefined || keeper[field] === '') && source[field]) {
        keeperUpdates[field] = source[field];
      }
    }
    if (Object.keys(keeperUpdates).length > 0) {
      keeperUpdates.updated_at = new Date().toISOString();
      await supabase.from('leads').update(keeperUpdates).eq('id', keeperId);
    }

    // Transfer related records
    await Promise.all([
      supabase.from('lead_communications').update({ lead_id: keeperId }).eq('lead_id', sourceId),
      supabase.from('lead_tags').update({ lead_id: keeperId }).eq('lead_id', sourceId),
      supabase.from('appointments').update({ lead_id: keeperId }).eq('lead_id', sourceId),
    ]);

    // Transfer scores — delete source, recalculate keeper later
    await supabase.from('lead_scores').delete().eq('lead_id', sourceId);

    // Mark source as lost
    await supabase.from('leads').update({
      status: 'lost',
      lost_reason: `Merged into ${keeper.first_name || ''} ${keeper.last_name || ''}`.trim(),
      lost_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', sourceId);

    // Update duplicate record
    const { data: updated, error: updateErr } = await supabase
      .from('lead_duplicates')
      .update({
        status: 'merged',
        merged_by: req.body?.merged_by || null,
        merged_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();
    if (updateErr) console.error('Failed to update duplicate record:', updateErr);

    // Also dismiss any other pending duplicates involving the source
    await supabase
      .from('lead_duplicates')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
      .eq('status', 'pending')
      .or(`lead_id.eq.${sourceId},duplicate_of.eq.${sourceId}`)
      .neq('id', req.params.id);

    // Recalculate keeper score
    try {
      const { calculateScore } = require('./scoringRules');
      const { data: freshKeeper } = await supabase.from('leads').select('*').eq('id', keeperId).single();
      if (freshKeeper) {
        const { score } = await calculateScore(freshKeeper, freshKeeper.store_id);
        await supabase.from('leads').update({ score, updated_at: new Date().toISOString() }).eq('id', keeperId);
      }
    } catch { /* scoring engine not critical */ }

    const { data: finalKeeper } = await supabase.from('leads').select('*').eq('id', keeperId).single();
    res.json({ duplicate: updated, keeper: finalKeeper });
  } catch (err) {
    console.error('Merge duplicate exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.scanLeadForDuplicates = scanLeadForDuplicates;
