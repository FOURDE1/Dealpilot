const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

// GET /api/conversations — List conversations
router.get('/', async (req, res) => {
  try {
    const { status, assigned_agent_id, store_id } = req.query;

    let query = supabase
      .from('conversations')
      .select('id, lead_id, contact_id, store_id, channel, phone_number, status, language, assigned_agent_id, handed_off_at, bot_summary, bot_score, created_at')
      .order('updated_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (assigned_agent_id) query = query.eq('assigned_agent_id', assigned_agent_id);
    if (store_id) query = query.eq('store_id', store_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch conversations' });
    res.json(data);
  } catch (err) {
    console.error('Error in GET /conversations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/conversations/:id — Single conversation with messages
router.get('/:id', async (req, res) => {
  try {
    const { data: convo, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !convo) return res.status(404).json({ error: 'Conversation not found' });

    const { data: messages } = await supabase
      .from('messages')
      .select('id, sender_type, sender_id, body, media_url, metadata, created_at')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true });

    res.json({ ...convo, messages: messages || [] });
  } catch (err) {
    console.error('Error in GET /conversations/:id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/conversations — Create new conversation
router.post('/', async (req, res) => {
  try {
    const { lead_id, contact_id, store_id, channel, phone_number, language } = req.body;

    const { data, error } = await supabase
      .from('conversations')
      .insert({
        lead_id, contact_id, store_id,
        channel: channel || 'sms',
        phone_number, language: language || 'en',
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Failed to create conversation' });
    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /conversations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/conversations/:id/messages — Add message to conversation
router.post('/:id/messages', async (req, res) => {
  try {
    const { sender_type, sender_id, body, media_url, metadata } = req.body;

    if (!sender_type || !body) {
      return res.status(400).json({ error: 'sender_type and body are required' });
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: req.params.id,
        sender_type, sender_id, body, media_url, metadata,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Failed to send message' });

    // Update conversation timestamp
    await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', req.params.id);

    res.status(201).json(data);
  } catch (err) {
    console.error('Error in POST /conversations/:id/messages:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/conversations/:id/handoff — Bot hands off to agent
router.put('/:id/handoff', async (req, res) => {
  try {
    const { assigned_agent_id, bot_summary, bot_score } = req.body;

    const { data, error } = await supabase
      .from('conversations')
      .update({
        status: 'handed_off',
        assigned_agent_id,
        handed_off_at: new Date().toISOString(),
        bot_summary,
        bot_score,
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: 'Conversation not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in PUT /conversations/:id/handoff:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/conversations/:id/close — Close conversation
router.put('/:id/close', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('id, status')
      .single();

    if (error || !data) return res.status(404).json({ error: 'Conversation not found' });
    res.json(data);
  } catch (err) {
    console.error('Error in PUT /conversations/:id/close:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/conversations/webhook/twilio — Twilio incoming SMS webhook
router.post('/webhook/twilio', async (req, res) => {
  try {
    const { From, Body, MessageSid } = req.body;

    if (!From || !Body) {
      return res.status(400).json({ error: 'Missing From or Body' });
    }

    // Find or create conversation by phone number
    let { data: convo } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('phone_number', From)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!convo) {
      // New conversation from unknown number
      const { data: newConvo } = await supabase
        .from('conversations')
        .insert({ phone_number: From, channel: 'sms' })
        .select()
        .single();
      convo = newConvo;
    }

    if (convo) {
      // Store the message
      await supabase.from('messages').insert({
        conversation_id: convo.id,
        sender_type: 'client',
        body: Body,
        twilio_sid: MessageSid,
      });
    }

    // Respond with TwiML (empty — bot response handled async)
    res.type('text/xml').send('<Response></Response>');
  } catch (err) {
    console.error('Error in Twilio webhook:', err);
    res.type('text/xml').send('<Response></Response>');
  }
});

module.exports = router;
