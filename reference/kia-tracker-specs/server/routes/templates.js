const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// Supported merge fields and how they resolve from a lead + salesperson
const MERGE_FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'vehicle_interest',
  'monthly_budget', 'current_vehicle', 'job_title', 'address',
  'preferred_language', 'salesperson_name',
];

function renderTemplate(template, lead, salesperson) {
  const values = {
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    email: lead.email || '',
    phone: lead.phone || '',
    vehicle_interest: lead.vehicle_interest || '',
    monthly_budget: lead.monthly_budget || '',
    current_vehicle: lead.current_vehicle || '',
    job_title: lead.job_title || '',
    address: lead.address || '',
    preferred_language: lead.preferred_language || 'fr',
    salesperson_name: salesperson?.name || '',
  };

  const resolve = (text) => {
    if (!text) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) =>
      values[key] !== undefined ? values[key] : match
    );
  };

  return {
    subject: resolve(template.subject),
    body: resolve(template.body),
  };
}

// GET /api/templates — list with optional ?type= and ?category= filters
router.get('/', async (req, res) => {
  try {
    const { type, category } = req.query;
    let query = supabase
      .from('message_templates')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (type) query = query.eq('type', type);
    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) {
      console.error('List templates error:', error);
      return res.status(500).json({ error: 'Failed to list templates', detail: error.message });
    }
    res.json(data || []);
  } catch (err) {
    console.error('List templates exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/templates/merge-fields — return list of supported merge fields
router.get('/merge-fields', (_req, res) => {
  res.json(MERGE_FIELDS);
});

// POST /api/templates/render — resolve merge fields for a lead
router.post('/render', async (req, res) => {
  try {
    const { template_id, lead_id } = req.body || {};
    if (!template_id || !lead_id) {
      return res.status(400).json({ error: 'template_id and lead_id are required' });
    }

    const [templateRes, leadRes] = await Promise.all([
      supabase.from('message_templates').select('*').eq('id', template_id).single(),
      supabase.from('leads').select('*').eq('id', lead_id).single(),
    ]);

    if (templateRes.error || !templateRes.data) {
      return res.status(404).json({ error: 'Template not found' });
    }
    if (leadRes.error || !leadRes.data) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    let salesperson = null;
    if (leadRes.data.assigned_to) {
      const { data: sp } = await supabase
        .from('users')
        .select('id, name')
        .eq('id', leadRes.data.assigned_to)
        .single();
      salesperson = sp;
    }

    const rendered = renderTemplate(templateRes.data, leadRes.data, salesperson);
    res.json({
      template_id,
      lead_id,
      type: templateRes.data.type,
      ...rendered,
    });
  } catch (err) {
    console.error('Render template exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/templates — create
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.type || !b.body) {
      return res.status(400).json({ error: 'name, type, and body are required' });
    }
    if (!['email', 'sms'].includes(b.type)) {
      return res.status(400).json({ error: 'type must be email or sms' });
    }

    const { data, error } = await supabase
      .from('message_templates')
      .insert({
        name: b.name,
        type: b.type,
        subject: b.subject || null,
        body: b.body,
        category: b.category || 'general',
        is_default: b.is_default || false,
        created_by: b.created_by || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Create template error:', error);
      return res.status(500).json({ error: 'Failed to create template', detail: error.message });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('Create template exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/templates/:id — update
router.patch('/:id', async (req, res) => {
  try {
    const updates = { ...(req.body || {}) };
    delete updates.id;
    delete updates.created_at;
    delete updates.created_by;
    updates.updated_at = new Date().toISOString();

    if (updates.type && !['email', 'sms'].includes(updates.type)) {
      return res.status(400).json({ error: 'type must be email or sms' });
    }

    const { data, error } = await supabase
      .from('message_templates')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Template not found', detail: error?.message });
    }
    res.json(data);
  } catch (err) {
    console.error('Update template exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/templates/:id
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Template not found', detail: error?.message });
    }
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Delete template exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
