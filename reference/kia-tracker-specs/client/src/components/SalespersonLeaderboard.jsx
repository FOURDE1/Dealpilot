import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trophy, Medal, Clock, Target, Users, Handshake, Search } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const PERIODS = [
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: '6m', label: '6 Months', days: 180 },
  { key: '1y', label: '1 Year', days: 365 },
  { key: 'all', label: 'All Time', days: null },
];

const SORT_OPTIONS = [
  { key: 'deals', label: 'Closed Deals' },
  { key: 'conversion', label: 'Conversion Rate' },
  { key: 'response', label: 'Response Time' },
  { key: 'leads', label: 'Active Leads' },
];

function matchSalespersonToUser(spName, users) {
  if (!users || !users.length) return null;
  const spLower = spName.toLowerCase().trim();
  let bestMatch = null;
  let bestScore = 0;
  for (const u of users) {
    const fullName = (u.full_name || '').toLowerCase().trim();
    if (!fullName) continue;
    let score = 0;
    if (fullName === spLower) score = 100;
    else if (fullName.startsWith(spLower + ' ')) score = 80;
    else if (fullName.startsWith(spLower)) score = 70;
    else {
      const firstName = fullName.split(' ')[0];
      if (firstName === spLower) score = 60;
      else if (fullName.split(' ').some(p => p === spLower)) score = 30;
    }
    if (score > bestScore) { bestScore = score; bestMatch = u; }
  }
  return bestMatch;
}

export default function SalespersonLeaderboard() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('all');
  const [sortBy, setSortBy] = useState('deals');
  const [searchTerm, setSearchTerm] = useState('');

  const periodDays = PERIODS.find(p => p.key === period)?.days;
  const cutoffDate = periodDays
    ? new Date(Date.now() - periodDays * 86400000).toISOString()
    : null;

  const { data: salespeople = [] } = useQuery({
    queryKey: ['salespeople'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/salespeople`);
      if (!r.ok) throw new Error('Failed');
      return r.json();
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/users`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: deals = [] } = useQuery({
    queryKey: ['deals', period],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/deals`);
      if (!r.ok) throw new Error('Failed');
      const all = await r.json();
      if (!cutoffDate) return all;
      return all.filter(d => d.created_at >= cutoffDate);
    },
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', period],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/leads`);
      if (!r.ok) throw new Error('Failed');
      const all = await r.json();
      if (!cutoffDate) return all;
      return all.filter(l => l.created_at >= cutoffDate);
    },
  });

  const leaderboardData = useMemo(() => {
    if (!salespeople.length) return [];
    return salespeople.map(sp => {
      const spName = sp.name || '';
      const spDeals = deals.filter(d =>
        (d.salesperson_name || '').toLowerCase().trim() === spName.toLowerCase().trim()
      );
      const closedDeals = spDeals.filter(d =>
        ['won', 'closed', 'delivered'].includes((d.pipeline_stage || d.status || '').toLowerCase())
      );
      const matchedUser = matchSalespersonToUser(spName, users);
      const spLeads = matchedUser
        ? leads.filter(l => l.assigned_to === matchedUser.id)
        : [];
      const activeLeads = spLeads.filter(l =>
        !['converted', 'lost', 'closed'].includes((l.status || '').toLowerCase())
      );
      const totalLeads = spLeads.length + spDeals.length;
      const conversionRate = totalLeads > 0 ? ((closedDeals.length / totalLeads) * 100) : 0;
      let avgResponseTime = null;
      const respondedLeads = spLeads.filter(l => l.first_response_at && l.created_at);
      if (respondedLeads.length > 0) {
        const totalHours = respondedLeads.reduce((sum, l) => {
          return sum + (new Date(l.first_response_at) - new Date(l.created_at)) / 3600000;
        }, 0);
        avgResponseTime = totalHours / respondedLeads.length;
      }
      return { id: sp.id, name: spName, closedDeals: closedDeals.length, totalDeals: spDeals.length, activeLeads: activeLeads.length, totalLeads: spLeads.length, conversionRate, avgResponseTime };
    });
  }, [salespeople, deals, leads, users]);

  const sortedData = useMemo(() => {
    let filtered = leaderboardData;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(s => s.name.toLowerCase().includes(q));
    }
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'deals': return b.closedDeals - a.closedDeals;
        case 'conversion': return b.conversionRate - a.conversionRate;
        case 'response':
          if (a.avgResponseTime === null && b.avgResponseTime === null) return 0;
          if (a.avgResponseTime === null) return 1;
          if (b.avgResponseTime === null) return -1;
          return a.avgResponseTime - b.avgResponseTime;
        case 'leads': return b.activeLeads - a.activeLeads;
        default: return 0;
      }
    });
  }, [leaderboardData, sortBy, searchTerm]);

  const getRankIcon = (index) => {
    if (index === 0) return <Trophy className="w-6 h-6 text-yellow-500" />;
    if (index === 1) return <Medal className="w-6 h-6 text-gray-400" />;
    if (index === 2) return <Medal className="w-6 h-6 text-amber-600" />;
    return <span className="w-6 h-6 flex items-center justify-center text-sm font-bold text-gray-500">{index + 1}</span>;
  };

  const formatResponseTime = (hours) => {
    if (hours === null) return 'N/A';
    if (hours < 1) return Math.round(hours * 60) + 'm';
    if (hours < 24) return hours.toFixed(1) + 'h';
    return (hours / 24).toFixed(1) + 'd';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-yellow-500" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Salesperson Leaderboard</h1>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search salesperson..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-64"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={period === p.key ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white' : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-6">
        <span className="text-sm text-gray-500 dark:text-gray-400 self-center mr-1">Sort by:</span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setSortBy(opt.key)}
            className={sortBy === opt.key ? 'px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 text-white' : 'px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1"><Users className="w-4 h-4" /><span>Total Salespeople</span></div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{sortedData.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1"><Handshake className="w-4 h-4" /><span>Total Closed</span></div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{sortedData.reduce((s, d) => s + d.closedDeals, 0)}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1"><Target className="w-4 h-4" /><span>Avg Conversion</span></div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{sortedData.length > 0 ? (sortedData.reduce((s, d) => s + d.conversionRate, 0) / sortedData.length).toFixed(1) : '0'}%</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1"><Users className="w-4 h-4" /><span>Active Leads</span></div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{sortedData.reduce((s, d) => s + d.activeLeads, 0)}</div>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rank</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Salesperson</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"><div className="flex items-center justify-center gap-1"><Clock className="w-3.5 h-3.5" />Response Time</div></th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"><div className="flex items-center justify-center gap-1"><Target className="w-3.5 h-3.5" />Conversion</div></th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"><div className="flex items-center justify-center gap-1"><Users className="w-3.5 h-3.5" />Active Leads</div></th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"><div className="flex items-center justify-center gap-1"><Handshake className="w-3.5 h-3.5" />Closed Deals</div></th>
              </tr>
            </thead>
            <tbody>
              {sortedData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">No salespeople found</td>
                </tr>
              ) : (
                sortedData.map((sp, index) => (
                  <tr
                    key={sp.id}
                    className={index === 0 ? 'border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 bg-yellow-50/50 dark:bg-yellow-900/10' : 'border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30'}
                  >
                    <td className="px-4 py-3"><div className="flex items-center justify-center">{getRankIcon(index)}</div></td>
                    <td className="px-4 py-3"><div className="font-semibold text-gray-900 dark:text-white">{sp.name}</div></td>
                    <td className="px-4 py-3 text-center">
                      <span className={sp.avgResponseTime === null ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-500' : sp.avgResponseTime < 1 ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : sp.avgResponseTime < 4 ? 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}>
                        <Clock className="w-3.5 h-3.5" />
                        {formatResponseTime(sp.avgResponseTime)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full" style={{ width: Math.min(sp.conversionRate, 100) + '%' }} />
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-12 text-right">{sp.conversionRate.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{sp.activeLeads} <span className="text-xs font-normal text-gray-400">/ {sp.totalLeads}</span></span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
                        <Handshake className="w-4 h-4 text-green-500" />
                        {sp.closedDeals} <span className="text-xs font-normal text-gray-400">/ {sp.totalDeals}</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}