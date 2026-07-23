const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');
const { assignLead } = require('./assignmentRules');
const { calculateScore } = require('./scoringRules');
const { scanLeadForDuplicates } = require('./duplicates');

// Valid source values (must match DB constraint)
const VALID_SOURCES = [
  'fluent_form', 'meta_lead_form', 'manual', 'chatbot', 'website',
  'walk_in', 'phone', 'web', 'referral', 'other', 'repeat',
  'instagram', 'google_ads', 'autotrader', 'cargurus', 'kijiji',
  'marketplace', 'kia_oem', 'service',
];

function mapSource(source) {
  if (VALID_SOURCES.includes(source)) return source;
  return 'manual';
}

// GET /api/leads — List with advanced filters
router.get('/', async (req, res) => {
  try {
    const {
      status, source, assigned_to, store_id, search,
      score_min, score_max, has_phone, has_email,
      created_after, created_before, tags, lost_reason_id,
      sort, order,
    } = req.query;

    const sortField = sort || 'created_at';
    const sortAsc = order === 'asc';

    let query = supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order(sortField, { ascending: sortAsc });

    // Status: comma-separated list
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) query = query.eq('status', statuses[0]);
      else if (statuses.length > 1) query = query.in('status', statuses);
    }

    // Source: comma-separated list
    if (source) {
      const sources = source.split(',').map(s => s.trim()).filter(Boolean);
      if (sources.length === 1) query = query.eq('source', sources[0]);
      else if (sources.length > 1) query = query.in('source', sources);
    }

    if (assigned_to) query = query.eq('assigned_to', assigned_to);
    if (store_id) query = query.eq('store_id', store_id);
    if (search) query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);

    // Score range
    if (score_min) query = query.gte('score', parseInt(score_min, 10));
    if (score_max) query = query.lte('score', parseInt(score_max, 10));

    // Has phone / has email
    if (has_phone === 'true') query = query.not('phone', 'is', null).neq('phone', '');
    if (has_phone === 'false') query = query.is('phone', null);
    if (has_email === 'true') query = query.not('email', 'is', null).neq('email', '');
    if (has_email === 'false') query = query.is('email', null);

    // Date range
    if (created_after) query = query.gte('created_at', created_after);
    if (created_before) query = query.lte('created_at', created_before);

    // Lost reason
    if (lost_reason_id) query = query.eq('lost_reason_id', lost_reason_id);

    const { data, error, count } = await query;
    if (error) {
      console.error('GET /leads Supabase error:', error);
      return res.status(500).json({ error: 'Failed to fetch leads', detail: error.message });
    }

    // Tag filtering: done post-query since it requires a join through lead_tags
    let filtered = data || [];
    if (tags) {
      const tagNames = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (tagNames.length > 0) {
        const leadIds = filtered.map(l => l.id);
        const { data: tagRows } = await supabase
          .from('lead_tags')
          .select('lead_id, tag:tag_id(name)')
          .in('lead_id', leadIds);

        const leadTagMap = {};
        for (const row of (tagRows || [])) {
          if (!leadTagMap[row.lead_id]) leadTagMap[row.lead_id] = [];
          if (row.tag?.name) leadTagMap[row.lead_id].push(row.tag.name.toLowerCase());
        }

        filtered = filtered.filter(l => {
          const lt = leadTagMap[l.id] || [];
          return tagNames.some(tn => lt.includes(tn));
        });
      }
    }

    res.json({ data: filtered, total: tags ? filtered.length : count });
  } catch (err) {
    console.error('Error in GET /leads:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== Lead-scoped tag routes (must precede GET /:id) =====

// GET /api/leads/:id/tags — List tags for a lead
router.get('/:id/tags', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lead_tags')
      .select('tag:tag_id(id, name, color)')
      .eq('lead_id', req.params.id);

    if (error) {
      console.error('List lead tags error:', error);
      return res.status(500).json({ error: 'Failed to list lead tags', detail: error.message });
    }
    const tags = (data || []).map(row => row.tag).filter(Boolean);
    tags.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: tags });
  } catch (err) {
    console.error('List lead tags exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/leads/:id/tags — Replace all tags for a lead
router.put('/:id/tags', async (req, res) => {
  try {
    const { tag_ids } = req.body || {};
    if (!Array.isArray(tag_ids)) {
      return res.status(400).json({ error: 'tag_ids array is required' });
    }

    const { error: deleteError } = await supabase
      .from('lead_tags')
      .delete()
      .eq('lead_id', req.params.id);
    if (deleteError) {
      console.error('Replace tags delete error:', deleteError);
      return res.status(500).json({ error: 'Failed to replace lead tags', detail: deleteError.message });
    }

    if (tag_ids.length > 0) {
      const rows = tag_ids.map(tagId => ({ lead_id: req.params.id, tag_id: tagId }));
      const { error: insertError } = await supabase
        .from('lead_tags')
        .insert(rows);
      if (insertError) {
        console.error('Replace tags insert error:', insertError);
        return res.status(500).json({ error: 'Failed to replace lead tags', detail: insertError.message });
      }
    }

    const { data, error: selectError } = await supabase
      .from('lead_tags')
      .select('tag:tag_id(id, name, color)')
      .eq('lead_id', req.params.id);
    if (selectError) {
      console.error('Replace tags select error:', selectError);
      return res.status(500).json({ error: 'Failed to load updated lead tags', detail: selectError.message });
    }
    const tags = (data || []).map(row => row.tag).filter(Boolean);
    tags.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ data: tags });
  } catch (err) {
    console.error('Replace lead tags exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/:id/tags — Add a single tag to a lead
router.post('/:id/tags', async (req, res) => {
  try {
    const { tag_id } = req.body || {};
    if (!tag_id) {
      return res.status(400).json({ error: 'tag_id is required' });
    }

    const { error: insertError } = await supabase
      .from('lead_tags')
      .upsert({ lead_id: req.params.id, tag_id }, { onConflict: 'lead_id,tag_id' });
    if (insertError) {
      console.error('Add lead tag error:', insertError);
      return res.status(500).json({ error: 'Failed to add lead tag', detail: insertError.message });
    }

    const { data, error: selectError } = await supabase
      .from('lead_tags')
      .select('tag:tag_id(id, name, color)')
      .eq('lead_id', req.params.id);
    if (selectError) {
      return res.status(500).json({ error: 'Failed to load lead tags', detail: selectError.message });
    }
    const tags = (data || []).map(row => row.tag).filter(Boolean);
    tags.sort((a, b) => a.name.localeCompare(b.name));
    res.status(201).json({ data: tags });
  } catch (err) {
    console.error('Add lead tag exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/leads/:id/tags/:tagId — Remove a single tag from a lead
router.delete('/:id/tags/:tagId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('lead_tags')
      .delete()
      .eq('lead_id', req.params.id)
      .eq('tag_id', req.params.tagId);
    if (error) {
      console.error('Remove lead tag error:', error);
      return res.status(500).json({ error: 'Failed to remove lead tag', detail: error.message });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Remove lead tag exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/leads/:id
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Lead not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /leads/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads — Create (manual entry or webhook)
router.post('/', async (req, res) => {
  try {
    const b = req.body;

    if (!b.phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    // Build insert object with only valid columns
    const leadData = {
      first_name: b.first_name || null,
      last_name: b.last_name || null,
      email: b.email || null,
      phone: b.phone,
      source: mapSource(b.source),
      source_platform: b.source_platform || null,
      source_campaign: b.source_campaign || null,
      source_url: b.source_url || null,
      source_form_data: b.source_form_data || null,
      vehicle_interest: b.vehicle_interest || null,
      monthly_budget: b.monthly_budget || null,
      current_vehicle: b.current_vehicle || null,
      has_trade_in: !!(b.has_trade_in || b.trade_in_make || b.current_vehicle),
      trade_in_year: b.trade_in_year || null,
      trade_in_make: b.trade_in_make || null,
      trade_in_model: b.trade_in_model || null,
      trade_in_trim: b.trade_in_trim || null,
      trade_in_mileage: b.trade_in_mileage || null,
      trade_in_condition: b.trade_in_condition || null,
      trade_in_value: b.trade_in_value || null,
      trade_in_vin: b.trade_in_vin || null,
      trade_in_color: b.trade_in_color || null,
      trade_in_notes: b.trade_in_notes || null,
      employment_status: b.employment_status || null,
      monthly_income: b.monthly_income || null,
      income_timeframe: b.income_timeframe || null,
      job_title: b.job_title || null,
      address: b.address || null,
      housing_status: b.housing_status || null,
      monthly_housing: b.monthly_housing || null,
      address_length: b.address_length || null,
      income_threshold: b.income_threshold || null,
      preferred_language: b.preferred_language || 'fr',
      date_of_birth: b.date_of_birth || null,
      notes: b.notes || null,
      assigned_to: null, // Will be set when a real user (from auth) is assigned
      store_id: b.store_id || null,
      status: 'new',
    };

    // Default store_id to first store if not provided
    if (!leadData.store_id) {
      const { data: defaultStore } = await supabase
        .from('stores')
        .select('id')
        .limit(1)
        .single();
      leadData.store_id = defaultStore?.id || null;
    }

    // Duplicate detection by phone
    const normalizedPhone = leadData.phone.replace(/[^0-9]/g, '');
    if (normalizedPhone.length >= 7) {
      const { data: existing } = await supabase
        .from('leads')
        .select('id, first_name, last_name, phone, status')
        .is('deleted_at', null)
        .ilike('phone', `%${normalizedPhone.slice(-7)}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        leadData.is_duplicate = true;
        leadData.duplicate_of = existing[0].id;
      }
    }

    // Score the lead using configurable rules engine
    try {
      const { score } = await calculateScore(leadData, leadData.store_id);
      leadData.score = score;
    } catch { leadData.score = 10; }

    const { data, error } = await supabase
      .from('leads')
      .insert(leadData)
      .select()
      .single();

    if (error) {
      console.error('Error creating lead:', JSON.stringify(error, null, 2));
      console.error('Lead data attempted:', JSON.stringify(leadData, null, 2));
      return res.status(500).json({ error: 'Failed to create lead', detail: error.message, code: error.code });
    }

    // Auto-assign via active assignment rules. Failures here must not block creation.
    let assignment = null;
    try {
      assignment = await assignLead(data.id);
      if (assignment && assignment.assigned_to) {
        const { data: refreshed } = await supabase
          .from('leads')
          .select('*')
          .eq('id', data.id)
          .single();
        if (refreshed) Object.assign(data, refreshed);
      }
    } catch (assignErr) {
      console.error('Auto-assign failed for lead', data.id, assignErr);
    }

    // Fire-and-forget duplicate scan
    scanLeadForDuplicates(data.id).catch(e => console.error('Duplicate scan failed for lead', data.id, e));

    res.status(201).json({ ...data, assignment });
  } catch (err) {
    console.error('Error in POST /leads:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/webhook/fluent — Fluent Forms webhook
router.post('/webhook/fluent', async (req, res) => {
  try {
    const form = req.body;
    const nameParts = (form.full_name || form.name || '').split(' ');

    const leadData = {
      source: 'fluent_form',
      source_platform: 'google',
      source_form_data: form,
      first_name: nameParts[0] || '',
      last_name: nameParts.slice(1).join(' ') || '',
      email: form.email,
      phone: form.phone || form.mobile,
      vehicle_interest: form.vehicle_type,
      monthly_budget: form.monthly_budget,
      current_vehicle: form.current_vehicle,
      employment_status: form.employment_status,
      monthly_income: form.monthly_income ? Math.round(parseFloat(form.monthly_income) * 100) : null,
      income_timeframe: form.income_timeframe,
      job_title: form.job_title,
      address: form.address,
      housing_status: form.housing_status,
      monthly_housing: form.monthly_housing ? Math.round(parseFloat(form.monthly_housing) * 100) : null,
      address_length: form.address_length,
      date_of_birth: form.date_of_birth || null,
    };

    try { const { score } = await calculateScore(leadData, leadData.store_id); leadData.score = score; } catch { leadData.score = 10; }

    const { data, error } = await supabase.from('leads').insert(leadData).select().single();
    if (error) return res.status(500).json({ error: 'Failed to create lead from webhook' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /leads/webhook/fluent:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/leads/webhook/meta — Meta Lead Form webhook
router.post('/webhook/meta', async (req, res) => {
  try {
    const form = req.body;
    const nameParts = (form.full_name || form.name || '').split(' ');

    const leadData = {
      source: 'meta_lead_form',
      source_platform: 'meta',
      source_form_data: form,
      first_name: nameParts[0] || '',
      last_name: nameParts.slice(1).join(' ') || '',
      email: form.email,
      phone: form.phone,
      vehicle_interest: form.vehicle_type || form.vehicle_interest,
      monthly_budget: form.monthly_budget,
      income_threshold: form.income_threshold === 'Yes' || form.income_threshold === true,
    };

    try { const { score } = await calculateScore(leadData, leadData.store_id); leadData.score = score; } catch { leadData.score = 10; }

    const { data, error } = await supabase.from('leads').insert(leadData).select().single();
    if (error) return res.status(500).json({ error: 'Failed to create lead from webhook' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /leads/webhook/meta:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/leads/:id — Update
// PATCH /api/leads/bulk — Bulk update (must precede /:id routes)
router.patch('/bulk', async (req, res) => {
  try {
    const { lead_ids, updates } = req.body || {};

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      return res.status(400).json({ error: 'lead_ids array is required' });
    }
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'updates object is required' });
    }

    const allowedFields = ['status', 'assigned_to', 'lost_reason'];
    const filtered = {};
    for (const key of allowedFields) {
      if (key in updates) filtered[key] = updates[key];
    }
    if (Object.keys(filtered).length === 0) {
      return res.status(400).json({ error: 'No valid update fields provided' });
    }

    const nowIso = new Date().toISOString();

    // Mirror single-record auto-timestamp logic
    if (filtered.status === 'assigned' && !filtered.assigned_at) filtered.assigned_at = nowIso;
    if (filtered.status === 'contacted' && !filtered.first_contacted_at) filtered.first_contacted_at = nowIso;
    if (filtered.status === 'converted' && !filtered.converted_at) filtered.converted_at = nowIso;
    if (filtered.status === 'lost' && !filtered.lost_at) filtered.lost_at = nowIso;
    if (filtered.status === 'nurture' && !filtered.nurture_started_at) {
      filtered.nurture_started_at = nowIso;
      filtered.nurture_drip_status = 'active';
      filtered.nurture_expires_at = new Date(Date.now() + 90 * 86400000).toISOString();
    }

    filtered.updated_at = nowIso;

    const { data, error } = await supabase
      .from('leads')
      .update(filtered)
      .in('id', lead_ids)
      .is('deleted_at', null)
      .select('id, status, assigned_to');

    if (error) {
      console.error('Bulk update Supabase error:', error);
      return res.status(500).json({ error: 'Failed to bulk update leads', detail: error.message });
    }

    res.json({ updated: data?.length || 0, leads: data || [] });
  } catch (err) {
    console.error('Bulk update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/leads/bulk — Bulk soft delete (must precede /:id routes)
router.delete('/bulk', async (req, res) => {
  try {
    const { lead_ids } = req.body || {};

    if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
      return res.status(400).json({ error: 'lead_ids array is required' });
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('leads')
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .in('id', lead_ids)
      .is('deleted_at', null)
      .select('id');

    if (error) {
      console.error('Bulk delete Supabase error:', error);
      return res.status(500).json({ error: 'Failed to bulk delete leads', detail: error.message });
    }

    res.json({ deleted: data?.length || 0 });
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const updateLeadHandler = async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.created_at;

    // Auto-timestamps
    if (updates.status === 'assigned' && !updates.assigned_at) updates.assigned_at = new Date().toISOString();
    if (updates.status === 'contacted' && !updates.first_contacted_at) updates.first_contacted_at = new Date().toISOString();
    if (updates.status === 'converted' && !updates.converted_at) updates.converted_at = new Date().toISOString();
    if (updates.status === 'nurture' && !updates.nurture_started_at) {
      updates.nurture_started_at = new Date().toISOString();
      updates.nurture_drip_status = 'active';
      updates.nurture_expires_at = new Date(Date.now() + 90 * 86400000).toISOString();
    }

    // Lost reason enforcement
    if (updates.status === 'lost') {
      if (!updates.lost_reason_id) {
        return res.status(400).json({ error: 'lost_reason_id is required when marking a lead as lost' });
      }
      if (!updates.lost_at) updates.lost_at = new Date().toISOString();
    }

    // Clearing lost fields when un-losing a lead
    if (updates.status && updates.status !== 'lost') {
      const { data: current } = await supabase
        .from('leads')
        .select('status')
        .eq('id', req.params.id)
        .single();
      if (current && current.status === 'lost') {
        updates.lost_reason_id = null;
        updates.lost_reason_note = null;
        updates.lost_at = null;
      }
    }

    const { data, error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: 'Lead not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in update /leads/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

router.put('/:id', updateLeadHandler);
router.patch('/:id', updateLeadHandler);

// POST /api/leads/:id/convert — Convert lead to deal
router.post('/:id/convert', async (req, res) => {
  try {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (leadError || !lead) return res.status(404).json({ error: 'Lead not found' });

    // Create or find contact
    let contactId = lead.contact_id;
    if (!contactId) {
      const { data: contact } = await supabase
        .from('contacts')
        .insert({
          first_name: lead.first_name,
          last_name: lead.last_name,
          email: lead.email,
          phone: lead.phone,
          preferred_language: lead.preferred_language,
          address: lead.address,
          employer: lead.job_title,
          source: 'web',
        })
        .select()
        .single();
      if (contact) contactId = contact.id;
    }

    // Create deal
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        customer_name: `${lead.first_name} ${lead.last_name}`.trim(),
        customer_phone: lead.phone,
        contact_id: contactId,
        store_id: lead.store_id,
        pipeline_stage: 'new',
        funding_status: 'not_submitted',
      })
      .select()
      .single();

    if (dealError) return res.status(500).json({ error: 'Failed to create deal' });

    // Update lead
    await supabase
      .from('leads')
      .update({
        status: 'converted',
        converted_deal_id: deal.id,
        converted_at: new Date().toISOString(),
        contact_id: contactId,
      })
      .eq('id', req.params.id);

    res.json({ lead_id: req.params.id, deal_id: deal.id, contact_id: contactId });
  } catch (err) {
    console.error('Error in POST /leads/:id/convert:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/leads/:id — Soft delete
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select('id')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Lead not found' });
    res.json({ message: 'Lead deleted', id: data.id });
  } catch (err) {
    console.error('Error in DELETE /leads/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
