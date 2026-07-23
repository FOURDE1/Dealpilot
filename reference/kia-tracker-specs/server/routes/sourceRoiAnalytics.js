const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');

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

// GET / — source ROI analytics
router.get('/', async (req, res) => {
  try {
    const period = req.query.period || '90d';
    const sinceDate = periodToDate(period);

    // Fetch leads
    let leadsQuery = supabase
      .from('leads')
      .select('id, source, status, converted_deal_id, created_at')
      .is('deleted_at', null);
    if (sinceDate) leadsQuery = leadsQuery.gte('created_at', sinceDate.toISOString());

    const { data: leads, error: leadsErr } = await leadsQuery;
    if (leadsErr) return res.status(500).json({ error: 'Failed to fetch leads', detail: leadsErr.message });

    // Fetch deals for revenue (join converted leads)
    const convertedIds = (leads || [])
      .filter(l => l.converted_deal_id)
      .map(l => l.converted_deal_id);

    let dealRevenue = {};
    if (convertedIds.length > 0) {
      const { data: deals } = await supabase
        .from('deals')
        .select('id, sale_price')
        .in('id', convertedIds);
      for (const d of (deals || [])) {
        dealRevenue[d.id] = Number(d.sale_price) || 0;
      }
    }

    // Fetch spend
    let costsQuery = supabase.from('source_costs').select('*');
    if (sinceDate) {
      const sinceMonth = sinceDate.toISOString().slice(0, 7) + '-01';
      costsQuery = costsQuery.gte('month', sinceMonth);
    }
    const { data: costs } = await costsQuery;

    // Aggregate spend by source
    const spendBySource = {};
    const monthlySpend = {};
    for (const c of (costs || [])) {
      const src = c.source;
      spendBySource[src] = (spendBySource[src] || 0) + Number(c.spend);
      const monthKey = c.month.slice(0, 7);
      const mk = `${monthKey}:${src}`;
      monthlySpend[mk] = (monthlySpend[mk] || 0) + Number(c.spend);
    }

    // Aggregate leads by source
    const allLeads = leads || [];
    const sourceData = {};

    // Include all sources that have spend even if zero leads
    for (const src of Object.keys(spendBySource)) {
      if (!sourceData[src]) sourceData[src] = { source: src, totalLeads: 0, convertedLeads: 0, totalRevenue: 0 };
    }

    for (const l of allLeads) {
      const src = l.source || 'unknown';
      if (!sourceData[src]) sourceData[src] = { source: src, totalLeads: 0, convertedLeads: 0, totalRevenue: 0 };
      sourceData[src].totalLeads++;
      const isConverted = l.status === 'converted' || l.converted_deal_id;
      if (isConverted) {
        sourceData[src].convertedLeads++;
        if (l.converted_deal_id && dealRevenue[l.converted_deal_id]) {
          sourceData[src].totalRevenue += dealRevenue[l.converted_deal_id];
        }
      }
    }

    // Build sources array
    const sources = Object.values(sourceData).map(s => {
      const spend = spendBySource[s.source] || 0;
      const cpl = s.totalLeads > 0 && spend > 0 ? Math.round((spend / s.totalLeads) * 100) / 100 : 0;
      const cpc = s.convertedLeads > 0 && spend > 0 ? Math.round((spend / s.convertedLeads) * 100) / 100 : 0;
      const convRate = s.totalLeads > 0 ? Math.round((s.convertedLeads / s.totalLeads) * 1000) / 10 : 0;
      const roi = spend > 0 ? Math.round(((s.totalRevenue - spend) / spend) * 1000) / 10 : 0;
      return {
        ...s,
        totalSpend: spend,
        costPerLead: cpl,
        costPerConversion: cpc,
        conversionRate: convRate,
        roi,
      };
    }).sort((a, b) => b.roi - a.roi);

    // Totals
    const totalLeads = sources.reduce((s, x) => s + x.totalLeads, 0);
    const totalConverted = sources.reduce((s, x) => s + x.convertedLeads, 0);
    const totalSpend = sources.reduce((s, x) => s + x.totalSpend, 0);
    const totalRevenue = sources.reduce((s, x) => s + x.totalRevenue, 0);

    const totals = {
      totalLeads,
      totalConverted,
      totalSpend: Math.round(totalSpend * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgCostPerLead: totalLeads > 0 && totalSpend > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0,
      avgConversionRate: totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 1000) / 10 : 0,
      overallROI: totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 1000) / 10 : 0,
    };

    // Monthly breakdown
    const monthBuckets = {};
    for (const l of allLeads) {
      const src = l.source || 'unknown';
      const month = l.created_at.slice(0, 7);
      const key = `${month}:${src}`;
      if (!monthBuckets[key]) monthBuckets[key] = { month, source: src, leads: 0, converted: 0, revenue: 0 };
      monthBuckets[key].leads++;
      if (l.status === 'converted' || l.converted_deal_id) {
        monthBuckets[key].converted++;
        if (l.converted_deal_id && dealRevenue[l.converted_deal_id]) {
          monthBuckets[key].revenue += dealRevenue[l.converted_deal_id];
        }
      }
    }

    const monthlyBreakdown = Object.values(monthBuckets)
      .map(m => {
        const spend = monthlySpend[`${m.month}:${m.source}`] || 0;
        return {
          ...m,
          spend,
          revenue: Math.round(m.revenue * 100) / 100,
          costPerLead: m.leads > 0 && spend > 0 ? Math.round((spend / m.leads) * 100) / 100 : 0,
          roi: spend > 0 ? Math.round(((m.revenue - spend) / spend) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month) || a.source.localeCompare(b.source));

    res.json({ sources, totals, monthlyBreakdown });
  } catch (err) {
    console.error('Source ROI analytics exception:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
