import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Clock, TrendingUp, Phone, MessageSquare, Mail, Car, Flame } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const TYPE_COLORS = {
  call:  { bg: 'bg-blue-500', text: 'text-blue-700', light: 'bg-blue-50' },
  sms:   { bg: 'bg-emerald-500', text: 'text-emerald-700', light: 'bg-emerald-50' },
  email: { bg: 'bg-violet-500', text: 'text-violet-700', light: 'bg-violet-50' },
  visit: { bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-50' },
};

const TYPE_ICONS = { call: Phone, sms: MessageSquare, email: Mail, visit: Car };

function formatHour(h) {
  if (h === 0) return '12a';
  if (h < 12) return h + 'a';
  if (h === 12) return '12p';
  return (h - 12) + 'p';
}

function getIntensity(count, max) {
  if (count === 0) return { bg: 'bg-gray-50', text: 'text-gray-400' };
  const r = count / max;
  if (r <= 0.2) return { bg: 'bg-emerald-100', text: 'text-emerald-800' };
  if (r <= 0.4) return { bg: 'bg-emerald-200', text: 'text-emerald-800' };
  if (r <= 0.6) return { bg: 'bg-emerald-300', text: 'text-white' };
  if (r <= 0.8) return { bg: 'bg-emerald-400', text: 'text-white' };
  return { bg: 'bg-emerald-500', text: 'text-white' };
}

export default function ActivityHeatmap({ leadId, communications: propComms }) {
  const { t } = useTranslation();
  const [view, setView] = useState('all');

  const { data: fetchedComms = [] } = useQuery({
    queryKey: ['lead-communications', leadId],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/leads/${leadId}/communications`);
      return res.ok ? res.json() : [];
    },
    enabled: !!leadId && !propComms,
  });

  const communications = propComms || fetchedComms;

  const { grid, maxCount, totalCount, bestSlots, typeCounts } = useMemo(() => {
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    const tc = { call: 0, sms: 0, email: 0, visit: 0 };
    let max = 0;
    let total = 0;

    const filtered = view === 'all'
      ? communications
      : view === 'inbound' || view === 'outbound'
        ? communications.filter(c => c.direction === view)
        : communications.filter(c => c.type === view);

    filtered.forEach(comm => {
      const d = new Date(comm.created_at);
      const day = d.getDay();
      const hour = d.getHours();
      g[day][hour]++;
      if (g[day][hour] > max) max = g[day][hour];
      total++;
    });

    communications.forEach(c => {
      if (tc[c.type] !== undefined) tc[c.type]++;
    });

    const slots = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (g[d][h] > 0) slots.push({ day: d, hour: h, count: g[d][h] });
      }
    }
    slots.sort((a, b) => b.count - a.count);

    return { grid: g, maxCount: max, totalCount: total, bestSlots: slots.slice(0, 3), typeCounts: tc };
  }, [communications, view]);

  const filters = [
    { id: 'all', label: 'All Activity' },
    { id: 'call', label: 'Calls' },
    { id: 'sms', label: 'Texts' },
    { id: 'email', label: 'Emails' },
    { id: 'inbound', label: 'Inbound' },
    { id: 'outbound', label: 'Outbound' },
  ];

  if (communications.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <Clock className="mx-auto mb-3 text-gray-300" size={40} />
        <p className="font-medium">No activity data yet</p>
        <p className="text-sm mt-1">Contact activity will appear here as you interact with this lead</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flame size={18} className="text-orange-500" />
          <h3 className="font-semibold text-gray-800">Activity Heatmap</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {totalCount} interactions
          </span>
        </div>
        <div className="flex gap-1 flex-wrap">
          {filters.map(f => (
            <button
              key={f.id}
              onClick={() => setView(f.id)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                view === f.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div className="flex">
            <div className="w-16 shrink-0" />
            {HOURS.map(h => (
              <div key={h} className="flex-1 text-center text-[10px] text-gray-400 pb-1">
                {h % 3 === 0 ? formatHour(h) : ''}
              </div>
            ))}
          </div>
          {DAYS.map((day, di) => (
            <div key={day} className="flex items-center">
              <div className="w-16 shrink-0 text-xs text-gray-500 font-medium pr-2 text-right">{day}</div>
              {HOURS.map(h => {
                const { bg, text } = getIntensity(grid[di][h], maxCount);
                return (
                  <div
                    key={h}
                    className={`flex-1 aspect-square m-[1px] rounded-sm ${bg} flex items-center justify-center cursor-default transition-transform hover:scale-125 hover:z-10`}
                    title={`${DAY_LABELS[di]} ${formatHour(h)} \u2014 ${grid[di][h]} interaction${grid[di][h] !== 1 ? 's' : ''}`}
                  >
                    {grid[di][h] > 0 && (
                      <span className={`text-[9px] font-bold ${text}`}>{grid[di][h]}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-gray-400">
            <span>Less</span>
            <div className="w-3 h-3 rounded-sm bg-gray-50 border border-gray-200" />
            <div className="w-3 h-3 rounded-sm bg-emerald-100" />
            <div className="w-3 h-3 rounded-sm bg-emerald-200" />
            <div className="w-3 h-3 rounded-sm bg-emerald-300" />
            <div className="w-3 h-3 rounded-sm bg-emerald-400" />
            <div className="w-3 h-3 rounded-sm bg-emerald-500" />
            <span>More</span>
          </div>
        </div>
      </div>

      {/* Best Contact Times */}
      {bestSlots.length > 0 && (
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-emerald-600" />
            <h4 className="text-sm font-semibold text-emerald-800">Best Contact Times</h4>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {bestSlots.map((slot, i) => (
              <div key={i} className="flex items-center gap-2 bg-white/70 rounded-md px-3 py-2">
                <span className={`text-lg font-bold ${i === 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {i + 1}.
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-800">{DAY_LABELS[slot.day]}</div>
                  <div className="text-xs text-gray-500">
                    {formatHour(slot.hour)} \u2014 {slot.count} interaction{slot.count !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Object.entries(TYPE_ICONS).map(([type, Icon]) => (
          <div key={type} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${TYPE_COLORS[type]?.light || 'bg-gray-50'}`}>
            <Icon size={14} className={TYPE_COLORS[type]?.text || 'text-gray-600'} />
            <div>
              <div className={`text-sm font-semibold ${TYPE_COLORS[type]?.text || 'text-gray-700'}`}>
                {typeCounts[type] || 0}
              </div>
              <div className="text-[10px] text-gray-500 capitalize">{type === 'sms' ? 'texts' : type + 's'}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
