const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// Normalize phone: strip everything except digits
function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/[^0-9]/g, '');
}

// GET /api/contacts — List all contacts with optional filters
router.get('/', async (req, res) => {
  try {
    const { source, search, sort_by, sort_dir, limit, offset } = req.query;

    let query = supabase
      .from('contacts')
      .select('id, first_name, last_name, email, phone, city, province, source, customer_since, lifetime_deals, lifetime_value, preferred_language, created_at', { count: 'exact' })
      .is('deleted_at', null);

    if (source) {
      query = query.eq('source', source);
    }

    if (search) {
      // Use full-text search
      const searchTerms = search.trim().split(/\s+/).join(' & ');
      query = query.textSearch('search_vector', searchTerms, { type: 'plain' });
    }

    // Sorting
    const sortColumn = sort_by || 'created_at';
    const sortAscending = sort_dir === 'asc';
    query = query.order(sortColumn, { ascending: sortAscending });

    // Pagination
    const pageLimit = Math.min(parseInt(limit) || 50, 100);
    const pageOffset = parseInt(offset) || 0;
    query = query.range(pageOffset, pageOffset + pageLimit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching contacts:', error);
      return res.status(500).json({ error: 'Failed to fetch contacts' });
    }

    res.json({ data, total: count });
  } catch (err) {
    console.error('Error in GET /contacts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contacts/search?q= — Quick search (for command palette / typeahead)
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ data: [] });
    }

    const searchTerm = q.trim();
    const normalizedSearch = normalizePhone(searchTerm);

    // Try phone match first (if search looks like a number)
    let results = [];

    if (normalizedSearch && normalizedSearch.length >= 4) {
      const { data: phoneMatches } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, phone, city')
        .is('deleted_at', null)
        .ilike('phone_normalized', `%${normalizedSearch}%`)
        .limit(10);

      if (phoneMatches && phoneMatches.length > 0) {
        results = phoneMatches;
      }
    }

    // Also do name/email search
    if (results.length < 10) {
      const remaining = 10 - results.length;
      const existingIds = results.map(r => r.id);

      const { data: textMatches } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, phone, city')
        .is('deleted_at', null)
        .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
        .not('id', 'in', `(${existingIds.join(',')})`)
        .limit(remaining);

      if (textMatches) {
        results = [...results, ...textMatches];
      }
    }

    res.json({ data: results });
  } catch (err) {
    console.error('Error in GET /contacts/search:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/contacts/:id — Get single contact with associated deals
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: contact, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Get associated deals via deal_parties
    const { data: dealParties } = await supabase
      .from('deal_parties')
      .select('deal_id, role')
      .eq('contact_id', id);

    let deals = [];
    if (dealParties && dealParties.length > 0) {
      const dealIds = dealParties.map(dp => dp.deal_id);
      const { data: dealsData } = await supabase
        .from('deals')
        .select('id, stock_number, year, make, model, deal_status, sale_type, created_at')
        .in('id', dealIds)
        .order('created_at', { ascending: false });

      deals = (dealsData || []).map(deal => ({
        ...deal,
        role: dealParties.find(dp => dp.deal_id === deal.id)?.role || 'buyer',
      }));
    }

    res.json({ ...contact, deals });
  } catch (err) {
    console.error('Error in GET /contacts/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/contacts — Create a new contact (with duplicate detection)
router.post('/', async (req, res) => {
  try {
    const {
      first_name, last_name, email, phone, address, city, province,
      postal_code, driver_license, employer, date_of_birth,
      preferred_language, marketing_consent, source, notes,
    } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'first_name and last_name are required' });
    }

    // Duplicate detection: check phone and email
    const duplicates = [];
    const normalized = normalizePhone(phone);

    if (normalized && normalized.length >= 7) {
      const { data: phoneMatch } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone, email')
        .is('deleted_at', null)
        .eq('phone_normalized', normalized)
        .limit(5);
      if (phoneMatch && phoneMatch.length > 0) {
        duplicates.push(...phoneMatch.map(m => ({ ...m, match_type: 'phone' })));
      }
    }

    if (email) {
      const { data: emailMatch } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, phone, email')
        .is('deleted_at', null)
        .ilike('email', email.trim())
        .limit(5);
      if (emailMatch && emailMatch.length > 0) {
        const existingIds = new Set(duplicates.map(d => d.id));
        duplicates.push(
          ...emailMatch
            .filter(m => !existingIds.has(m.id))
            .map(m => ({ ...m, match_type: 'email' }))
        );
      }
    }

    // If duplicates found, return them for the frontend to handle
    if (duplicates.length > 0) {
      return res.status(409).json({
        error: 'Potential duplicate contacts found',
        duplicates,
        submitted: { first_name, last_name, email, phone },
      });
    }

    // No duplicates — create the contact
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        province: province?.trim() || null,
        postal_code: postal_code?.trim() || null,
        driver_license: driver_license?.trim() || null,
        employer: employer?.trim() || null,
        date_of_birth: date_of_birth || null,
        preferred_language: preferred_language || 'fr',
        marketing_consent: marketing_consent || false,
        consent_date: marketing_consent ? new Date().toISOString() : null,
        source: source || null,
        notes: notes?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating contact:', error);
      return res.status(500).json({ error: 'Failed to create contact' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /contacts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/contacts/force — Create contact ignoring duplicates
router.post('/force', async (req, res) => {
  try {
    const {
      first_name, last_name, email, phone, address, city, province,
      postal_code, driver_license, employer, date_of_birth,
      preferred_language, marketing_consent, source, notes,
    } = req.body;

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'first_name and last_name are required' });
    }

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        province: province?.trim() || null,
        postal_code: postal_code?.trim() || null,
        driver_license: driver_license?.trim() || null,
        employer: employer?.trim() || null,
        date_of_birth: date_of_birth || null,
        preferred_language: preferred_language || 'fr',
        marketing_consent: marketing_consent || false,
        consent_date: marketing_consent ? new Date().toISOString() : null,
        source: source || null,
        notes: notes?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating contact (force):', error);
      return res.status(500).json({ error: 'Failed to create contact' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /contacts/force:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/contacts/:id — Update a contact
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Don't allow updating system fields
    delete updates.id;
    delete updates.created_at;
    delete updates.updated_at;
    delete updates.deleted_at;
    delete updates.search_vector;
    delete updates.phone_normalized;

    // Update consent_date if marketing_consent changed
    if ('marketing_consent' in updates) {
      updates.consent_date = updates.marketing_consent ? new Date().toISOString() : null;
    }

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', id)
      .is('deleted_at', null)
      .select()
      .single();

    if (error) {
      console.error('Error updating contact:', error);
      return res.status(500).json({ error: 'Failed to update contact' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error in PUT /contacts/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/contacts/:id — Soft delete a contact
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ message: 'Contact deleted', id: data.id });
  } catch (err) {
    console.error('Error in DELETE /contacts/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
