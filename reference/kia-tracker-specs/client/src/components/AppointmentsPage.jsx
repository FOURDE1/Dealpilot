import { useState, useMemo, useCallback, useEffect, useRef, Component } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek as dfnsStartOfWeek, getDay, addMinutes } from 'date-fns';
import enUS from 'date-fns/locale/en-US';
import fr from 'date-fns/locale/fr';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { useSearchParams } from 'react-router-dom';
import { supabase as supabaseClient } from '../supabaseClient';
import {
  Plus, Car, Building, Phone, Users, X, AlertTriangle,
  Search, Filter, ChevronDown, Clock, MapPin, User, Loader2,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;
const DnDCalendar = withDragAndDrop(Calendar);

const locales = { 'en-US': enUS, fr };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: dfnsStartOfWeek, getDay, locales });

const TYPE_CONFIG = {
  test_drive:     { icon: Car,      label: 'Test Drive',     bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    color: '#3B82F6' },
  showroom_visit: { icon: Building, label: 'Showroom Visit', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', color: '#10B981' },
  follow_up:      { icon: Users,    label: 'Follow-Up',      bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   color: '#F59E0B' },
  phone_call:     { icon: Phone,    label: 'Phone Call',      bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  color: '#8B5CF6' },
};

const STATUS_COLORS = {
  scheduled:   { bg: '#E2E8F0', text: '#475569' },
  confirmed:   { bg: '#DBEAFE', text: '#1D4ED8' },
  showed:      { bg: '#D1FAE5', text: '#065F46' },
  rescheduled: { bg: '#F3E8FF', text: '#7C3AED' },
  cancelled:   { bg: '#FEE2E2', text: '#DC2626' },
  no_show:     { bg: '#FFEDD5', text: '#C2410C' },
};

const STATUS_STYLES = {
  scheduled:   'bg-slate-100 text-slate-700',
  confirmed:   'bg-blue-100 text-blue-700',
  showed:      'bg-emerald-100 text-emerald-700',
  rescheduled: 'bg-purple-100 text-purple-700',
  cancelled:   'bg-zinc-100 text-zinc-500',
  no_show:     'bg-red-100 text-red-700',
};

const DURATION_DEFAULTS = { phone_call: 15, follow_up: 30, showroom_visit: 45, test_drive: 45 };
const DURATION_OPTIONS = [15, 30, 45, 60, 90];

const VALID_TRANSITIONS = {
  scheduled:   ['confirmed', 'rescheduled', 'cancelled', 'no_show', 'showed'],
  confirmed:   ['showed', 'no_show', 'rescheduled', 'cancelled'],
  rescheduled: ['scheduled', 'cancelled'],
  showed:      [],
  no_show:     [],
  cancelled:   [],
};

function toLocalIso(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function nextSlot() {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 30) * 30, 0, 0);
  if (d <= new Date()) d.setMinutes(d.getMinutes() + 30);
  return d;
}

function customerName(appt) {
  const c = appt.contacts || appt.contact;
  if (c?.first_name) return `${c.first_name} ${c.last_name || ''}`.trim();
  const l = appt.leads || appt.lead;
  if (l?.first_name) return `${l.first_name} ${l.last_name || ''}`.trim();
  return '';
}

function vehicleStub(appt) {
  const v = appt.inventory || appt.vehicle;
  if (!v) return '';
  return `${v.year ? "'" + String(v.year).slice(-2) : ''} ${v.model || v.make || ''}`.trim();
}

// --- Custom Event Component for the calendar ---
function EventCard({ event }) {
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.follow_up;
  const Icon = cfg.icon;
  const name = customerName(event.resource);
  const veh = vehicleStub(event.resource);
  return (
    <div className="flex items-center gap-1 text-[11px] leading-tight overflow-hidden">
      <Icon size={11} className="shrink-0" />
      <span className="truncate font-medium">
        {event.title}
        {name && <span className="font-normal opacity-80"> · {name}</span>}
        {veh && <span className="font-normal opacity-70"> · {veh}</span>}
      </span>
    </div>
  );
}

class ModalErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm text-center">
            <p className="text-sm text-red-600 font-medium mb-3">Something went wrong in the booking modal.</p>
            <button onClick={() => { this.setState({ error: null }); this.props.onClose?.(); }}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm">Close</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Booking Modal ---
function BookingModal({ isOpen, onClose, onSave, isPending, conflicts, apiError: parentApiError, initialSlot, editAppt }) {
  const { t } = useTranslation();
  const isEdit = !!editAppt;
  const titleRef = useRef(null);
  const [titleTouched, setTitleTouched] = useState(false);

  const defaultStart = initialSlot?.start || (editAppt ? new Date(editAppt.start_time) : nextSlot());
  const defaultEnd = initialSlot?.end || (editAppt ? new Date(editAppt.end_time) : addMinutes(defaultStart, 45));

  const [form, setForm] = useState({
    title: editAppt?.title || '',
    type: editAppt?.type || 'test_drive',
    start_time: toLocalIso(defaultStart),
    end_time: toLocalIso(defaultEnd),
    description: editAppt?.description || '',
    location: editAppt?.location || 'Kia Mont-Laurier Showroom',
    contact_id: editAppt?.contact_id || '',
    lead_id: editAppt?.lead_id || '',
    vehicle_id: editAppt?.vehicle_id || '',
    assigned_to: editAppt?.assigned_to || '',
    store_id: editAppt?.store_id || '',
  });
  const [duration, setDuration] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState([]);
  const [clientLoading, setClientLoading] = useState(false);
  const [selectedClient, setSelectedClient] = useState(
    editAppt?.contacts ? { kind: 'contact', ...editAppt.contacts, id: editAppt.contact_id } :
    editAppt?.leads ? { kind: 'lead', ...editAppt.leads, id: editAppt.lead_id } : null
  );
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [vehicleResults, setVehicleResults] = useState([]);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState(
    editAppt?.inventory ? { ...editAppt.inventory, id: editAppt.vehicle_id } : null
  );
  const [apiError, setApiError] = useState(null);
  const [authUser, setAuthUser] = useState(null);

  const { data: users = [] } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => { const r = await fetch(`${API_URL}/users`); return r.ok ? r.json() : []; },
    staleTime: 60000,
  });
  const { data: stores = [] } = useQuery({
    queryKey: ['stores'],
    queryFn: async () => { const r = await fetch(`${API_URL}/stores`); return r.ok ? r.json() : []; },
    staleTime: 60000,
  });

  // Fetch auth user once on mount
  useEffect(() => {
    supabaseClient.auth.getUser().then(({ data }) => setAuthUser(data?.user ?? null)).catch(() => {});
  }, []);

  // Default salesperson to current user (match auth user → users table)
  useEffect(() => {
    if (!authUser || users.length === 0) return;
    if (form.assigned_to || isEdit) return;
    const match = users.find(u => u.id === authUser.id) ||
                  users.find(u => u.email === authUser.email);
    if (match) setForm(f => f.assigned_to ? f : { ...f, assigned_to: match.id });
  }, [authUser, users]);

  // Client typeahead
  const clientDebounce = useRef(null);
  useEffect(() => {
    if (clientSearch.length < 2) { setClientResults([]); return; }
    if (clientDebounce.current) clearTimeout(clientDebounce.current);
    clientDebounce.current = setTimeout(async () => {
      setClientLoading(true);
      try {
        const [cRes, lRes] = await Promise.all([
          fetch(`${API_URL}/contacts/search?q=${encodeURIComponent(clientSearch)}`),
          fetch(`${API_URL}/leads?search=${encodeURIComponent(clientSearch)}`),
        ]);
        const cJson = cRes.ok ? await cRes.json() : {};
        const contacts = (cJson.data ?? (Array.isArray(cJson) ? cJson : [])).map(c => ({ ...c, kind: 'contact' }));
        const lJson = lRes.ok ? await lRes.json() : {};
        const leads = (lJson.data ?? (Array.isArray(lJson) ? lJson : [])).map(l => ({ ...l, kind: 'lead' }));
        setClientResults([...contacts, ...leads].slice(0, 15));
      } catch { setClientResults([]); }
      setClientLoading(false);
    }, 250);
  }, [clientSearch]);

  // Vehicle typeahead
  const vehDebounce = useRef(null);
  useEffect(() => {
    if (vehicleSearch.length < 2) { setVehicleResults([]); return; }
    if (vehDebounce.current) clearTimeout(vehDebounce.current);
    vehDebounce.current = setTimeout(async () => {
      setVehicleLoading(true);
      try {
        const r = await fetch(`${API_URL}/inventory?search=${encodeURIComponent(vehicleSearch)}`);
        const json = r.ok ? await r.json() : [];
        setVehicleResults(json.data ?? (Array.isArray(json) ? json : []));
      } catch { setVehicleResults([]); }
      setVehicleLoading(false);
    }, 250);
  }, [vehicleSearch]);

  // Smart title prefill
  useEffect(() => {
    if (titleTouched || isEdit) return;
    const cfg = TYPE_CONFIG[form.type];
    const parts = [cfg?.label || ''];
    if (selectedVehicle) parts.push(`${selectedVehicle.year || ''} ${selectedVehicle.make || ''} ${selectedVehicle.model || ''}`.trim());
    if (selectedClient) parts.push(`${selectedClient.first_name || ''} ${selectedClient.last_name || ''}`.trim());
    setForm(f => ({ ...f, title: parts.filter(Boolean).join(' — ') }));
  }, [form.type, selectedClient, selectedVehicle, titleTouched, isEdit]);

  // Duration → End time
  const applyDuration = (mins) => {
    setDuration(mins);
    const start = new Date(form.start_time);
    setForm(f => ({ ...f, end_time: toLocalIso(addMinutes(start, mins)) }));
  };

  // Type change → default duration (skip if slot was clicked with specific times)
  const hasInitialSlot = !!(initialSlot?.start && initialSlot?.end);
  const [typeChanged, setTypeChanged] = useState(false);
  useEffect(() => {
    if (isEdit) return;
    if (hasInitialSlot && !typeChanged) return;
    const d = DURATION_DEFAULTS[form.type] || 30;
    applyDuration(d);
  }, [form.type]);

  const handleSave = () => {
    setApiError(null);
    const payload = {
      ...form,
      start_time: new Date(form.start_time).toISOString(),
      end_time: new Date(form.end_time).toISOString(),
      contact_id: selectedClient?.kind === 'contact' ? selectedClient.id : null,
      lead_id: selectedClient?.kind === 'lead' ? selectedClient.id : null,
      vehicle_id: selectedVehicle?.id || null,
      assigned_to: form.assigned_to || null,
      store_id: form.store_id || null,
    };
    onSave(payload, isEdit ? editAppt.id : null);
  };

  const canSave = form.title && form.start_time && form.end_time && selectedClient &&
    (form.type !== 'test_drive' || selectedVehicle);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'Edit Appointment' : t('appointments.book')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* API Error */}
          {(apiError || parentApiError) && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              <p className="font-medium">Couldn't book: {apiError || parentApiError}</p>
            </div>
          )}
          {/* Conflicts */}
          {conflicts && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Scheduling conflict</p>
                  {(conflicts.salesperson_conflicts || conflicts.conflicts || []).map(c => (
                    <p key={c.id} className="text-xs mt-1">Salesperson: {c.title} ({format(new Date(c.start_time), 'h:mm a')} – {format(new Date(c.end_time), 'h:mm a')})</p>
                  ))}
                  {(conflicts.vehicle_conflicts || []).map(c => (
                    <p key={c.id} className="text-xs mt-1">Vehicle: {c.title} ({format(new Date(c.start_time), 'h:mm a')} – {format(new Date(c.end_time), 'h:mm a')})</p>
                  ))}
                  <button onClick={() => {
                    setApiError(null);
                    const payload = {
                      ...form, force: true,
                      start_time: new Date(form.start_time).toISOString(),
                      end_time: new Date(form.end_time).toISOString(),
                      contact_id: selectedClient?.kind === 'contact' ? selectedClient.id : null,
                      lead_id: selectedClient?.kind === 'lead' ? selectedClient.id : null,
                      vehicle_id: selectedVehicle?.id || null,
                      assigned_to: form.assigned_to || null,
                      store_id: form.store_id || null,
                    };
                    onSave(payload, isEdit ? editAppt.id : null);
                  }} className="mt-2 px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700">
                    Book anyway
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Customer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer *</label>
            {selectedClient ? (
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <span className="text-sm font-medium">{selectedClient.first_name} {selectedClient.last_name}</span>
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600">{selectedClient.kind}</span>
                </div>
                <button onClick={() => { setSelectedClient(null); setClientSearch(''); }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                  placeholder="Search contacts or leads..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
                {clientResults.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {clientResults.map(c => (
                      <button key={`${c.kind}-${c.id}`} onClick={() => {
                        setSelectedClient(c);
                        setForm(f => ({ ...f, contact_id: c.kind === 'contact' ? c.id : '', lead_id: c.kind === 'lead' ? c.id : '' }));
                        setClientSearch(''); setClientResults([]);
                      }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                        <span className="font-medium">{c.first_name} {c.last_name}</span>
                        <span className="ml-2 text-[10px] text-gray-400">{c.kind}</span>
                        <span className="block text-xs text-gray-500">{[c.email, c.phone].filter(Boolean).join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                )}
                {clientLoading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
              </div>
            )}
          </div>

          {/* Vehicle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Vehicle {form.type === 'test_drive' ? '*' : '(optional)'}
            </label>
            {selectedVehicle ? (
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-sm font-medium">#{selectedVehicle.stock_number} — {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}</span>
                <button onClick={() => { setSelectedVehicle(null); setVehicleSearch(''); }} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value)}
                  onKeyDown={e => e.stopPropagation()}
                  placeholder="Search by stock #, VIN, make, model..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
                {vehicleResults.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {vehicleResults.map(v => (
                      <button key={v.id} onClick={() => {
                        setSelectedVehicle(v);
                        setForm(f => ({ ...f, vehicle_id: v.id }));
                        setVehicleSearch(''); setVehicleResults([]);
                      }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                        <span className="font-medium">#{v.stock_number}</span>
                        <span className="ml-2 text-gray-600">{v.year} {v.make} {v.model}</span>
                      </button>
                    ))}
                  </div>
                )}
                {vehicleLoading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />}
              </div>
            )}
          </div>

          {/* Type + Salesperson */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={form.type} onChange={e => { setTypeChanged(true); setForm(f => ({ ...f, type: e.target.value })); }}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Salesperson</label>
              <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <option value="">— Select —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input ref={titleRef} type="text" value={form.title}
              onChange={e => { setTitleTouched(true); setForm(f => ({ ...f, title: e.target.value })); }}
              onKeyDown={e => e.stopPropagation()}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
          </div>

          {/* Store + Location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Store</label>
              <select value={form.store_id} onChange={e => setForm(f => ({ ...f, store_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                <option value="">— Select —</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <input type="text" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                onKeyDown={e => e.stopPropagation()}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            </div>
          </div>

          {/* Start + End */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
              <input type="datetime-local" value={form.start_time}
                onChange={e => {
                  setForm(f => ({ ...f, start_time: e.target.value }));
                  if (duration) setForm(f => ({ ...f, end_time: toLocalIso(addMinutes(new Date(e.target.value), duration)) }));
                }}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
              <input type="datetime-local" value={form.end_time}
                onChange={e => { setDuration(null); setForm(f => ({ ...f, end_time: e.target.value })); }}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
            </div>
          </div>

          {/* Duration shortcuts */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 mr-1">Duration:</span>
            {DURATION_OPTIONS.map(m => (
              <button key={m} type="button" onClick={() => applyDuration(m)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  duration === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {m}m
              </button>
            ))}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              onKeyDown={e => e.stopPropagation()}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-y" />
          </div>

          {/* Status (edit mode only) */}
          {isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <div className="flex flex-wrap gap-1.5">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_STYLES[editAppt.status]}`}>
                  {editAppt.status.toUpperCase().replace('_', ' ')}
                </span>
                {(VALID_TRANSITIONS[editAppt.status] || []).map(s => (
                  <button key={s} onClick={() => onSave({ status: s }, editAppt.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_STYLES[s]} hover:opacity-80`}>
                    → {s.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          {!isEdit && (
            <button disabled={!canSave || isPending} onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {isPending ? '...' : 'Book'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---
export default function AppointmentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [modal, setModal] = useState(false);
  const [modalKey, setModalKey] = useState(0);
  const [editAppt, setEditAppt] = useState(null);
  const [initialSlot, setInitialSlot] = useState(null);
  const [conflicts, setConflicts] = useState(null);
  const [apiError, setApiError] = useState(null);
  const [currentView, setCurrentView] = useState(Views.WEEK);
  const [currentDate, setCurrentDate] = useState(() => new Date());

  // Filters
  const [filters, setFiltersRaw] = useState({
    assigned_to: searchParams.get('sp') || '',
    type: searchParams.get('type') || '',
    status: searchParams.get('status') || '',
    search: searchParams.get('q') || '',
  });
  const setFilters = useCallback((updater) => {
    setFiltersRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      const params = new URLSearchParams();
      if (next.assigned_to) params.set('sp', next.assigned_to);
      if (next.type) params.set('type', next.type);
      if (next.status) params.set('status', next.status);
      if (next.search) params.set('q', next.search);
      setSearchParams(params, { replace: true });
      return next;
    });
  }, [setSearchParams]);

  const viewRange = useMemo(() => {
    const d = new Date(currentDate);
    let start, end;
    if (currentView === Views.MONTH) {
      start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      end = new Date(d.getFullYear(), d.getMonth() + 2, 0);
    } else if (currentView === Views.WEEK) {
      const day = d.getDay();
      start = new Date(d); start.setDate(d.getDate() - day); start.setHours(0, 0, 0, 0);
      end = new Date(start); end.setDate(start.getDate() + 7);
    } else {
      start = new Date(d); start.setHours(0, 0, 0, 0);
      end = new Date(d); end.setDate(d.getDate() + 1);
    }
    return { start, end };
  }, [currentDate, currentView]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('start', viewRange.start.toISOString());
    p.set('end', viewRange.end.toISOString());
    if (filters.assigned_to) p.set('assigned_to', filters.assigned_to);
    if (filters.type) p.set('type', filters.type);
    if (filters.status) p.set('status', filters.status);
    return p.toString();
  }, [viewRange, filters.assigned_to, filters.type, filters.status]);

  const { data: rawAppointments = [] } = useQuery({
    queryKey: ['appointments', queryParams],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/appointments?${queryParams}`);
      return r.ok ? r.json() : [];
    },
  });

  const { data: usersForFilter = [] } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => { const r = await fetch(`${API_URL}/users`); return r.ok ? r.json() : []; },
    staleTime: 60000,
  });

  const appointments = useMemo(() => {
    let list = rawAppointments;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(a => {
        const name = customerName(a);
        return a.title?.toLowerCase().includes(q) || name.toLowerCase().includes(q);
      });
    }
    return list;
  }, [rawAppointments, filters.search]);

  const events = useMemo(() =>
    appointments.map(a => ({
      id: a.id,
      title: a.title,
      start: new Date(a.start_time),
      end: new Date(a.end_time),
      type: a.type,
      status: a.status,
      resource: a,
    })),
  [appointments]);

  const createMutation = useMutation({
    mutationFn: async ({ payload, id }) => {
      const url = id ? `${API_URL}/appointments/${id}` : `${API_URL}/appointments`;
      const method = id ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.status === 409) {
        setConflicts(data);
        throw new Error('conflict');
      }
      if (!res.ok) throw new Error(data.error || data.detail || 'Failed');
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setModal(false); setEditAppt(null); setConflicts(null); setInitialSlot(null); setApiError(null);
    },
    onError: (err) => {
      if (err.message === 'conflict') {
        setApiError(null);
      } else {
        setApiError(err.message);
      }
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ id, start_time, end_time }) => {
      const res = await fetch(`${API_URL}/appointments/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time, end_time }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });

  const handleSave = (payload, id) => {
    createMutation.mutate({ payload, id });
  };

  const handleSelectSlot = useCallback(({ start, end }) => {
    setInitialSlot({ start, end });
    setEditAppt(null); setConflicts(null); setModalKey(k => k + 1); setApiError(null); setModal(true);
  }, []);

  const handleSelectEvent = useCallback((event) => {
    setEditAppt(event.resource);
    setInitialSlot(null); setConflicts(null); setModalKey(k => k + 1); setApiError(null); setModal(true);
  }, []);

  const handleEventDrop = useCallback(({ event, start, end }) => {
    moveMutation.mutate({ id: event.id, start_time: start.toISOString(), end_time: end.toISOString() });
  }, [moveMutation]);

  const handleEventResize = useCallback(({ event, start, end }) => {
    moveMutation.mutate({ id: event.id, start_time: start.toISOString(), end_time: end.toISOString() });
  }, [moveMutation]);

  const eventPropGetter = useCallback((event) => {
    const sc = STATUS_COLORS[event.status] || STATUS_COLORS.scheduled;
    const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.follow_up;
    const isMuted = event.status === 'cancelled' || event.status === 'no_show';
    return {
      style: {
        backgroundColor: sc.bg,
        borderLeft: `3px solid ${isMuted ? sc.text : cfg.color}`,
        color: sc.text,
        borderRadius: '4px',
        fontSize: '11px',
        padding: '2px 4px',
        opacity: isMuted ? 0.7 : 1,
      },
    };
  }, []);

  const dealerOpen = useMemo(() => { const d = new Date(); d.setHours(7, 0, 0, 0); return d; }, []);
  const dealerClose = useMemo(() => { const d = new Date(); d.setHours(21, 0, 0, 0); return d; }, []);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('appointments.title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{t('appointments.subtitle')}</p>
        </div>
        <button onClick={() => { setConflicts(null); setEditAppt(null); setInitialSlot(null); setModalKey(k => k + 1); setApiError(null); setModal(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
          <Plus size={16} /> {t('appointments.book')}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-white rounded-lg border border-gray-200">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder="Search appointments..." className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
        <select value={filters.assigned_to} onChange={e => setFilters(f => ({ ...f, assigned_to: e.target.value }))}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
          <option value="">All Salespeople</option>
          {usersForFilter.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
          <option value="">All Types</option>
          {Object.entries(TYPE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
          <option value="">All Statuses</option>
          {Object.keys(STATUS_STYLES).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      {/* Calendar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-2" style={{ height: 700 }}>
        <DnDCalendar
          localizer={localizer}
          events={events}
          defaultView={Views.WEEK}
          view={currentView}
          onView={setCurrentView}
          date={currentDate}
          onNavigate={setCurrentDate}
          views={[Views.DAY, Views.WEEK, Views.MONTH, Views.AGENDA]}
          step={15}
          timeslots={4}
          min={dealerOpen}
          max={dealerClose}
          selectable
          resizable
          draggableAccessor={() => true}
          resizableAccessor={() => true}
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          onEventDrop={handleEventDrop}
          onEventResize={handleEventResize}
          eventPropGetter={eventPropGetter}
          components={{ event: EventCard }}
          messages={{
            today: 'Today',
            previous: 'Back',
            next: 'Next',
            month: 'Month',
            week: 'Week',
            day: 'Day',
            agenda: 'Agenda',
            noEventsInRange: 'No appointments in this range.',
          }}
        />
      </div>

      <ModalErrorBoundary key={modalKey} onClose={() => { setModal(false); setEditAppt(null); setConflicts(null); setInitialSlot(null); setApiError(null); }}>
        <BookingModal
          isOpen={modal}
          onClose={() => { setModal(false); setEditAppt(null); setConflicts(null); setInitialSlot(null); setApiError(null); }}
          onSave={handleSave}
          isPending={createMutation.isPending}
          conflicts={conflicts}
          apiError={apiError}
          initialSlot={initialSlot}
          editAppt={editAppt}
        />
      </ModalErrorBoundary>
    </div>
  );
}
