import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Car, Search, Plus, Shield, Wrench, Camera, Clock } from 'lucide-react';
import { formatCurrency } from '../lib/currency';

const API_URL = import.meta.env.VITE_API_URL;

const LOCATION_COLORS = {
  at_source: '#F59E0B',
  in_transit: '#6366F1',
  on_lot: '#22C55E',
  at_garage: '#3B82F6',
  delivered: '#6B7280',
  wholesale: '#F97316',
};

const SAFETY_COLORS = {
  not_required: '#9CA3AF',
  not_started: '#EF4444',
  sent_to_garage: '#F59E0B',
  in_progress: '#3B82F6',
  passed: '#22C55E',
  failed: '#EF4444',
};

function VehicleCard({ vehicle, onClick }) {
  const { t } = useTranslation();
  const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
  const locationColor = LOCATION_COLORS[vehicle.location_status] || '#9CA3AF';
  const safetyColor = SAFETY_COLORS[vehicle.safety_status] || '#9CA3AF';

  const daysOnLot = vehicle.lot_arrival_date
    ? Math.floor((Date.now() - new Date(vehicle.lot_arrival_date)) / 86400000)
    : 0;
  const agingColor = daysOnLot < 30 ? '#22C55E' : daysOnLot < 60 ? '#F59E0B' : '#EF4444';

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text)]">{title}</div>
          <div className="text-xs text-[var(--color-text-secondary)] mt-0.5">
            #{vehicle.stock_number} {vehicle.vin ? `· ${vehicle.vin.slice(-8)}` : ''}
          </div>
        </div>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full text-white font-medium"
          style={{ backgroundColor: locationColor }}
        >
          {t(`inventory.location.${vehicle.location_status}`)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)] mb-2">
        {vehicle.exterior_color && <span>{vehicle.exterior_color}</span>}
        {vehicle.mileage && <span>{vehicle.mileage.toLocaleString()} km</span>}
      </div>

      {vehicle.list_price > 0 && (
        <div className="text-sm font-bold text-[var(--color-text)] mb-2">
          {formatCurrency(vehicle.list_price)}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1" title={t(`inventory.safety.${vehicle.safety_status}`)}>
            <Shield size={12} style={{ color: safetyColor }} />
          </div>
          <div className="flex items-center gap-1" title={t(`inventory.recon.${vehicle.recon_status}`)}>
            <Wrench size={12} className="text-[var(--color-text-secondary)]" />
          </div>
          <div className="flex items-center gap-1">
            <Camera size={12} className={vehicle.photo_complete ? 'text-green-500' : 'text-red-400'} />
            <span className="text-[10px]">{vehicle.photo_count || 0}</span>
          </div>
        </div>
        {vehicle.lot_arrival_date && (
          <div className="flex items-center gap-1 text-xs" style={{ color: agingColor }}>
            <Clock size={12} />
            <span>{daysOnLot}d</span>
          </div>
        )}
      </div>
    </button>
  );
}

function AddVehicleModal({ isOpen, onClose, onCreated }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    stock_number: '', vin: '', year: '', make: '', model: '', trim: '',
    exterior_color: '', mileage: '', acquisition_type: 'dealer_trade',
    acquisition_cost: '', list_price: '', location_status: 'on_lot',
  });

  const [vinStatus, setVinStatus] = useState('idle');

  useEffect(() => {
    if (!isOpen || form.stock_number) return;
    (async () => {
      try {
        const [invRes, dealRes] = await Promise.all([
          fetch(`${API_URL}/inventory`),
          fetch(`${API_URL}/deals`),
        ]);
        const inv = invRes.ok ? await invRes.json() : [];
        const deals = dealRes.ok ? await dealRes.json() : [];
        const invArr = Array.isArray(inv) ? inv : inv.data || [];
        const dealArr = Array.isArray(deals) ? deals : deals.data || [];
        const allStocks = [
          ...invArr.map(v => v.stock_number),
          ...dealArr.map(d => d.stock_number),
        ].filter(Boolean);
        let maxNum = 0;
        allStocks.forEach(s => {
          const n = parseInt(s, 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        });
        if (maxNum > 0) {
          setForm(f => ({ ...f, stock_number: String(maxNum + 1) }));
        }
      } catch {}
    })();
  }, [isOpen]);

  const decodeVin = async (vin) => {
    const cleaned = vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '');
    if (cleaned.length !== 17) {
      setVinStatus('idle');
      return;
    }

    setVinStatus('decoding');
    try {
      const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${cleaned}?format=json`);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      const results = data.Results || [];
      const get = (variable) => {
        const item = results.find((r) => r.Variable === variable);
        return item?.Value && item.Value !== 'Not Applicable' ? item.Value : '';
      };

      const year = get('Model Year');
      const make = get('Make');
      const model = get('Model');
      const trim = get('Trim');

      if (year || make || model) {
        setForm((prev) => ({
          ...prev,
          year: year || prev.year,
          make: make || prev.make,
          model: model || prev.model,
          trim: trim || prev.trim,
        }));
        setVinStatus('success');
      } else {
        setVinStatus('error');
      }
    } catch {
      setVinStatus('error');
    }
  };

  const handleVinChange = (e) => {
    const value = e.target.value.toUpperCase();
    setForm((prev) => ({ ...prev, vin: value }));
    if (value.replace(/[^A-HJ-NPR-Z0-9]/gi, '').length < 17) {
      setVinStatus('idle');
    } else if (value.replace(/[^A-HJ-NPR-Z0-9]/gi, '').length === 17) {
      decodeVin(value);
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        year: form.year ? parseInt(form.year) : null,
        mileage: form.mileage ? parseInt(form.mileage) : null,
        acquisition_cost: form.acquisition_cost ? Math.round(parseFloat(form.acquisition_cost) * 100) : 0,
        list_price: form.list_price ? Math.round(parseFloat(form.list_price) * 100) : null,
      };
      const res = await fetch(`${API_URL}/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to add vehicle');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setForm({ stock_number: '', vin: '', year: '', make: '', model: '', trim: '', exterior_color: '', mileage: '', acquisition_type: 'dealer_trade', acquisition_cost: '', list_price: '', location_status: 'on_lot' });
      setVinStatus('idle');
      onCreated?.(data);
      onClose();
    },
  });

  if (!isOpen) return null;

  const field = (name, label, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{label}</label>
      <input
        type={type}
        value={form[name]}
        onChange={(e) => setForm(prev => ({ ...prev, [name]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">{t('inventory.addVehicle')}</h2>

          {createMutation.isError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500">
              {createMutation.error?.message}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field('stock_number', t('inventory.form.stockNumber'), 'text', 'U-1001')}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">VIN</label>
                <div className="relative">
                  <input
                    type="text"
                    value={form.vin}
                    onChange={handleVinChange}
                    placeholder="17 characters"
                    maxLength={17}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] uppercase"
                  />
                  {vinStatus === 'decoding' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--color-accent)] animate-pulse">Decoding...</span>
                  )}
                  {vinStatus === 'success' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-500">✓ Decoded</span>
                  )}
                  {vinStatus === 'error' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red-500">VIN not found</span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {field('year', t('inventory.form.year'), 'number', '2024')}
              {field('make', t('inventory.form.make'), 'text', 'Kia')}
              {field('model', t('inventory.form.model'), 'text', 'Sportage')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field('trim', t('inventory.form.trim'), 'text', 'EX')}
              {field('exterior_color', t('inventory.form.color'), 'text', 'White')}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field('mileage', t('inventory.form.mileage'), 'number', '45000')}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('inventory.form.acquisitionType')}</label>
                <select
                  value={form.acquisition_type}
                  onChange={(e) => setForm(prev => ({ ...prev, acquisition_type: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
                >
                  <option value="auction">Auction</option>
                  <option value="dealer_trade">Dealer Trade</option>
                  <option value="trade_in">Trade-In</option>
                  <option value="consignment">Consignment</option>
                  <option value="internal_wholesale">Internal Wholesale</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field('acquisition_cost', t('inventory.form.cost'), 'number', '15000')}
              {field('list_price', t('inventory.form.listPrice'), 'number', '19995')}
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">{t('inventory.form.location')}</label>
              <select
                value={form.location_status}
                onChange={(e) => setForm(prev => ({ ...prev, location_status: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
              >
                <option value="on_lot">{t('inventory.location.on_lot')}</option>
                <option value="at_source">{t('inventory.location.at_source')}</option>
                <option value="in_transit">{t('inventory.location.in_transit')}</option>
                <option value="at_garage">{t('inventory.location.at_garage')}</option>
              </select>
            </div>

            <div className="flex gap-3 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg)]"
              >
                {t('contacts.cancel')}
              </button>
              <button
                type="submit"
                disabled={!form.stock_number || !form.year || !form.make || !form.model || createMutation.isPending}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {createMutation.isPending ? '...' : t('inventory.addVehicle')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [dealStatusFilter, setDealStatusFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', { search, locationFilter, dealStatusFilter }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (locationFilter) params.set('location_status', locationFilter);
      if (dealStatusFilter) params.set('deal_status', dealStatusFilter);
      const res = await fetch(`${API_URL}/inventory?${params}`);
      if (!res.ok) throw new Error('Failed to fetch inventory');
      return res.json();
    },
  });

  const vehicles = data?.data || [];
  const total = data?.total || 0;

  // Stats
  const onLot = vehicles.filter(v => v.location_status === 'on_lot').length;
  const atGarage = vehicles.filter(v => v.location_status === 'at_garage').length;
  const inTransit = vehicles.filter(v => v.location_status === 'in_transit').length;
  const available = vehicles.filter(v => v.deal_status === 'available').length;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Car size={24} className="text-[var(--color-accent)]" />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('inventory.title')}</h1>
          <span className="text-sm text-[var(--color-text-secondary)]">({total})</span>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90"
        >
          <Plus size={18} />
          {t('inventory.addVehicle')}
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: t('inventory.stat.onLot'), value: onLot, color: '#22C55E' },
          { label: t('inventory.stat.atGarage'), value: atGarage, color: '#3B82F6' },
          { label: t('inventory.stat.inTransit'), value: inTransit, color: '#6366F1' },
          { label: t('inventory.stat.available'), value: available, color: '#10B981' },
        ].map((stat) => (
          <div key={stat.label} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-3">
            <div className="text-xs text-[var(--color-text-secondary)]">{stat.label}</div>
            <div className="text-xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            type="text"
            placeholder={t('inventory.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
        >
          <option value="">{t('inventory.allLocations')}</option>
          <option value="at_source">{t('inventory.location.at_source')}</option>
          <option value="in_transit">{t('inventory.location.in_transit')}</option>
          <option value="on_lot">{t('inventory.location.on_lot')}</option>
          <option value="at_garage">{t('inventory.location.at_garage')}</option>
        </select>
        <select
          value={dealStatusFilter}
          onChange={(e) => setDealStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
        >
          <option value="">{t('inventory.allStatuses')}</option>
          <option value="available">{t('inventory.dealStatus.available')}</option>
          <option value="reserved">{t('inventory.dealStatus.reserved')}</option>
          <option value="sold_pending">{t('inventory.dealStatus.soldPending')}</option>
        </select>
      </div>

      {/* Vehicle Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('contacts.loading')}</div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-secondary)]">{t('inventory.noVehicles')}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {vehicles.map(vehicle => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              onClick={() => navigate(`/inventory/${vehicle.id}`)}
            />
          ))}
        </div>
      )}

      <AddVehicleModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={(vehicle) => navigate(`/inventory/${vehicle.id}`)}
      />
    </div>
  );
}
