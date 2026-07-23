import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Phone, Mail, MapPin, Calendar, Edit2, Save, X, Car, Trash2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL;

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon size={16} className="text-[var(--color-text-secondary)] mt-0.5 shrink-0" />
      <div>
        <div className="text-xs text-[var(--color-text-secondary)]">{label}</div>
        <div className="text-sm text-[var(--color-text)]">{value}</div>
      </div>
    </div>
  );
}

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});

  const { data: contact, isLoading, error } = useQuery({
    queryKey: ['contacts', id],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/contacts/${id}`);
      if (!res.ok) throw new Error('Contact not found');
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (updates) => {
      const res = await fetch(`${API_URL}/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update contact');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts', id] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete contact');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts'] });
      navigate('/contacts');
    },
  });

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('contacts.loading')}</div>;
  }

  if (error || !contact) {
    return <div className="text-center py-12 text-red-500">{t('contacts.notFound')}</div>;
  }

  const fullName = `${contact.first_name} ${contact.last_name}`.trim();
  const address = [contact.address, contact.city, contact.province, contact.postal_code]
    .filter(Boolean)
    .join(', ');

  const startEditing = () => {
    setEditData({
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      address: contact.address || '',
      city: contact.city || '',
      province: contact.province || '',
      postal_code: contact.postal_code || '',
      driver_license: contact.driver_license || '',
      employer: contact.employer || '',
      preferred_language: contact.preferred_language || 'fr',
      notes: contact.notes || '',
    });
    setEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate(editData);
  };

  const editField = (name, label, type = 'text') => (
    <div className="py-2">
      <label className="block text-xs text-[var(--color-text-secondary)] mb-1">{label}</label>
      <input
        type={type}
        value={editData[name] || ''}
        onChange={(e) => setEditData(prev => ({ ...prev, [name]: e.target.value }))}
        className="w-full px-3 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
      />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/contacts')}
            className="p-2 rounded-lg hover:bg-[var(--color-bg)] border border-[var(--color-border)]"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{fullName}</h1>
          {contact.preferred_language && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] uppercase">
              {contact.preferred_language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] text-sm"
              >
                <X size={14} /> {t('contacts.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 text-sm"
              >
                <Save size={14} /> {t('contacts.save')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={startEditing}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)] text-sm"
              >
                <Edit2 size={14} /> {t('contacts.edit')}
              </button>
              <button
                onClick={() => {
                  if (window.confirm(t('contacts.deleteConfirm'))) {
                    deleteMutation.mutate();
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 text-sm"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Three-column layout: Properties | Timeline | Deals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Properties */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
            {t('contacts.properties')}
          </h2>

          {editing ? (
            <div className="space-y-1">
              <div className="grid grid-cols-2 gap-2">
                {editField('first_name', t('contacts.firstName'))}
                {editField('last_name', t('contacts.lastName'))}
              </div>
              {editField('phone', t('contacts.phone'), 'tel')}
              {editField('email', t('contacts.email'), 'email')}
              {editField('address', t('contacts.address'))}
              <div className="grid grid-cols-2 gap-2">
                {editField('city', t('contacts.city'))}
                {editField('province', t('contacts.province'))}
              </div>
              {editField('postal_code', t('contacts.postalCode'))}
              {editField('driver_license', t('contacts.driverLicense'))}
              {editField('employer', t('contacts.employer'))}
              <div className="py-2">
                <label className="block text-xs text-[var(--color-text-secondary)] mb-1">{t('contacts.notes')}</label>
                <textarea
                  value={editData.notes || ''}
                  onChange={(e) => setEditData(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                />
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)]">
              <InfoRow icon={Phone} label={t('contacts.phone')} value={contact.phone} />
              <InfoRow icon={Mail} label={t('contacts.email')} value={contact.email} />
              <InfoRow icon={MapPin} label={t('contacts.address')} value={address} />
              <InfoRow icon={Calendar} label={t('contacts.customerSince')} value={
                contact.customer_since ? new Date(contact.customer_since).toLocaleDateString() : null
              } />
              {contact.driver_license && (
                <InfoRow icon={Car} label={t('contacts.driverLicense')} value={contact.driver_license} />
              )}
              {contact.employer && (
                <div className="py-2">
                  <div className="text-xs text-[var(--color-text-secondary)]">{t('contacts.employer')}</div>
                  <div className="text-sm text-[var(--color-text)]">{contact.employer}</div>
                </div>
              )}
              {contact.source && (
                <div className="py-2">
                  <div className="text-xs text-[var(--color-text-secondary)]">{t('contacts.source.label')}</div>
                  <div className="text-sm text-[var(--color-text)]">{t(`contacts.source.${contact.source}`)}</div>
                </div>
              )}
              {contact.notes && (
                <div className="py-2">
                  <div className="text-xs text-[var(--color-text-secondary)]">{t('contacts.notes')}</div>
                  <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{contact.notes}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Timeline (placeholder — populated after F-008 Activity Events) */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
            {t('contacts.timeline')}
          </h2>
          <div className="text-sm text-[var(--color-text-secondary)] py-4 text-center">
            {t('contacts.timelineEmpty')}
          </div>
        </div>

        {/* Associated Deals */}
        <div className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
            {t('contacts.associatedDeals')} ({contact.deals?.length || 0})
          </h2>
          {contact.deals && contact.deals.length > 0 ? (
            <div className="space-y-2">
              {contact.deals.map(deal => (
                <Link
                  key={deal.id}
                  to={`/deal/${deal.id}`}
                  className="block p-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {deal.stock_number && `#${deal.stock_number} — `}
                        {[deal.year, deal.make, deal.model].filter(Boolean).join(' ') || t('contacts.noDealInfo')}
                      </div>
                      <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                        {deal.role === 'cosigner' && `(${t('contacts.cosigner')}) · `}
                        {new Date(deal.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      deal.deal_status === 'complete' ? 'bg-green-500/10 text-green-600' :
                      deal.deal_status === 'cancelled' ? 'bg-red-500/10 text-red-500' :
                      'bg-blue-500/10 text-blue-500'
                    }`}>
                      {deal.deal_status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--color-text-secondary)] py-4 text-center">
              {t('contacts.noDeals')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
