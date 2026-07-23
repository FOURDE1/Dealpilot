const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');
const { authenticateUser, requireRole } = require('../middleware/auth');

// GET /api/users — List all users
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, store_id, language_pref, created_at')
      .order('name');

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/me — Current authenticated user's profile
router.get('/me', authenticateUser, async (req, res) => {
  try {
    // req.user is already populated by authenticateUser middleware
    res.json(req.user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/login — Legacy login (backward compatibility)
// Kept for transition period. Will be removed after full auth migration.
router.post('/login', async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Check if user exists
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error && error.code === 'PGRST116') {
      // User not found — create new user
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({ name, email: email.toLowerCase() })
        .select()
        .single();

      if (insertError) throw insertError;
      user = newUser;
    } else if (error) {
      throw error;
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/create-account — Admin creates user accounts
// Creates both a Supabase Auth user and a profile in the users table
router.post('/create-account', authenticateUser, requireRole('owner', 'gm', 'admin_office'), async (req, res) => {
  try {
    const { name, email, password, role, store_id } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, and role are required' });
    }

    const validRoles = [
      'owner', 'gm', 'sales_manager', 'used_car_manager', 'fi_manager',
      'salesperson', 'wholesale_manager', 'logistics', 'admin_office', 'bdc_agent',
    ];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    // Create Supabase Auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
    });

    if (authError) {
      console.error('Error creating auth user:', authError);
      return res.status(400).json({ error: authError.message });
    }

    // Create profile in users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .insert({
        name,
        email: email.toLowerCase(),
        role,
        store_id: store_id || req.user.store_id,
        auth_id: authData.user.id,
      })
      .select()
      .single();

    if (profileError) {
      console.error('Error creating user profile:', profileError);
      // Clean up auth user if profile creation fails
      await supabase.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ error: 'Failed to create user profile' });
    }

    res.status(201).json(userProfile);
  } catch (err) {
    console.error('Error in create-account:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — Update user preferences
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    // Don't allow updating sensitive fields via this endpoint
    delete updates.auth_id;
    delete updates.id;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
