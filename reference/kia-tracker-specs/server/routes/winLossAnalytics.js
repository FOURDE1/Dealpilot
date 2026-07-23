const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

const WON_STATUSES = ['converted'];
const LOST_STATUSES = ['lost'];

function periodToDate(period) {
  const now = new Date();
  switch (period) {
    case '30d':  return new Date(now.getTime() - 30 * 86400000);
    case '90d':  return new Date(now.getTime() - 90 * 86400000);
    case '6m':   return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case '1y':   return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case 'all':  return null;
    default:     return new Date(now.getTime() - 90 * 86400000);
  }
}

// GET / — win/loss analytics
router.get('/', async (req, res) => {
  try {
    const period = req.query.period || '90d';
    const sinceDate = periodToDate(period);

    let query = supabase
      .from('leads')
      .select('id, status, source, lost_reason_id, created_at, converted_deal_id, lost_reasons!left(name, name_fr, icon)')
      .is('deleted_at', null);
    if (sinceDate) query = query.gte('created_at', sinceDate.toISOString());

    const { data: leads, error } = await query;
    if (error) return res.status(500).json({ error: 'Failed to fetch leads', detail: error.message });

    const all = leads || [];
    const won = all.filter(l => WON_STATUSES.includes(l.status) || l.converted_deal_id);
    const lost = all.filter(l => LOST_STATUSES.includes(l.status));
    const open = all.filter(l => !WON_STATUSES.includes(l.status) && !LOST_STATUSES.includes(l.status) && !l.converted_deal_id);
    const decided = won.length + lost.length;

    // Summary
    const summary = {
      total: all.length,
      won: won.length,
      lost: lost.length,
      open: open.length,
      winRate: decided > 0 ? Math.round((won.length / decided) * 1000) / 10 : 0,
      lossRate: decided > 0 ? Math.round((lost.length / decided) * 1000) / 10 : 0,
    };

    // Lost reasons breakdown
    const reasonCounts = {};
    for (const l of lost) {
      const name = l.lost_reasons?.name || 'Unknown';
      if (!reasonCounts[name]) reasonCounts[name] = { reason: name, count: 0 };
      reasonCounts[name].count++;
    }
    const lostReasons = Object.values(reasonCounts)
      .sort((a, b) => b.count - a.count)
      .map(r => ({ ...r, percentage: lost.length > 0 ? Math.round((r.count / lost.length) * 1000) / 10 : 0 }));

    // Monthly trend
    const monthBuckets = {};
    for (const l of all) {
      const month = l.created_at.slice(0, 7); // "2026-01"
      if (!monthBuckets[month]) monthBuckets[month] = { month, won: 0, lost: 0 };
      if (WON_STATUSES.includes(l.status) || l.converted_deal_id) monthBuckets[month].won++;
      else if (LOST_STATUSES.includes(l.status)) monthBuckets[month].lost++;
    }
    const monthlyTrend = Object.values(monthBuckets)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({
        ...m,
        winRate: (m.won + m.lost) > 0 ? Math.round((m.won / (m.won + m.lost)) * 1000) / 10 : 0,
      }));

    // Source performance
    const sourceBuckets = {};
    for (const l of all) {
      const src = l.source || 'unknown';
      if (!sourceBuckets[src]) sourceBuckets[src] = { source: src, total: 0, won: 0, lost: 0 };
      sourceBuckets[src].total++;
      if (WON_STATUSES.includes(l.status) || l.converted_deal_id) sourceBuckets[src].won++;
      else if (LOST_STATUSES.includes(l.status)) sourceBuckets[src].lost++;
    }
    const sourcePerformance = Object.values(sourceBuckets)
      .sort((a, b) => b.total - a.total)
      .map(s => ({
        ...s,
        winRate: (s.won + s.lost) > 0 ? Math.round((s.won / (s.won + s.lost)) * 1000) / 10 : 0,
      }));

    res.json({ summary, lostReasons, monthlyTrend, sourcePerformance });
  } catch (err) {
    console.error('Win/loss analytics exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
