const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();

// GET /api/expenses — filter by inventory_id, deal_id, stock_number, status, date range, supplier, category.
router.get('/', async (req, res) => {
  try {
    const { inventory_id, deal_id, stock_number, status, category_code, supplier_id,
            from, to, limit = 500 } = req.query;
    let q = supabase
      .from('expenses')
      .select('*, supplier:suppliers(id,name), category:expense_categories(code,label,is_cogs)')
      .order('expense_date', { ascending: false })
      .limit(Number(limit));
    if (inventory_id) q = q.eq('inventory_id', inventory_id);
    if (deal_id)      q = q.eq('deal_id', deal_id);
    if (stock_number) q = q.eq('stock_number', stock_number);
    if (status)       q = q.eq('status', status);
    if (category_code)q = q.eq('category_code', category_code);
    if (supplier_id)  q = q.eq('supplier_id', supplier_id);
    if (from)         q = q.gte('expense_date', from);
    if (to)           q = q.lte('expense_date', to);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/categories', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('expense_categories').select('*').eq('is_active', true).order('display_order');
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/summary/inventory/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicle_expense_summary').select('*').eq('inventory_id', req.params.id).maybeSingle();
    if (error) throw error;
    res.json(data || { inventory_id: req.params.id, expense_count: 0, total_cents: 0, pending_cents: 0, paid_cents: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.category_code) return res.status(400).json({ error: 'category_code required' });
    if (b.amount_cents == null || b.amount_cents < 0) return res.status(400).json({ error: 'amount_cents required' });
    if (!b.inventory_id && !b.deal_id && !b.stock_number) {
      return res.status(400).json({ error: 'must link to inventory_id, deal_id, or stock_number' });
    }
    const row = {
      store_id: b.store_id || null,
      inventory_id: b.inventory_id || null,
      deal_id: b.deal_id || null,
      stock_number: b.stock_number || null,
      category_code: b.category_code,
      supplier_id: b.supplier_id || null,
      supplier_name: b.supplier_name || null,
      amount_cents: Math.round(Number(b.amount_cents) || 0),
      tax_cents: Math.round(Number(b.tax_cents) || 0),
      invoice_number: b.invoice_number || null,
      expense_date: b.expense_date || new Date().toISOString().slice(0, 10),
      description: b.description || null,
      notes: b.notes || null,
      receipt_url: b.receipt_url || null,
      status: b.status || 'pending',
      payment_method: b.payment_method || null,
      created_by: b.created_by || null,
    };
    const { data, error } = await supabase.from('expenses').insert(row).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const patch = { ...req.body, updated_at: new Date().toISOString() };
    delete patch.id; delete patch.created_at; delete patch.created_by; delete patch.total_cents;
    const { data, error } = await supabase
      .from('expenses').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manager-only approval. Caller must pass { approved_by: <manager user id> }.
router.patch('/:id/approve', async (req, res) => {
  try {
    const { approved_by } = req.body || {};
    if (!approved_by) return res.status(400).json({ error: 'approved_by (manager user id) required' });
    const { data, error } = await supabase
      .from('expenses')
      .update({ status: 'approved', approved_by, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/reject', async (req, res) => {
  try {
    const { approved_by } = req.body || {};
    const { data, error } = await supabase
      .from('expenses')
      .update({ status: 'rejected', approved_by: approved_by || null, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/pay', async (req, res) => {
  try {
    const { payment_method } = req.body || {};
    const { data, error } = await supabase
      .from('expenses')
      .update({ status: 'paid', paid_at: new Date().toISOString(), payment_method: payment_method || null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    // Soft delete via void — preserves audit trail.
    const { data, error } = await supabase
      .from('expenses')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json({ success: true, expense: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
