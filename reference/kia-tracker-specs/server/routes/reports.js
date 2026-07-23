const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');
const { generateExcel, generatePDF } = require('../services/reportGenerator');

// Helper: get date range from period
function getDateRange(period, dateFrom, dateTo) {
  const now = new Date();
  if (dateFrom && dateTo) {
    return { from: dateFrom, to: dateTo };
  }
  if (period === 'weekly') {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return { from: weekAgo.toISOString(), to: now.toISOString() };
  }
  if (period === 'monthly') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: monthStart.toISOString(), to: now.toISOString() };
  }
  // YTD
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return { from: yearStart.toISOString(), to: now.toISOString() };
}

// Helper: fetch deals within date range
async function fetchDealsInRange(from, to) {
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// GET /api/reports/sales-performance
router.get('/sales-performance', async (req, res) => {
  try {
    const { period = 'ytd', date_from, date_to } = req.query;
    const range = getDateRange(period, date_from, date_to);
    const deals = await fetchDealsInRange(range.from, range.to);

    // Per-salesperson stats
    const byPerson = {};
    deals.forEach((d) => {
      const name = d.salesperson_name || 'Unknown';
      if (!byPerson[name]) {
        byPerson[name] = { name, deals: 0, completed: 0, totalGross: 0, totalSales: 0, totalFI: 0 };
      }
      byPerson[name].deals++;
      if (d.deal_status === 'complete') byPerson[name].completed++;
      const gross = (Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0);
      byPerson[name].totalGross += gross;
      byPerson[name].totalSales += Number(d.sale_price) || 0;
      byPerson[name].totalFI += Number(d.fi_reserve) || 0;
    });

    const salespeople = Object.values(byPerson).sort((a, b) => b.totalGross - a.totalGross);

    // Monthly trend
    const monthlyTrend = {};
    deals.forEach((d) => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyTrend[key]) {
        monthlyTrend[key] = { month: key, deals: 0, totalGross: 0 };
      }
      monthlyTrend[key].deals++;
      monthlyTrend[key].totalGross += (Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0) + (Number(d.fi_reserve) || 0);
    });

    // Weekly trend
    const weeklyTrend = {};
    deals.forEach((d) => {
      const date = new Date(d.created_at);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      if (!weeklyTrend[key]) {
        weeklyTrend[key] = { week: key, deals: 0, totalGross: 0 };
      }
      weeklyTrend[key].deals++;
      weeklyTrend[key].totalGross += (Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0) + (Number(d.fi_reserve) || 0);
    });

    const totalDeals = deals.length;
    const completedDeals = deals.filter((d) => d.deal_status === 'complete').length;
    const totalGross = deals.reduce((sum, d) => sum + ((Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0) + (Number(d.fi_reserve) || 0)), 0);

    res.json({
      summary: {
        totalDeals,
        completedDeals,
        conversionRate: totalDeals > 0 ? (completedDeals / totalDeals * 100).toFixed(1) : 0,
        totalGross,
        avgGrossPerDeal: totalDeals > 0 ? (totalGross / totalDeals).toFixed(2) : 0,
      },
      salespeople,
      monthlyTrend: Object.values(monthlyTrend).sort((a, b) => a.month.localeCompare(b.month)),
      weeklyTrend: Object.values(weeklyTrend).sort((a, b) => a.week.localeCompare(b.week)),
      period,
      range,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/commissions
router.get('/commissions', async (req, res) => {
  try {
    const { period = 'ytd', date_from, date_to, salesperson } = req.query;
    const range = getDateRange(period, date_from, date_to);

    let query = supabase
      .from('commissions')
      .select('*, deals!inner(created_at, sale_price, vehicle_cost, fi_reserve, deal_status, salesperson_name)')
      .gte('deals.created_at', range.from)
      .lte('deals.created_at', range.to);

    if (salesperson) {
      query = query.ilike('salesperson_name', salesperson);
    }

    const { data: commissions, error } = await query;
    if (error) throw error;

    // Per-salesperson commission summary
    const byPerson = {};
    (commissions || []).forEach((c) => {
      const name = c.salesperson_name;
      if (!byPerson[name]) {
        byPerson[name] = {
          name,
          deals: 0,
          totalGrossForCommission: 0,
          totalCommission: 0,
          totalOverrides: 0,
          rate: c.commission_rate,
          padAmount: c.pad_amount,
        };
      }
      byPerson[name].deals++;
      byPerson[name].totalGrossForCommission += Number(c.gross_for_commission) || 0;
      byPerson[name].totalCommission += Number(c.commission_amount) || 0;
    });

    // Add override earnings
    (commissions || []).forEach((c) => {
      if (c.override_salesperson && c.override_amount > 0) {
        if (!byPerson[c.override_salesperson]) {
          byPerson[c.override_salesperson] = {
            name: c.override_salesperson,
            deals: 0,
            totalGrossForCommission: 0,
            totalCommission: 0,
            totalOverrides: 0,
            rate: 0,
            padAmount: 0,
          };
        }
        byPerson[c.override_salesperson].totalOverrides += Number(c.override_amount) || 0;
      }
    });

    // Monthly breakdown
    const monthlyBreakdown = {};
    (commissions || []).forEach((c) => {
      const date = new Date(c.deals?.created_at || c.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyBreakdown[key]) monthlyBreakdown[key] = { month: key, total: 0, count: 0 };
      monthlyBreakdown[key].total += Number(c.commission_amount) || 0;
      monthlyBreakdown[key].count++;
    });

    res.json({
      salespeople: Object.values(byPerson).sort((a, b) => b.totalCommission - a.totalCommission),
      commissions: commissions || [],
      monthlyBreakdown: Object.values(monthlyBreakdown).sort((a, b) => a.month.localeCompare(b.month)),
      period,
      range,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/financial-summary
router.get('/financial-summary', async (req, res) => {
  try {
    const { period = 'ytd', date_from, date_to } = req.query;
    const range = getDateRange(period, date_from, date_to);
    const deals = await fetchDealsInRange(range.from, range.to);

    const totalSales = deals.reduce((s, d) => s + (Number(d.sale_price) || 0), 0);
    const totalCost = deals.reduce((s, d) => s + (Number(d.vehicle_cost) || 0), 0);
    const totalGross = totalSales - totalCost;
    const totalFI = deals.reduce((s, d) => s + (Number(d.fi_reserve) || 0), 0);
    const totalNet = totalGross + totalFI;

    const moneyDownTotal = deals.reduce((s, d) => s + (Number(d.money_down_amount) || 0), 0);
    const moneyDownCollected = deals.filter((d) => d.money_down_collected).reduce((s, d) => s + (Number(d.money_down_amount) || 0), 0);
    const moneyDownOutstanding = moneyDownTotal - moneyDownCollected;

    const cashBackTotal = deals.reduce((s, d) => s + (Number(d.cash_back_amount) || 0), 0);
    const cashBackSent = deals.filter((d) => d.cash_back_sent).reduce((s, d) => s + (Number(d.cash_back_amount) || 0), 0);
    const cashBackPending = cashBackTotal - cashBackSent;

    const lienTotal = deals.filter((d) => d.has_lien).reduce((s, d) => s + (Number(d.lien_amount) || 0), 0);

    const retailDeals = deals.filter((d) => d.sale_type === 'retail');
    const wholesaleDeals = deals.filter((d) => d.sale_type === 'wholesale');

    const retailGross = retailDeals.reduce((s, d) => s + ((Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0) + (Number(d.fi_reserve) || 0)), 0);
    const wholesaleGross = wholesaleDeals.reduce((s, d) => s + ((Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0) + (Number(d.fi_reserve) || 0)), 0);

    // Monthly breakdown
    const monthly = {};
    deals.forEach((d) => {
      const date = new Date(d.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthly[key]) monthly[key] = { month: key, sales: 0, cost: 0, gross: 0, fi: 0, count: 0 };
      monthly[key].sales += Number(d.sale_price) || 0;
      monthly[key].cost += Number(d.vehicle_cost) || 0;
      monthly[key].gross += (Number(d.sale_price) || 0) - (Number(d.vehicle_cost) || 0);
      monthly[key].fi += Number(d.fi_reserve) || 0;
      monthly[key].count++;
    });

    res.json({
      summary: {
        totalSales,
        totalCost,
        totalGross,
        totalFI,
        totalNet,
        dealCount: deals.length,
        avgGrossPerDeal: deals.length > 0 ? (totalNet / deals.length).toFixed(2) : 0,
      },
      moneyFlow: {
        moneyDownTotal,
        moneyDownCollected,
        moneyDownOutstanding,
        cashBackTotal,
        cashBackSent,
        cashBackPending,
        lienTotal,
      },
      breakdown: {
        retail: { count: retailDeals.length, totalGross: retailGross },
        wholesale: { count: wholesaleDeals.length, totalGross: wholesaleGross },
      },
      monthlyTrend: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
      period,
      range,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/inventory-pipeline
router.get('/inventory-pipeline', async (req, res) => {
  try {
    const { data: deals, error } = await supabase
      .from('deals')
      .select('*')
      .neq('deal_status', 'cancelled')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const now = new Date();

    // By vehicle status
    const vehicleStatus = {
      incoming: deals.filter((d) => d.vehicle_status === 'incoming').length,
      at_garage: deals.filter((d) => d.vehicle_status === 'at_garage').length,
      delivered: deals.filter((d) => d.vehicle_status === 'delivered').length,
    };

    // By finance status
    const financeStatus = {
      pending: deals.filter((d) => d.finance_status === 'pending').length,
      approved: deals.filter((d) => d.finance_status === 'approved').length,
      funded: deals.filter((d) => d.finance_status === 'funded').length,
    };

    // Average days to delivery
    const deliveredDeals = deals.filter((d) => d.delivery_date && d.created_at);
    const avgDaysToDelivery = deliveredDeals.length > 0
      ? (deliveredDeals.reduce((sum, d) => {
          const created = new Date(d.created_at);
          const delivered = new Date(d.delivery_date);
          return sum + ((delivered - created) / (1000 * 60 * 60 * 24));
        }, 0) / deliveredDeals.length).toFixed(1)
      : 0;

    // Aging inventory (not delivered, days since creation)
    const aging = deals
      .filter((d) => d.vehicle_status !== 'delivered')
      .map((d) => {
        const created = new Date(d.created_at);
        const days = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        return {
          id: d.id,
          stock_number: d.stock_number,
          vehicle: [d.year, d.make, d.model].filter(Boolean).join(' '),
          customer: d.customer_name,
          salesperson: d.salesperson_name,
          vehicle_status: d.vehicle_status,
          finance_status: d.finance_status,
          days_old: days,
          created_at: d.created_at,
        };
      })
      .sort((a, b) => b.days_old - a.days_old);

    // Bottleneck analysis
    const bottlenecks = {
      not_funded: deals.filter((d) => d.vehicle_status === 'delivered' && d.finance_status !== 'funded').length,
      no_delivery_date: deals.filter((d) => d.deal_status === 'open' && !d.tentative_delivery_date).length,
      licensing_incomplete: deals.filter((d) => d.vehicle_status !== 'delivered' && !d.licensing_completed).length,
    };

    res.json({
      vehicleStatus,
      financeStatus,
      avgDaysToDelivery,
      aging,
      bottlenecks,
      totalActive: deals.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/export/excel
router.get('/export/excel', async (req, res) => {
  try {
    const { type = 'financial', period = 'ytd', date_from, date_to } = req.query;
    const range = getDateRange(period, date_from, date_to);
    const deals = await fetchDealsInRange(range.from, range.to);

    let commissions = [];
    if (type === 'commissions') {
      const { data } = await supabase
        .from('commissions')
        .select('*, deals!inner(created_at, salesperson_name)')
        .gte('deals.created_at', range.from)
        .lte('deals.created_at', range.to);
      commissions = data || [];
    }

    const buffer = await generateExcel(type, deals, commissions, period);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=report-${type}-${period}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/export/pdf
router.get('/export/pdf', async (req, res) => {
  try {
    const { type = 'financial', period = 'ytd', date_from, date_to } = req.query;
    const range = getDateRange(period, date_from, date_to);
    const deals = await fetchDealsInRange(range.from, range.to);

    let commissions = [];
    if (type === 'commissions') {
      const { data } = await supabase
        .from('commissions')
        .select('*, deals!inner(created_at, salesperson_name)')
        .gte('deals.created_at', range.from)
        .lte('deals.created_at', range.to);
      commissions = data || [];
    }

    const buffer = await generatePDF(type, deals, commissions, period);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=report-${type}-${period}.pdf`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
