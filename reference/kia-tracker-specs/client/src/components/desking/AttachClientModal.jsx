import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, UserPlus, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL;

export default function AttachClientModal({ open, onClose, dealId, role = 'buyer', onAttached }) {
  const [tab, setTab] = useState('contacts');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [confirmLead, setConfirmLead] = useState(null);
  const [attaching, setAttaching] = useState(false);
  const [createForm, setCreateForm] = useState({ first_name: '', last_name: '', email: '', phone: '' });

  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // Reset state when modal opens/closes or tab changes
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setShowCreateForm(false);
      setConfirmLead(null);
      setCreateForm({ first_name: '', last_name: '', email: '', phone: '' });
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    setQuery('');
    setResults([]);
    setConfirmLead(null);
  }, [tab]);

  // Debounced search
  const search = useCallback(async (term) => {
    if (!term || term.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      if (tab === 'contacts') {
        const res = await fetch(`${API_URL}/contacts/search?q=${encodeURIComponent(term)}`);
        if (!res.ok) throw new Error('Search failed');
        const json = await res.json();
        setResults(json.data ?? (Array.isArray(json) ? json : []));
      } else {
        const res = await fetch(`${API_URL}/leads?search=${encodeURIComponent(term)}`);
        if (!res.ok) throw new Error('Search failed');
        const json = await res.json();
        setResults(json.data ?? (Array.isArray(json) ? json : []));
      }
    } catch (err) {
      alert('Search error: ' + err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, search]);

  // Sync deal_parties buyer → legacy deal columns via dedicated server endpoint
  async function syncCustomerToDeal() {
    try {
      await fetch(`${API_URL}/deals/${dealId}/sync-customer`, { method: 'POST' });
    } catch (e) {
      console.error('sync-customer failed:', e);
    }
  }

  // Attach a contact to deal_parties + sync legacy deal columns
  async function attachContact(contactId) {
    setAttaching(true);
    try {
      // Remove existing party with same role
      await supabase
        .from('deal_parties')
        .delete()
        .eq('deal_id', dealId)
        .eq('role', role);

      const { error } = await supabase
        .from('deal_parties')
        .insert({ deal_id: dealId, contact_id: contactId, role });

      if (error) throw error;

      // Mirror buyer to legacy deal columns
      if (role === 'buyer') await syncCustomerToDeal();

      onAttached?.();
      onClose?.();
    } catch (err) {
      alert('Failed to attach client: ' + (err.message || err));
    } finally {
      setAttaching(false);
    }
  }

  // Handle clicking a contact row
  function handleContactClick(contact) {
    attachContact(contact.id);
  }

  // Handle clicking a lead row — show confirmation
  function handleLeadClick(lead) {
    setConfirmLead(lead);
  }

  // Convert lead to contact, then attach
  async function confirmConvertLead() {
    if (!confirmLead) return;
    setAttaching(true);
    try {
      const res = await fetch(`${API_URL}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: confirmLead.first_name,
          last_name: confirmLead.last_name,
          email: confirmLead.email,
          phone: confirmLead.phone,
        }),
      });
      if (!res.ok) throw new Error('Failed to create contact from lead');
      const newContact = await res.json();
      await attachContact(newContact.id);
    } catch (err) {
      alert('Failed to convert lead: ' + (err.message || err));
      setAttaching(false);
    }
  }

  // Create new contact from inline form, then attach
  async function handleCreateAndAttach(e) {
    e.preventDefault();
    if (!createForm.first_name || !createForm.last_name) {
      alert('First and last name are required.');
      return;
    }
    setAttaching(true);
    try {
      const res = await fetch(`${API_URL}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (!res.ok) throw new Error('Failed to create contact');
      const newContact = await res.json();
      await attachContact(newContact.id);
    } catch (err) {
      alert('Failed to create contact: ' + (err.message || err));
      setAttaching(false);
    }
  }

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-gray-800 to-gray-900 text-white">
          <h2 className="text-base font-semibold">
            Attach {role === 'cosigner' ? 'Co-signer' : 'Buyer'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {/* Tabs */}
          <div className="flex gap-2">
            {['contacts', 'leads'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                  tab === t
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === 'contacts' ? 'Contacts' : 'Leads'}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder={`Search ${tab}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
            />
            {loading && (
              <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
            )}
          </div>

          {/* Lead conversion confirmation */}
          {confirmLead && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
              <p className="text-sm text-amber-800">
                Convert this lead to a contact and attach?
              </p>
              <p className="text-sm font-medium text-gray-800">
                {confirmLead.first_name} {confirmLead.last_name}
                {confirmLead.email && <span className="text-gray-500 font-normal"> &middot; {confirmLead.email}</span>}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={confirmConvertLead}
                  disabled={attaching}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {attaching ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  Convert &amp; Attach
                </button>
                <button
                  onClick={() => setConfirmLead(null)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Results */}
          {!confirmLead && (
            <div className="max-h-60 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {results.length === 0 && query.length >= 2 && !loading && (
                <p className="text-sm text-gray-400 text-center py-6">No results found</p>
              )}
              {results.length === 0 && query.length < 2 && !loading && (
                <p className="text-sm text-gray-400 text-center py-6">Type at least 2 characters to search</p>
              )}
              {results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => tab === 'contacts' ? handleContactClick(item) : handleLeadClick(item)}
                  disabled={attaching}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <p className="text-sm font-medium text-gray-800">
                    {item.first_name} {item.last_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {[item.email, item.phone].filter(Boolean).join(' \u00B7 ') || 'No contact info'}
                  </p>
                </button>
              ))}
            </div>
          )}

          {/* Footer: Create new contact */}
          {!confirmLead && (
            <div className="border-t border-gray-100 pt-3">
              {!showCreateForm ? (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-medium transition-colors"
                >
                  <UserPlus size={15} />
                  + Add new contact
                </button>
              ) : (
                <form onSubmit={handleCreateAndAttach} onKeyDown={(e) => e.stopPropagation()} className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="First name *"
                      value={createForm.first_name}
                      onChange={(e) => setCreateForm((f) => ({ ...f, first_name: e.target.value }))}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                    />
                    <input
                      type="text"
                      placeholder="Last name *"
                      value={createForm.last_name}
                      onChange={(e) => setCreateForm((f) => ({ ...f, last_name: e.target.value }))}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="email"
                      placeholder="Email"
                      value={createForm.email}
                      onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                    />
                    <input
                      type="tel"
                      placeholder="Phone"
                      value={createForm.phone}
                      onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={attaching}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {attaching ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                      Create &amp; Attach
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateForm(false)}
                      className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Attaching overlay */}
      {attaching && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 rounded-xl">
          <Loader2 size={24} className="text-red-600 animate-spin" />
        </div>
      )}
    </div>
  );
}
