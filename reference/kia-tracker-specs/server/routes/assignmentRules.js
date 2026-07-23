const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

const TERMINAL_STATUSES = ['lost', 'converted', 'closed'];

// ============================================
// Internal: assignment engine
// ============================================
async function assignLead(leadId) {
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, source, status, assigned_to')
    .eq('id', leadId)
    .single();
  if (leadErr) throw leadErr;
  if (!lead) return { message: 'Lead not found', assigned_to: null };
  if (lead.assigned_to) {
    return { message: 'Lead already assigned', assigned_to: lead.assigned_to };
  }

  const { data: rules, error: rulesErr } = await supabase
    .from('lead_assignment_rules')
    .select('*')
    .eq('active', true)
    .order('priority', { ascending: true });
  if (rulesErr) throw rulesErr;
  if (!rules || rules.length === 0) {
    return { message: 'No active assignment rules', assigned_to: null };
  }

  const matchedRule = rules.find(r => {
    const ruleSources = r.sources || [];
    return ruleSources.length === 0 || ruleSources.includes(lead.source);
  });
  if (!matchedRule) {
    return { message: 'No matching rule for this lead source', assigned_to: null };
  }

  const { data: allUsers, error: usersErr } = await supabase
    .from('users')
    .select('id, name');
  if (usersErr) throw usersErr;

  let eligibleUsers = allUsers || [];
  if (matchedRule.included_users && matchedRule.included_users.length > 0) {
    eligibleUsers = eligibleUsers.filter(u => matchedRule.included_users.includes(u.id));
  }
  if (matchedRule.excluded_users && matchedRule.excluded_users.length > 0) {
    eligibleUsers = eligibleUsers.filter(u => !matchedRule.excluded_users.includes(u.id));
  }
  if (eligibleUsers.length === 0) {
    return { message: 'No eligible users for assignment', assigned_to: null };
  }

  // Apply max_leads_per_user cap
  if (matchedRule.max_leads_per_user > 0) {
    const { data: leadCounts } = await supabase
      .from('leads')
      .select('assigned_to, status')
      .in('assigned_to', eligibleUsers.map(u => u.id));

    const counts = {};
    (leadCounts || []).forEach(l => {
      if (!TERMINAL_STATUSES.includes(l.status)) {
        counts[l.assigned_to] = (counts[l.assigned_to] || 0) + 1;
      }
    });

    eligibleUsers = eligibleUsers.filter(u => (counts[u.id] || 0) < matchedRule.max_leads_per_user);
    if (eligibleUsers.length === 0) {
      return { message: 'All users at max lead capacity', assigned_to: null };
    }
  }

  let assignedUser = null;

  if (matchedRule.strategy === 'round_robin') {
    const { data: state } = await supabase
      .from('lead_assignment_state')
      .select('*')
      .eq('rule_id', matchedRule.id)
      .maybeSingle();

    const lastIndex = state ? state.last_assigned_index : -1;
    const nextIndex = (lastIndex + 1) % eligibleUsers.length;
    assignedUser = eligibleUsers[nextIndex];

    if (state) {
      await supabase
        .from('lead_assignment_state')
        .update({ last_assigned_index: nextIndex, updated_at: new Date().toISOString() })
        .eq('id', state.id);
    } else {
      await supabase
        .from('lead_assignment_state')
        .insert({ rule_id: matchedRule.id, last_assigned_index: nextIndex });
    }
  } else if (matchedRule.strategy === 'load_balanced') {
    const { data: leadCounts } = await supabase
      .from('leads')
      .select('assigned_to, status')
      .in('assigned_to', eligibleUsers.map(u => u.id));

    const counts = {};
    eligibleUsers.forEach(u => { counts[u.id] = 0; });
    (leadCounts || []).forEach(l => {
      if (counts[l.assigned_to] !== undefined && !TERMINAL_STATUSES.includes(l.status)) {
        counts[l.assigned_to]++;
      }
    });

    assignedUser = eligibleUsers.reduce(
      (min, u) => (counts[u.id] < counts[min.id] ? u : min),
      eligibleUsers[0]
    );
  } else if (matchedRule.strategy === 'source_based') {
    const mappings = matchedRule.source_mappings || {};
    const mappedUserId = mappings[lead.source];
    if (mappedUserId) {
      assignedUser = eligibleUsers.find(u => u.id === mappedUserId);
    }
    if (!assignedUser) {
      assignedUser = eligibleUsers[0];
    }
  } else {
    assignedUser = eligibleUsers[0];
  }

  if (!assignedUser) {
    return { message: 'Could not determine user for assignment', assigned_to: null };
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('leads')
    .update({
      assigned_to: assignedUser.id,
      assigned_at: nowIso,
      status: lead.status === 'new' ? 'assigned' : lead.status,
    })
    .eq('id', leadId);
  if (updateErr) throw updateErr;

  await supabase
    .from('lead_assignment_history')
    .insert({
      lead_id: leadId,
      assigned_to: assignedUser.id,
      rule_id: matchedRule.id,
      rule_name: matchedRule.name,
      strategy: matchedRule.strategy,
      lead_source: lead.source,
    });

  return {
    success: true,
    assigned_to: assignedUser.id,
    assigned_to_name: assignedUser.name,
    rule_used: matchedRule.name,
    strategy: matchedRule.strategy,
  };
}

// ============================================
// Static routes (must precede /:id)
// ============================================

// GET /api/assignment-rules/history
router.get('/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const { data, error } = await supabase
      .from('lead_assignment_history')
      .select('*')
      .order('assigned_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching assignment history:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/assignment-rules/workload
router.get('/workload', async (req, res) => {
  try {
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, name, email');
    if (usersErr) throw usersErr;

    const { data: leads, error: leadsErr } = await supabase
      .from('leads')
      .select('assigned_to, status')
      .not('assigned_to', 'is', null);
    if (leadsErr) throw leadsErr;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentHistory, error: histErr } = await supabase
      .from('lead_assignment_history')
      .select('assigned_to')
      .gte('assigned_at', oneDayAgo);
    if (histErr) throw histErr;

    const workload = (users || []).map(user => {
      const userLeads = (leads || []).filter(l => l.assigned_to === user.id);
      const activeLeads = userLeads.filter(l => !TERMINAL_STATUSES.includes(l.status));
      const recentAssigns = (recentHistory || []).filter(h => h.assigned_to === user.id).length;
      return {
        user_id: user.id,
        user_name: user.name,
        user_email: user.email,
        total_leads: userLeads.length,
        active_leads: activeLeads.length,
        recent_assignments_24h: recentAssigns,
      };
    });

    res.json(workload);
  } catch (err) {
    console.error('Error fetching workload:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assignment-rules/assign — assign one lead
router.post('/assign', async (req, res) => {
  try {
    const { lead_id } = req.body || {};
    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });
    const result = await assignLead(lead_id);
    res.json(result);
  } catch (err) {
    console.error('Error assigning lead:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assignment-rules/auto-assign — batch assign all unassigned leads
router.post('/auto-assign', async (req, res) => {
  try {
    const { data: unassigned, error: leadsErr } = await supabase
      .from('leads')
      .select('id, source, status')
      .is('assigned_to', null)
      .neq('status', 'lost');
    if (leadsErr) throw leadsErr;

    if (!unassigned || unassigned.length === 0) {
      return res.json({ message: 'No unassigned leads', assigned: 0, results: [] });
    }

    const results = [];
    // Sequential — round-robin state must update between assignments
    for (const lead of unassigned) {
      try {
        const r = await assignLead(lead.id);
        results.push({ lead_id: lead.id, ...r });
      } catch (e) {
        results.push({ lead_id: lead.id, error: e.message });
      }
    }

    const assigned = results.filter(r => r.success).length;
    res.json({ message: `Assigned ${assigned} of ${results.length} leads`, assigned, results });
  } catch (err) {
    console.error('Error in auto-assign:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CRUD routes
// ============================================

// GET /api/assignment-rules — list all rules
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lead_assignment_rules')
      .select('*')
      .order('priority', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching assignment rules:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/assignment-rules — create
router.post('/', async (req, res) => {
  try {
    const {
      name, description, strategy, active, priority,
      sources, included_users, excluded_users,
      source_mappings, max_leads_per_user,
    } = req.body || {};

    const { data, error } = await supabase
      .from('lead_assignment_rules')
      .insert({
        name: name || 'New Rule',
        description: description || '',
        strategy: strategy || 'round_robin',
        active: active !== undefined ? active : true,
        priority: priority || 1,
        sources: sources || [],
        included_users: included_users || [],
        excluded_users: excluded_users || [],
        source_mappings: source_mappings || {},
        max_leads_per_user: max_leads_per_user || 0,
      })
      .select()
      .single();
    if (error) throw error;

    await supabase
      .from('lead_assignment_state')
      .insert({ rule_id: data.id, last_assigned_index: -1 });

    res.status(201).json(data);
  } catch (err) {
    console.error('Error creating assignment rule:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/assignment-rules/:id — update
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.created_at;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('lead_assignment_rules')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Error updating assignment rule:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/assignment-rules/:id — delete (cascades to state)
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('lead_assignment_rules')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting assignment rule:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.assignLead = assignLead;
