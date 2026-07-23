const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/search?q= — Unified search across contacts, deals, vehicles
router.get('/', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ contacts: [], deals: [], vehicles: [] });
    }

    const term = q.trim();
    const normalizedPhone = term.replace(/[^0-9]/g, '');

    // Search contacts
    const contactsPromise = supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone')
      .is('deleted_at', null)
      .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%${normalizedPhone.length >= 4 ? `,phone_normalized.ilike.%${normalizedPhone}%` : ''}`)
      .limit(5);

    // Search deals by stock number, VIN, or customer name
    const dealsPromise = supabase
      .from('deals')
      .select('id, stock_number, vin, year, make, model, customer_name, deal_status')
      .is('deleted_at', null)
      .or(`stock_number.ilike.%${term}%,vin.ilike.%${term}%,customer_name.ilike.%${term}%`)
      .limit(5);

    const [contactsResult, dealsResult] = await Promise.all([
      contactsPromise,
      dealsPromise,
    ]);

    res.json({
      contacts: contactsResult.data || [],
      deals: dealsResult.data || [],
    });
  } catch (err) {
    console.error('Error in GET /search:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
