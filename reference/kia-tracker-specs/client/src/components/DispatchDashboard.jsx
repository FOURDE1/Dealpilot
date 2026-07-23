import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL;
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const DISPATCH_STATUSES = ['pending','dispatched','in_transit','delivered','completed'];
const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  dispatched: 'bg-blue-100 text-blue-800 border-blue-300',
  in_transit: 'bg-purple-100 text-purple-800 border-purple-300',
  delivered: 'bg-green-100 text-green-800 border-green-300',
  completed: 'bg-gray-100 text-gray-800 border-gray-300',
};
const STATUS_LABELS = {
  pending: 'Pending',
  dispatched: 'Dispatched',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  completed: 'Completed',
};

function loadCompanies() {
  try { return JSON.parse(localStorage.getItem('kia_transport_companies') || '[]'); }
  catch { return []; }
}
function saveCompanies(list) {
  localStorage.setItem('kia_transport_companies', JSON.stringify(list));
}

function TransportCompanies({ companies, setCompanies }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [editing, setEditing] = useState(null);

  const handleSave = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    let updated;
    if (editing !== null) {
      updated = companies.map((c, i) => i === editing ? { ...form } : c);
      setEditing(null);
    } else {
      updated = [...companies, { ...form }];
    }
    setCompanies(updated);
    saveCompanies(updated);
    setForm({ name: '', email: '', phone: '' });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Transport Companies</h3>
      <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4">
        <input type="text" value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))}
          placeholder="Company name" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <input type="email" value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))}
          placeholder="Email" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <input type="tel" value={form.phone} onChange={e => setForm(p => ({...p, phone: e.target.value}))}
          placeholder="Phone" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
          {editing !== null ? 'Update' : 'Add Company'}
        </button>
      </form>
      <div className="space-y-2">
        {companies.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">No transport companies added yet</p>
        ) : companies.map((c, i) => (
          <div key={i} className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 hover:bg-gray-50">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-900">{c.name}</span>
              {c.email && <span className="text-sm text-gray-500">{c.email}</span>}
              {c.phone && <span className="text-sm text-gray-500">{c.phone}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { setForm(companies[i]); setEditing(i); }}
                className="text-xs text-blue-600 hover:text-blue-800 underline">Edit</button>
              <button type="button" onClick={() => {
                if (!window.confirm('Delete this transport company?')) return;
                const updated = companies.filter((_, idx) => idx !== i);
                setCompanies(updated); saveCompanies(updated);
              }} className="text-xs text-red-600 hover:text-red-800 underline">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DispatchEmailModal({ isOpen, onClose, dispatch, deal, companies }) {
  const [selectedCompany, setSelectedCompany] = useState(0);
  const [instructions, setInstructions] = useState('');
  const [sent, setSent] = useState(false);

  if (!isOpen || !deal) return null;

  const company = companies[selectedCompany] || {};
  const vehicle = [deal.year, deal.make, deal.model, deal.color].filter(Boolean).join(' ');
  const tradeInfo = deal.has_trade_in
    ? [deal.trade_year, deal.trade_make, deal.trade_model, deal.trade_color].filter(Boolean).join(' ')
    : null;

  const subject = 'Dispatch Request - ' + (deal.customer_name || 'Customer') + ' - ' + vehicle;
  const body = [
    'DISPATCH REQUEST', '================', '',
    'Customer: ' + (deal.customer_name || '-'),
    'Phone: ' + (deal.customer_phone || '-'),
    'Delivery Address: ' + (deal.delivery_address || deal.customer_address || '-'),
    '', 'VEHICLE TO DELIVER:',
    'Stock #: ' + (deal.stock_number || '-'),
    'Vehicle: ' + vehicle,
    'VIN: ' + (deal.vin || '-'),
    'Pickup Location: ' + (deal.pickup_location || 'Dealership'),
    '',
    deal.has_trade_in ? 'TRADE-IN TO PICK UP:' : null,
    deal.has_trade_in ? 'Trade: ' + (tradeInfo || '-') : null,
    deal.has_trade_in ? 'Trade Stock #: ' + (deal.trade_stock_number || '-') : null,
    deal.has_trade_in ? 'Trade VIN: ' + (deal.trade_vin || '-') : null,
    deal.has_trade_in ? '' : null,
    'DELIVERY DATE: ' + (deal.tentative_delivery_date || deal.delivery_date || '-'),
    '', 'SPECIAL INSTRUCTIONS:', instructions || 'None',
    '', 'REMINDERS:',
    '- Take photos of customer with vehicle',
    '- Take photos of customer ID',
    '- Customer must sign delivery receipt',
    deal.has_trade_in ? '- Bring back trade-in vehicle' : null,
    '', 'Thank you,', 'Kia Mont-Laurier',
  ].filter(v => v !== null).join('\n');

  const mailtoLink = company.email
    ? 'mailto:' + encodeURIComponent(company.email) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body)
    : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(subject + '\n\n' + body);
    setSent(true);
    setTimeout(() => setSent(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Send Dispatch Email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transport Company</label>
            {companies.length === 0 ? (
              <p className="text-sm text-red-500">No transport companies. Add one in the Settings tab first.</p>
            ) : (
              <select value={selectedCompany} onChange={e => setSelectedCompany(Number(e.target.value))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                {companies.map((c, i) => (
                  <option key={i} value={i}>{c.name} ({c.email || 'no email'})</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Special Instructions</label>
            <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
              rows={3} placeholder="Any special delivery instructions..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Preview</label>
            <pre className="bg-gray-50 rounded-md p-4 text-xs text-gray-700 whitespace-pre-wrap max-h-60 overflow-y-auto border border-gray-200">{body}</pre>
          </div>
          <div className="flex gap-2 pt-2">
            {mailtoLink && (
              <a href={mailtoLink} target="_blank" rel="noopener noreferrer"
                className="flex-1 text-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                Open in Email Client
              </a>
            )}
            <button type="button" onClick={handleCopy}
              className="flex-1 rounded-md bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 border border-gray-300">
              {sent ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewDispatchModal({ isOpen, onClose, onCreated, deals, companies }) {
  const [form, setForm] = useState({
    deal_id: '', driver_vehicle: '', num_drivers_needed: 1, driver_name: '', driver_phone: '',
  });
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.deal_id) return;
    setSubmitting(true);
    try {
      const deal = deals.find(d => d.id === form.deal_id);
      const res = await fetch(SB_URL + '/rest/v1/dispatch_assignments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          deal_id: form.deal_id,
          driver_vehicle: form.driver_vehicle || null,
          num_drivers_needed: Number(form.num_drivers_needed) || 1,
          driver_name: form.driver_name || null,
          driver_phone: form.driver_phone || null,
          has_trade_in: deal ? deal.has_trade_in : false,
          status: 'pending',
        }),
      });
      if (!res.ok) throw new Error('Failed to create dispatch');
      onCreated();
      onClose();
      setForm({ deal_id: '', driver_vehicle: '', num_drivers_needed: 1, driver_name: '', driver_phone: '' });
    } catch (err) {
      alert('Error creating dispatch: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Create New Dispatch</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deal *</label>
            <select value={form.deal_id} onChange={e => setForm(p => ({...p, deal_id: e.target.value}))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" required>
              <option value="">Select a deal...</option>
              {deals.map(d => (
                <option key={d.id} value={d.id}>#{d.stock_number} - {d.customer_name} - {[d.year, d.make, d.model].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Transport Company</label>
            <select value={form.driver_vehicle} onChange={e => setForm(p => ({...p, driver_vehicle: e.target.value}))}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select company...</option>
              {companies.map((c, i) => <option key={i} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver Name</label>
              <input type="text" value={form.driver_name} onChange={e => setForm(p => ({...p, driver_name: e.target.value}))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver Phone</label>
              <input type="tel" value={form.driver_phone} onChange={e => setForm(p => ({...p, driver_phone: e.target.value}))}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Drivers Needed</label>
            <input type="number" min="1" max="5" value={form.num_drivers_needed}
              onChange={e => setForm(p => ({...p, num_drivers_needed: e.target.value}))}
              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={submitting || !form.deal_id}
              className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {submitting ? 'Creating...' : 'Create Dispatch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DispatchPipelineCard({ dispatch, deal, onStatusChange, onEmail }) {
  const vehicle = deal ? [deal.year, deal.make, deal.model].filter(Boolean).join(' ') : '-';
  const currentIdx = DISPATCH_STATUSES.indexOf(dispatch.status || 'pending');
  const nextStatus = DISPATCH_STATUSES[currentIdx + 1];
  const prevStatus = currentIdx > 0 ? DISPATCH_STATUSES[currentIdx - 1] : null;
  const formatDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

  return (
    <div className={'bg-white rounded-lg shadow-sm border-l-4 p-4 space-y-3 ' + (STATUS_COLORS[dispatch.status] || 'border-gray-300')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-mono text-gray-400">#{deal?.stock_number || '--'}</p>
          <h3 className="text-sm font-semibold text-gray-900 truncate">{deal?.customer_name || '-'}</h3>
          <p className="text-xs text-gray-500">{vehicle}</p>
        </div>
        <span className={'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border ' + (STATUS_COLORS[dispatch.status] || 'bg-gray-100')}>
          {STATUS_LABELS[dispatch.status] || dispatch.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div><span className="text-gray-400">Company</span><p className="text-gray-800 font-medium">{dispatch.driver_vehicle || '-'}</p></div>
        <div><span className="text-gray-400">Delivery Date</span><p className="text-gray-800 font-medium">{formatDate(deal?.tentative_delivery_date || deal?.delivery_date)}</p></div>
        <div><span className="text-gray-400">Driver</span><p className="text-gray-800 font-medium">{dispatch.driver_name || '-'}</p></div>
        <div><span className="text-gray-400">Drivers Needed</span><p className="text-gray-800 font-medium">{dispatch.num_drivers_needed || 1}</p></div>
        {deal?.delivery_address && <div className="col-span-2"><span className="text-gray-400">Delivery Address</span><p className="text-gray-800 font-medium">{deal.delivery_address}</p></div>}
        {deal?.pickup_location && <div className="col-span-2"><span className="text-gray-400">Pickup From</span><p className="text-gray-800 font-medium">{deal.pickup_location}</p></div>}
      </div>
      {dispatch.has_trade_in && (
        <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <p className="text-xs font-semibold text-amber-800">
            Trade-In: {deal ? [deal.trade_year, deal.trade_make, deal.trade_model].filter(Boolean).join(' ') : '-'}
            {deal?.trade_stock_number && <span className="ml-2 font-mono">#{deal.trade_stock_number}</span>}
          </p>
        </div>
      )}
      <div className="flex items-center gap-1 py-1">
        {DISPATCH_STATUSES.map((s, i) => (
          <div key={s} className="flex-1">
            <div className={'h-2 rounded-full ' + (i <= currentIdx ? 'bg-red-500' : 'bg-gray-200')} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        {prevStatus && (
          <button type="button" onClick={() => onStatusChange(dispatch.id, prevStatus)}
            className="flex-1 rounded-md bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200 border border-gray-300">
            Back to {STATUS_LABELS[prevStatus]}
          </button>
        )}
        {nextStatus && (
          <button type="button" onClick={() => onStatusChange(dispatch.id, nextStatus)}
            className="flex-1 rounded-md bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">
            {nextStatus === 'completed' ? 'Complete' : 'Move to ' + STATUS_LABELS[nextStatus]}
          </button>
        )}
        <button type="button" onClick={() => onEmail(dispatch, deal)}
          className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700" title="Send dispatch email">
          Email
        </button>
      </div>
    </div>
  );
}

const TABS = ['pipeline', 'settings'];

export default function DispatchDashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('pipeline');
  const [loading, setLoading] = useState(true);
  const [dispatches, setDispatches] = useState([]);
  const [deals, setDeals] = useState([]);
  const [companies, setCompanies] = useState(loadCompanies());
  const [showNewDispatch, setShowNewDispatch] = useState(false);
  const [emailModal, setEmailModal] = useState({ open: false, dispatch: null, deal: null });
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchDispatches = useCallback(async () => {
    try {
      const res = await fetch(SB_URL + '/rest/v1/dispatch_assignments?select=*&order=created_at.desc', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      if (res.ok) setDispatches(await res.json());
    } catch (err) { console.error('Error fetching dispatches:', err); }
  }, []);

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch(API_URL + '/deals');
      if (res.ok) setDeals(await res.json());
    } catch (err) { console.error('Error fetching deals:', err); }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchDispatches(), fetchDeals()]);
    setLoading(false);
  }, [fetchDispatches, fetchDeals]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const channel = supabase
      .channel('dispatch-realtime-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispatch_assignments' }, fetchDispatches)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, fetchDeals)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDispatches, fetchDeals]);

  const handleStatusChange = async (dispatchId, newStatus) => {
    try {
      const updates = { status: newStatus };
      if (newStatus === 'dispatched') updates.assigned_at = new Date().toISOString();
      if (newStatus === 'completed') updates.completed_at = new Date().toISOString();
      if (newStatus === 'in_transit') updates.actual_departure = new Date().toISOString();
      if (newStatus === 'delivered') updates.actual_arrival = new Date().toISOString();

      await fetch(SB_URL + '/rest/v1/dispatch_assignments?id=eq.' + dispatchId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=representation' },
        body: JSON.stringify(updates),
      });
      fetchDispatches();
    } catch (err) { console.error(err); }
  };

  const handleDeleteDispatch = async (dispatchId) => {
    if (!window.confirm('Delete this dispatch?')) return;
    try {
      await fetch(SB_URL + '/rest/v1/dispatch_assignments?id=eq.' + dispatchId, {
        method: 'DELETE',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
      });
      fetchDispatches();
    } catch (err) { console.error(err); }
  };

  const dealsMap = {};
  deals.forEach(d => { dealsMap[d.id] = d; });
  const dispatchedDealIds = new Set(dispatches.map(d => d.deal_id));
  const availableDeals = deals.filter(d => !dispatchedDealIds.has(d.id) && d.is_sold);
  const filteredDispatches = statusFilter === 'all' ? dispatches : dispatches.filter(d => d.status === statusFilter);
  const statusCounts = {};
  DISPATCH_STATUSES.forEach(s => { statusCounts[s] = 0; });
  dispatches.forEach(d => { if (statusCounts[d.status] !== undefined) statusCounts[d.status]++; });

  return (
    <div className="space-y-6">
      <NewDispatchModal isOpen={showNewDispatch} onClose={() => setShowNewDispatch(false)}
        onCreated={fetchAll} deals={availableDeals} companies={companies} />
      <DispatchEmailModal isOpen={emailModal.open}
        onClose={() => setEmailModal({ open: false, dispatch: null, deal: null })}
        dispatch={emailModal.dispatch} deal={emailModal.deal} companies={companies} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dispatch Management</h1>
        <button type="button" onClick={() => setShowNewDispatch(true)}
          className="rounded-md bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700">
          + New Dispatch
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {DISPATCH_STATUSES.map(s => (
          <button key={s} type="button" onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            className={'rounded-lg p-3 text-center transition-all border-2 ' +
              (statusFilter === s ? 'ring-2 ring-red-500 border-red-300' : 'border-transparent hover:border-gray-200') +
              ' ' + STATUS_COLORS[s]}>
            <p className="text-2xl font-bold">{statusCounts[s]}</p>
            <p className="text-xs font-medium mt-0.5">{STATUS_LABELS[s]}</p>
          </button>
        ))}
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex -mb-px space-x-6">
          {TABS.map(tab => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)}
              className={'whitespace-nowrap pb-3 px-1 text-sm font-medium border-b-2 transition-colors ' +
                (activeTab === tab ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              {tab === 'pipeline' ? 'Dispatch Pipeline' : 'Settings & Companies'}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-red-600" />
        </div>
      ) : (
        <>
          {activeTab === 'pipeline' && (
            filteredDispatches.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-500 text-lg font-medium">No dispatches yet</p>
                <p className="text-gray-400 text-sm mt-1">Click "+ New Dispatch" to create one</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredDispatches.map(d => (
                  <div key={d.id} className="relative group">
                    <DispatchPipelineCard dispatch={d} deal={dealsMap[d.deal_id]}
                      onStatusChange={handleStatusChange}
                      onEmail={(dispatch, deal) => setEmailModal({ open: true, dispatch, deal })} />
                    <button type="button" onClick={() => handleDeleteDispatch(d.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                      title="Delete dispatch">&times;</button>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'settings' && (
            <TransportCompanies companies={companies} setCompanies={setCompanies} />
          )}
        </>
      )}
    </div>
  );
}
