const express = require('express');
const router = express.Router();
const { sendDealClosingEmail, sendDriverDispatchEmail } = require('../services/email');
const supabase = require('../middleware/supabase');

// POST send deal closing email
router.post('/deal-closing/:dealId', async (req, res) => {
  try {
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.dealId)
      .single();

    if (error) throw error;
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const result = await sendDealClosingEmail(deal);
    res.json({ message: 'Deal closing email sent', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST send driver dispatch email
router.post('/driver-dispatch/:dealId', async (req, res) => {
  try {
    const { data: deal, error } = await supabase
      .from('deals')
      .select('*')
      .eq('id', req.params.dealId)
      .single();

    if (error) throw error;
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    const result = await sendDriverDispatchEmail(deal);
    res.json({ message: 'Driver dispatch email sent', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
