import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.VITE_API_URL;

const EMPTY_FORM = {
  name: '',
  commission_rate: '',
  has_pad: true,
  pad_amount: 1500,
  has_tiered_rate: false,
  tier_threshold: '',
  tier_rate: '',
  override_on: '',
  override_rate: '',
};

export default function SalespeopleManager() {
  const { t } = useTranslation();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchPeople = async () => {
    try {
      const res = await fetch(`${API_URL}/salespeople`);
      const data = await res.json();
      setPeople(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPeople(); }, []);

  const handleChange = (e) => {
    const { name, type, value, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleEdit = (sp) => {
    setEditingId(sp.id);
    setForm({
      name: sp.name,
      commission_rate: (sp.commission_rate * 100).toString(),
      has_pad: sp.has_pad,
      pad_amount: sp.pad_amount,
      has_tiered_rate: sp.has_tiered_rate,
      tier_threshold: sp.tier_threshold || '',
      tier_rate: sp.tier_rate ? (sp.tier_rate * 100).toString() : '',
      override_on: sp.override_on || '',
      override_rate: sp.override_rate ? (sp.override_rate * 100).toString() : '',
    });
    setShowForm(true);
  };

  const handleAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    const payload = {
      name: form.name,
      commission_rate: Number(form.commission_rate) / 100,
      has_pad: form.has_pad,
      pad_amount: form.has_pad ? Number(form.pad_amount) : 0,
      has_tiered_rate: form.has_tiered_rate,
      tier_threshold: form.has_tiered_rate ? Number(form.tier_threshold) : null,
      tier_rate: form.has_tiered_rate ? Number(form.tier_rate) / 100 : null,
      override_on: form.override_on || null,
      override_rate: form.override_rate ? Number(form.override_rate) / 100 : null,
    };

    try {
      const url = editingId ? `${API_URL}/salespeople/${editingId}` : `${API_URL}/salespeople`;
      const method = editingId ? 'PUT' : 'POST';
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setShowForm(false);
      setEditingId(null);
      fetchPeople();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id) => {
    if (!window.confirm(t('salespeople.confirmDeactivate'))) return;
    await fetch(`${API_URL}/salespeople/${id}`, { method: 'DELETE' });
    fetchPeople();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('salespeople.title')}</h1>
        <button
          onClick={handleAdd}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-[#1e3a5f] text-white hover:bg-[#162d4a]"
        >
          {t('salespeople.add')}
        </button>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            {editingId ? t('salespeople.edit') : t('salespeople.add')}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('salespeople.name')}</label>
              <input name="name" value={form.name} onChange={handleChange} required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('salespeople.commissionRate')} (%)</label>
              <input name="commission_rate" type="number" step="0.5" value={form.commission_rate} onChange={handleChange} required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div className="flex items-center gap-4 pt-6">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="has_pad" checked={form.has_pad} onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300" />
                <span className="text-sm">{t('salespeople.hasPad')}</span>
              </label>
            </div>
            {form.has_pad && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('salespeople.padAmount')}</label>
                <input name="pad_amount" type="number" value={form.pad_amount} onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div className="flex items-center gap-4 pt-6">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="has_tiered_rate" checked={form.has_tiered_rate} onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300" />
                <span className="text-sm">{t('salespeople.hasTieredRate')}</span>
              </label>
            </div>
            {form.has_tiered_rate && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('salespeople.tierThreshold')}</label>
                  <input name="tier_threshold" type="number" value={form.tier_threshold} onChange={handleChange}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('salespeople.tierRate')} (%)</label>
                  <input name="tier_rate" type="number" step="0.5" value={form.tier_rate} onChange={handleChange}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('salespeople.overrideOn')}</label>
              <input name="override_on" value={form.override_on} onChange={handleChange} placeholder="e.g. Hussein Alshawi"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
            {form.override_on && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('salespeople.overrideRate')} (%)</label>
                <input name="override_rate" type="number" step="0.5" value={form.override_rate} onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
              </div>
            )}
            <div className="sm:col-span-2 lg:col-span-3 flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
                {t('actions.cancel')}
              </button>
              <button type="submit" disabled={saving}
                className="px-4 py-2 text-sm font-medium rounded-md bg-[#1e3a5f] text-white hover:bg-[#162d4a] disabled:opacity-50">
                {saving ? t('common.loading') : t('actions.save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Salespeople Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-[#1e3a5f]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-white uppercase">{t('salespeople.name')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-white uppercase">{t('salespeople.rate')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-white uppercase">{t('salespeople.pad')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white uppercase">{t('salespeople.override')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-white uppercase">{t('salespeople.tier')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-white uppercase">{t('salespeople.status')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-white uppercase">{t('salespeople.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {people.map((sp, i) => (
                <tr key={sp.id} className={`${!sp.active ? 'opacity-40' : ''} ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{sp.name}</td>
                  <td className="px-4 py-3 text-sm text-center font-semibold text-blue-600">
                    {(sp.commission_rate * 100).toFixed(0)}%
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    {sp.has_pad ? `$${sp.pad_amount.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {sp.override_on ? `${(sp.override_rate * 100).toFixed(0)}% on ${sp.override_on}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {sp.has_tiered_rate ? `${(sp.tier_rate * 100).toFixed(0)}% if >${sp.tier_threshold?.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sp.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {sp.active ? t('salespeople.active') : t('salespeople.inactive')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button onClick={() => handleEdit(sp)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                        {t('actions.edit')}
                      </button>
                      {sp.active && (
                        <button onClick={() => handleDeactivate(sp.id)}
                          className="text-xs text-red-600 hover:text-red-800 font-medium">
                          {t('actions.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
