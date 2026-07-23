import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Plus, Phone, Mail, MapPin, ChevronLeft, ChevronRight } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;
const PAGE_SIZE = 20;

function ContactCard({ contact, onClick }) {
  const { t } = useTranslation();
  const fullName = `${contact.first_name} ${contact.last_name}`.trim();

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[var(--color-text)] truncate">{fullName}</h3>
          <div className="mt-1 space-y-1">
            {contact.phone && (
              <div className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
                <Phone size={14} />
                <span>{contact.phone}</span>
              </div>
            )}
            {contact.email && (
              <div className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
                <Mail size={14} />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
            {contact.city && (
              <div className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
                <MapPin size={14} />
                <span>{contact.city}{contact.province ? `, ${contact.province}` : ''}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 ml-3">
          {contact.source && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
              {t(`contacts.source.${contact.source}`)}
            </span>
          )}
          {contact.lifetime_deals > 0 && (
            <span className="text-xs text-[var(--color-text-secondary)]">
              {contact.lifetime_deals} {t('contacts.deals')}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function CreateContactModal({ isOpen, onClose, onCreated }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    city: '', province: 'QC', source: 'walk_in', preferred_language: 'fr',
  });
  const [duplicates, setDuplicates] = useState(null);

  const createMutation = useMutation({
    mutationFn: async ({ force } = {}) => {
      const url = force ? `${API_URL}/contacts/force` : `${API_URL}/contacts`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.status === 409) {
        setDuplicates(data.duplicates);
        throw new Error('duplicates');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to create contact');
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      setFormData({ first_name: '', last_name: '', email: '', phone: '', city: '', province: 'QC', source: 'walk_in', preferred_language: 'fr' });
      setDuplicates(null);
      onCreated?.(data);
      onClose();
    },
  });

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setDuplicates(null);
    createMutation.mutate();
  };

  const handleForceCreate = () => {
    setDuplicates(null);
    createMutation.mutate({ force: true });
  };

  const field = (name, label, type = 'text') => (
    <div>
      <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
      <input
        type={type}
        value={formData[name]}
        onChange={(e) => setFormData(prev => ({ ...prev, [name]: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--color-card)] rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">{t('contacts.createTitle')}</h2>

          {duplicates && (
            <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400 mb-2">{t('contacts.duplicatesFound')}</p>
              {duplicates.map(d => (
                <p key={d.id} className="text-sm text-[var(--color-text-secondary)]">
                  {d.first_name} {d.last_name} — {d.match_type === 'phone' ? d.phone : d.email}
                </p>
              ))}
              <button
                onClick={handleForceCreate}
                className="mt-2 text-sm px-3 py-1 rounded bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/30"
              >
                {t('contacts.createAnyway')}
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field('first_name', t('contacts.firstName'))}
              {field('last_name', t('contacts.lastName'))}
            </div>
            {field('phone', t('contacts.phone'), 'tel')}
            {field('email', t('contacts.email'), 'email')}
            <div className="grid grid-cols-2 gap-3">
              {field('city', t('contacts.city'))}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('contacts.province')}</label>
                <select
                  value={formData.province}
                  onChange={(e) => setFormData(prev => ({ ...prev, province: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
                >
                  <option value="QC">Québec</option>
                  <option value="ON">Ontario</option>
                  <option value="NB">New Brunswick</option>
                  <option value="NS">Nova Scotia</option>
                  <option value="PE">PEI</option>
                  <option value="NL">Newfoundland</option>
                  <option value="MB">Manitoba</option>
                  <option value="SK">Saskatchewan</option>
                  <option value="AB">Alberta</option>
                  <option value="BC">British Columbia</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('contacts.source.label')}</label>
                <select
                  value={formData.source}
                  onChange={(e) => setFormData(prev => ({ ...prev, source: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
                >
                  <option value="walk_in">{t('contacts.source.walk_in')}</option>
                  <option value="phone">{t('contacts.source.phone')}</option>
                  <option value="web">{t('contacts.source.web')}</option>
                  <option value="referral">{t('contacts.source.referral')}</option>
                  <option value="repeat">{t('contacts.source.repeat')}</option>
                  <option value="other">{t('contacts.source.other')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('contacts.language')}</label>
                <select
                  value={formData.preferred_language}
                  onChange={(e) => setFormData(prev => ({ ...prev, preferred_language: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={() => { onClose(); setDuplicates(null); }}
                className="flex-1 px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)]"
              >
                {t('contacts.cancel')}
              </button>
              <button
                type="submit"
                disabled={!formData.first_name || !formData.last_name || createMutation.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {createMutation.isPending ? '...' : t('contacts.create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', { search, source: sourceFilter, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (sourceFilter) params.set('source', sourceFilter);
      params.set('limit', PAGE_SIZE);
      params.set('offset', page * PAGE_SIZE);
      const res = await fetch(`${API_URL}/contacts?${params}`);
      if (!res.ok) throw new Error('Failed to fetch contacts');
      return res.json();
    },
  });

  const contacts = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Users size={24} className="text-[var(--color-accent)]" />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('contacts.title')}</h1>
          <span className="text-sm text-[var(--color-text-secondary)]">({total})</span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90"
        >
          <Plus size={18} />
          {t('contacts.addContact')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            type="text"
            placeholder={t('contacts.searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(0); }}
          className="px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
        >
          <option value="">{t('contacts.allSources')}</option>
          <option value="walk_in">{t('contacts.source.walk_in')}</option>
          <option value="phone">{t('contacts.source.phone')}</option>
          <option value="web">{t('contacts.source.web')}</option>
          <option value="referral">{t('contacts.source.referral')}</option>
          <option value="repeat">{t('contacts.source.repeat')}</option>
          <option value="other">{t('contacts.source.other')}</option>
        </select>
      </div>

      {/* Contact Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('contacts.loading')}</div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('contacts.noContacts')}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {contacts.map(contact => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onClick={() => navigate(`/contacts/${contact.id}`)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="p-2 rounded-lg border border-[var(--color-border)] disabled:opacity-30 hover:bg-[var(--color-bg)]"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm text-[var(--color-text-secondary)]">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="p-2 rounded-lg border border-[var(--color-border)] disabled:opacity-30 hover:bg-[var(--color-bg)]"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      <CreateContactModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(contact) => navigate(`/contacts/${contact.id}`)}
      />
    </div>
  );
}
