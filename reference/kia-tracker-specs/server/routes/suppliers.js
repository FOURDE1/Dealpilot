const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();

const ALLOWED = [
  'name','category','contact_name','phone','email','address','tax_number',
  'payment_terms','notes','is_active',
  'city','postal_code','province','country','fax','dealer_number','rin_number',
  'pst_number','driver_license','driver_license_expiry',
  'default_expense_type','default_account','posted','tax_exempt','memo',
];

function pick(body) {
  const out = {};
  for (const k of ALLOWED) if (body[k] !== undefined) out[k] = body[k] === '' ? null : body[k];
  return out;
}

router.get('/', async (req, res) => {
  try {
    const { active, q } = req.query;
    let query = supabase.from('suppliers').select('*').order('name');
    if (active === 'true') query = query.eq('is_active', true);
    if (q) query = query.ilike('name', `%${q}%`);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('suppliers').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const payload = pick(req.body);
    if (!payload.name || !payload.name.trim()) return res.status(400).json({ error: 'name is required' });
    payload.name = payload.name.trim();
    if (payload.is_active === undefined) payload.is_active = true;
    const { data, error } = await supabase
      .from('suppliers').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const payload = pick(req.body);
    payload.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('suppliers').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('suppliers').update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, supplier: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
