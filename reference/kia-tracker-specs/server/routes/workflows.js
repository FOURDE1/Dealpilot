const express = require('express');
const supabase = require('../middleware/supabase');
const router = express.Router();

// GET all workflow sequences
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workflow_sequences')
      .select('*, workflow_steps(count)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single workflow with steps
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workflow_sequences')
      .select('*, workflow_steps(*)')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (data && data.workflow_steps) {
      data.workflow_steps.sort((a, b) => a.step_order - b.step_order);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create workflow with steps
router.post('/', async (req, res) => {
  try {
    const { name, description, trigger_on, trigger_config, is_active, steps } = req.body;
    const { data: workflow, error: wErr } = await supabase
      .from('workflow_sequences')
      .insert({ name, description, trigger_on: trigger_on || 'lead_status_change', trigger_config: trigger_config || {}, is_active: is_active || false })
      .select()
      .single();
    if (wErr) throw wErr;
    if (steps && steps.length > 0) {
      const stepsWithWorkflow = steps.map((s, i) => ({
        workflow_id: workflow.id,
        step_order: i + 1,
        delay_minutes: s.delay_minutes || 0,
        action_type: s.action_type,
        template_id: s.template_id || null,
        custom_subject: s.custom_subject || null,
        custom_body: s.custom_body || null,
        config: s.config || {}
      }));
      const { error: sErr } = await supabase.from('workflow_steps').insert(stepsWithWorkflow);
      if (sErr) throw sErr;
    }
    const { data: result } = await supabase
      .from('workflow_sequences')
      .select('*, workflow_steps(*)')
      .eq('id', workflow.id)
      .single();
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update workflow and steps
router.put('/:id', async (req, res) => {
  try {
    const { name, description, trigger_on, trigger_config, is_active, steps } = req.body;
    const { error: wErr } = await supabase
      .from('workflow_sequences')
      .update({ name, description, trigger_on, trigger_config, is_active, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (wErr) throw wErr;
    if (steps) {
      await supabase.from('workflow_steps').delete().eq('workflow_id', req.params.id);
      if (steps.length > 0) {
        const stepsWithWorkflow = steps.map((s, i) => ({
          workflow_id: req.params.id,
          step_order: i + 1,
          delay_minutes: s.delay_minutes || 0,
          action_type: s.action_type,
          template_id: s.template_id || null,
          custom_subject: s.custom_subject || null,
          custom_body: s.custom_body || null,
          config: s.config || {}
        }));
        const { error: sErr } = await supabase.from('workflow_steps').insert(stepsWithWorkflow);
        if (sErr) throw sErr;
      }
    }
    const { data: result } = await supabase
      .from('workflow_sequences')
      .select('*, workflow_steps(*)')
      .eq('id', req.params.id)
      .single();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE workflow
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('workflow_sequences')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH toggle active status
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { data: current } = await supabase
      .from('workflow_sequences')
      .select('is_active')
      .eq('id', req.params.id)
      .single();
    const { data, error } = await supabase
      .from('workflow_sequences')
      .update({ is_active: !current.is_active, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET enrollments for a workflow
router.get('/:id/enrollments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('workflow_enrollments')
      .select('*, leads(first_name, last_name, email, phone, status)')
      .eq('workflow_id', req.params.id)
      .order('enrolled_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST enroll a lead in a workflow
router.post('/:id/enroll', async (req, res) => {
  try {
    const { lead_id } = req.body;
    const { data, error } = await supabase
      .from('workflow_enrollments')
      .insert({ workflow_id: req.params.id, lead_id, status: 'active' })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;