const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

const VALID_OPERATORS = ['gt','gte','lt','lte','eq','neq','contains','not_contains','exists','not_exists','in','not_in'];

const VALID_FIELDS = [
  'budget','source','status','has_trade_in','has_phone','has_email',
  'vehicle_interest','tags','assigned_to','created_days_ago',
  // Also allow direct lead columns for flexibility
  'phone','email','first_name','last_name','monthly_budget',
  'employment_status','monthly_income','address','income_threshold',
  'current_vehicle','preferred_language',
];

const NO_VALUE_OPERATORS = ['exists','not_exists'];

function validateFieldOperator(field, operator, value) {
  if (!VALID_FIELDS.includes(field)) return `field must be one of ${VALID_FIELDS.join(', ')}`;
  if (!VALID_OPERATORS.includes(operator)) return `operator must be one of ${VALID_OPERATORS.join(', ')}`;
  if (!NO_VALUE_OPERATORS.includes(operator) && (value === undefined || value === null || value === '')) {
    return 'value is required for this operator';
  }
  return null;
}

// Resolve field name → actual value from lead record
function resolveField(field, lead, tags) {
  switch (field) {
    case 'budget':           return lead.monthly_budget ?? lead.budget ?? null;
    case 'source':           return lead.source ?? null;
    case 'status':           return lead.status ?? null;
    case 'has_trade_in':     return !!(lead.current_vehicle || lead.has_trade_in);
    case 'has_phone':        return !!lead.phone;
    case 'has_email':        return !!lead.email;
    case 'vehicle_interest': return lead.vehicle_interest ?? null;
    case 'tags':             return tags; // array of strings
    case 'assigned_to':      return lead.assigned_to ?? null;
    case 'created_days_ago':
      return lead.created_at
        ? Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000)
        : null;
    default:                 return lead[field] ?? null;
  }
}

function evaluateRule(rule, fieldVal) {
  const { operator, value } = rule;
  const isArray = Array.isArray(fieldVal);
  const isBool = typeof fieldVal === 'boolean';

  // exists / not_exists — truthy check
  if (operator === 'exists') {
    if (isArray) return fieldVal.length > 0;
    if (isBool) return fieldVal;
    return fieldVal !== null && fieldVal !== undefined && fieldVal !== '';
  }
  if (operator === 'not_exists') {
    if (isArray) return fieldVal.length === 0;
    if (isBool) return !fieldVal;
    return fieldVal === null || fieldVal === undefined || fieldVal === '';
  }

  // Null/undefined after exists check means no match
  if (fieldVal === null || fieldVal === undefined) return false;

  // For boolean fields, compare against string "true"/"false"
  const strField = isBool ? String(fieldVal) : String(fieldVal);
  const numField = Number(fieldVal);
  const numValue = Number(value);
  const bothNumeric = !isNaN(numField) && !isNaN(numValue) && !isBool && !isArray;

  switch (operator) {
    case 'eq':  return strField === value;
    case 'neq': return strField !== value;
    case 'gt':  return bothNumeric && numField > numValue;
    case 'gte': return bothNumeric && numField >= numValue;
    case 'lt':  return bothNumeric && numField < numValue;
    case 'lte': return bothNumeric && numField <= numValue;
    case 'contains':
      if (isArray) return fieldVal.some(v => String(v).toLowerCase() === (value || '').toLowerCase());
      return strField.toLowerCase().includes((value || '').toLowerCase());
    case 'not_contains':
      if (isArray) return !fieldVal.some(v => String(v).toLowerCase() === (value || '').toLowerCase());
      return !strField.toLowerCase().includes((value || '').toLowerCase());
    case 'in': {
      const list = (value || '').split(',').map(s => s.trim());
      if (isArray) return fieldVal.some(v => list.includes(String(v)));
      return list.includes(strField);
    }
    case 'not_in': {
      const list = (value || '').split(',').map(s => s.trim());
      if (isArray) return !fieldVal.some(v => list.includes(String(v)));
      return !list.includes(strField);
    }
    default: return false;
  }
}

async function calculateScore(lead, storeId) {
  // Fetch active rules sorted by priority DESC
  let rulesQuery = supabase
    .from('lead_scoring_rules')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: false });

  if (storeId) {
    rulesQuery = rulesQuery.or(`store_id.eq.${storeId},store_id.is.null`);
  } else {
    rulesQuery = rulesQuery.is('store_id', null);
  }

  const { data: rules, error } = await rulesQuery;
  if (error) {
    console.error('Failed to load scoring rules:', error);
    return { score: 10, breakdown: [], error: error.message };
  }

  // Fetch lead's tags if any rule references the "tags" field
  let tags = [];
  const needsTags = (rules || []).some(r => r.field === 'tags');
  if (needsTags && lead.id) {
    const { data: tagRows } = await supabase
      .from('lead_tags')
      .select('tag:tag_id(name)')
      .eq('lead_id', lead.id);
    tags = (tagRows || []).map(r => r.tag?.name).filter(Boolean);
  }

  const BASE_SCORE = 0;
  let total = BASE_SCORE;
  const breakdown = [];

  for (const rule of (rules || [])) {
    const fieldVal = resolveField(rule.field, lead, tags);
    const matched = evaluateRule(rule, fieldVal);
    if (matched) {
      total += rule.score;
      breakdown.push({ rule_id: rule.id, rule_name: rule.name, field: rule.field, points: rule.score });
    }
  }

  const finalScore = Math.max(0, Math.min(total, 100));

  // Upsert cached score into lead_scores
  if (lead.id) {
    await supabase
      .from('lead_scores')
      .upsert(
        { lead_id: lead.id, score: finalScore, breakdown, scored_at: new Date().toISOString() },
        { onConflict: 'lead_id' }
      )
      .then(({ error: upErr }) => { if (upErr) console.error('lead_scores upsert error:', upErr); });
  }

  return { score: finalScore, breakdown };
}

// ============================================
// Routes
// ============================================

// GET / — list all rules (priority DESC, name ASC)
router.get('/', async (req, res) => {
  try {
    const { store_id, active_only } = req.query;
    let query = supabase
      .from('lead_scoring_rules')
      .select('*')
      .order('priority', { ascending: false })
      .order('name', { ascending: true });

    if (store_id) query = query.or(`store_id.eq.${store_id},store_id.is.null`);
    if (active_only === 'true') query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) {
      console.error('List scoring rules error:', error);
      return res.status(500).json({ error: 'Failed to list scoring rules', detail: error.message });
    }
    res.json(data || []);
  } catch (err) {
    console.error('List scoring rules exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /scores — list lead_scores joined with leads, ordered by score DESC
router.get('/scores', async (req, res) => {
  try {
    const { min, max } = req.query;

    let query = supabase
      .from('lead_scores')
      .select('id, lead_id, score, breakdown, scored_at, leads!inner(first_name, last_name, phone, email, status, source, vehicle_interest, assigned_to)')
      .order('score', { ascending: false });

    if (min !== undefined) query = query.gte('score', parseInt(min, 10));
    if (max !== undefined) query = query.lte('score', parseInt(max, 10));

    const { data, error } = await query;
    if (error) {
      console.error('List lead scores error:', error);
      return res.status(500).json({ error: 'Failed to list scores', detail: error.message });
    }
    res.json(data || []);
  } catch (err) {
    console.error('List lead scores exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /calculate/:leadId — score a single lead, upsert lead_scores, return result
router.post('/calculate/:leadId', async (req, res) => {
  try {
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.leadId)
      .single();
    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    const result = await calculateScore(lead, lead.store_id);

    // Also sync the score column on the leads table
    if (result.score !== lead.score) {
      await supabase
        .from('leads')
        .update({ score: result.score, updated_at: new Date().toISOString() })
        .eq('id', lead.id);
    }

    res.json({ lead_id: lead.id, ...result });
  } catch (err) {
    console.error('Calculate score exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /calculate-all — batch score every active lead, upsert all into lead_scores
router.post('/calculate-all', async (req, res) => {
  try {
    const { store_id } = req.body || {};

    let query = supabase
      .from('leads')
      .select('*')
      .is('deleted_at', null);
    if (store_id) query = query.eq('store_id', store_id);

    const { data: leads, error: leadsErr } = await query;
    if (leadsErr) throw leadsErr;

    let updated = 0;
    for (const lead of (leads || [])) {
      const { score } = await calculateScore(lead, lead.store_id);
      if (score !== lead.score) {
        const { error: upErr } = await supabase
          .from('leads')
          .update({ score, updated_at: new Date().toISOString() })
          .eq('id', lead.id);
        if (!upErr) updated++;
      }
    }

    res.json({ updated });
  } catch (err) {
    console.error('Calculate-all exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST / — create rule (validates field + operator combos)
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.field || !b.operator || b.score === undefined) {
      return res.status(400).json({ error: 'name, field, operator, and score are required' });
    }

    const valErr = validateFieldOperator(b.field, b.operator, b.value);
    if (valErr) return res.status(400).json({ error: valErr });

    const { data, error } = await supabase
      .from('lead_scoring_rules')
      .insert({
        name: b.name,
        description: b.description || null,
        field: b.field,
        operator: b.operator,
        value: b.value ?? null,
        score: b.score,
        is_active: b.is_active !== undefined ? b.is_active : true,
        priority: b.priority || 0,
        created_by: b.created_by || null,
        store_id: b.store_id || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Create scoring rule error:', error);
      return res.status(500).json({ error: 'Failed to create rule', detail: error.message });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('Create scoring rule exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id — update rule
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;
    updates.updated_at = new Date().toISOString();

    if (updates.field || updates.operator) {
      const { data: existing } = await supabase
        .from('lead_scoring_rules')
        .select('field, operator')
        .eq('id', req.params.id)
        .single();
      const field = updates.field || existing?.field;
      const operator = updates.operator || existing?.operator;
      const value = updates.value !== undefined ? updates.value : undefined;
      const valErr = validateFieldOperator(field, operator, value === undefined ? 'placeholder' : value);
      if (valErr && !valErr.includes('value is required')) {
        return res.status(400).json({ error: valErr });
      }
    }

    const { data, error } = await supabase
      .from('lead_scoring_rules')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Rule not found', detail: error?.message });
    }
    res.json(data);
  } catch (err) {
    console.error('Update scoring rule exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id — soft-delete (is_active=false) by default, hard delete with ?hard=true
router.delete('/:id', async (req, res) => {
  try {
    if (req.query.hard === 'true') {
      const { data, error } = await supabase
        .from('lead_scoring_rules')
        .delete()
        .eq('id', req.params.id)
        .select('id')
        .single();
      if (error || !data) {
        return res.status(404).json({ error: 'Rule not found', detail: error?.message });
      }
      return res.json({ success: true, id: data.id, deleted: 'hard' });
    }

    // Soft delete — set is_active = false
    const { data, error } = await supabase
      .from('lead_scoring_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Rule not found', detail: error?.message });
    }
    res.json({ success: true, id: data.id, deleted: 'soft' });
  } catch (err) {
    console.error('Delete scoring rule exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.calculateScore = calculateScore;
