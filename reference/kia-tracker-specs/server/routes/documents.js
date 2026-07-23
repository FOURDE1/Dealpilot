const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/documents?deal_id= or ?contact_id= or ?inventory_id=
router.get('/', async (req, res) => {
  try {
    const { deal_id, contact_id, inventory_id, category } = req.query;

    let query = supabase
      .from('documents')
      .select('id, deal_id, contact_id, inventory_id, category, filename, storage_path, file_size, mime_type, uploaded_by, notes, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (deal_id) query = query.eq('deal_id', deal_id);
    if (contact_id) query = query.eq('contact_id', contact_id);
    if (inventory_id) query = query.eq('inventory_id', inventory_id);
    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch documents' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /documents:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/documents/required?pipeline_stage=
router.get('/required', async (req, res) => {
  try {
    const { pipeline_stage } = req.query;
    let query = supabase.from('required_documents').select('*').order('sort_order');
    if (pipeline_stage) query = query.eq('pipeline_stage', pipeline_stage);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch required documents' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /documents/required:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/documents
router.post('/', async (req, res) => {
  try {
    const { deal_id, contact_id, inventory_id, category, filename, storage_path, file_size, mime_type, uploaded_by, store_id, notes } = req.body;

    if (!category || !filename || !storage_path) {
      return res.status(400).json({ error: 'category, filename, and storage_path are required' });
    }

    const { data, error } = await supabase
      .from('documents')
      .insert({ deal_id, contact_id, inventory_id, category, filename, storage_path, file_size, mime_type, uploaded_by, store_id, notes })
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Failed to create document' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /documents:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/documents/:id — Soft delete
router.delete('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .is('deleted_at', null)
      .select('id')
      .single();
    if (error || !data) return res.status(404).json({ error: 'Document not found' });
    res.json({ message: 'Document deleted', id: data.id });
  } catch (err) {
    console.error('Error in DELETE /documents/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
