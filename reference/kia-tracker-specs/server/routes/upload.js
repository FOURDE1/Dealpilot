const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CATEGORY_MAP = {
  'insurance': { table: 'delivery_checklists', column: 'client_insurance_file_url' },
  'funding-proof': { table: 'delivery_checklists', column: 'deal_funded_proof_url' },
  'bill-of-sale': { table: 'sourced_units', column: 'bill_of_sale_file_url' },
  'payment-proof': { table: 'sourced_units', column: 'proof_of_payment_url' },
};

// POST /:dealId/:category — Upload file
router.post('/:dealId/:category', upload.single('file'), async (req, res) => {
  try {
    const { dealId, category } = req.params;
    const mapping = CATEGORY_MAP[category];
    if (!mapping) {
      return res.status(400).json({ error: `Invalid category: ${category}` });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const filePath = `${dealId}/${category}/${Date.now()}_${req.file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from('deal-files')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Upsert the URL into the related table
    const { error: dbError } = await supabase
      .from(mapping.table)
      .upsert(
        { deal_id: dealId, [mapping.column]: filePath },
        { onConflict: 'deal_id' }
      );

    if (dbError) throw dbError;

    const { data: urlData } = supabase.storage
      .from('deal-files')
      .getPublicUrl(filePath);

    res.json({ path: filePath, url: urlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:dealId/:category — Get signed URL for file
router.get('/:dealId/:category', async (req, res) => {
  try {
    const { dealId, category } = req.params;
    const mapping = CATEGORY_MAP[category];
    if (!mapping) {
      return res.status(400).json({ error: `Invalid category: ${category}` });
    }

    const { data, error } = await supabase
      .from(mapping.table)
      .select(mapping.column)
      .eq('deal_id', dealId)
      .single();

    if (error) throw error;

    const filePath = data[mapping.column];
    if (!filePath) {
      return res.status(404).json({ error: 'No file found' });
    }

    const { data: signedData, error: signError } = await supabase.storage
      .from('deal-files')
      .createSignedUrl(filePath, 3600);

    if (signError) throw signError;

    res.json({ url: signedData.signedUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:dealId/:category — Remove file and null out URL
router.delete('/:dealId/:category', async (req, res) => {
  try {
    const { dealId, category } = req.params;
    const mapping = CATEGORY_MAP[category];
    if (!mapping) {
      return res.status(400).json({ error: `Invalid category: ${category}` });
    }

    // Get current file path
    const { data, error: fetchError } = await supabase
      .from(mapping.table)
      .select(mapping.column)
      .eq('deal_id', dealId)
      .single();

    if (fetchError) throw fetchError;

    const filePath = data[mapping.column];
    if (filePath) {
      const { error: removeError } = await supabase.storage
        .from('deal-files')
        .remove([filePath]);

      if (removeError) throw removeError;
    }

    // Null out the URL column
    const { error: updateError } = await supabase
      .from(mapping.table)
      .update({ [mapping.column]: null })
      .eq('deal_id', dealId);

    if (updateError) throw updateError;

    res.json({ message: 'File deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
