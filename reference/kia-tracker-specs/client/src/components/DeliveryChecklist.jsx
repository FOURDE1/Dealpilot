import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import FileUpload from './FileUpload';

const API_URL = import.meta.env.VITE_API_URL;

export default function DeliveryChecklist({ dealId, editing }) {
  const { t } = useTranslation();

  const [checklist, setChecklist] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchChecklist = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/delivery-checklists/${dealId}`);
      if (!res.ok) throw new Error('Failed to fetch checklist');
      const data = await res.json();
      setChecklist(data);
      setForm(data);
    } catch (err) {
      console.error('Error fetching delivery checklist:', err);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  // Initial load
  useEffect(() => {
    if (dealId) fetchChecklist();
  }, [dealId, fetchChecklist]);

  // Supabase realtime filtered by deal_id
  useEffect(() => {
    if (!dealId) return;

    const channel = supabase
      .channel(`delivery-checklist-${dealId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_checklists', filter: `deal_id=eq.${dealId}` },
        () => {
          fetchChecklist();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealId, fetchChecklist]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/delivery-checklists/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Save failed');
      const data = await res.json();
      setChecklist(data);
      setForm(data);
    } catch (err) {
      console.error('Error saving delivery checklist:', err);
    } finally {
      setSaving(false);
    }
  };

  // Compute missing items
  const getMissingItems = () => {
    const src = editing ? form : checklist;
    if (!src) return [];
    const missing = [];
    if (!src.client_insurance_uploaded) missing.push(t('delivery.insurance'));
    if (!src.deal_funded) missing.push(t('delivery.funded'));
    if (!src.safety_done) missing.push(t('delivery.safetyDone'));
    if (!src.registration_done) missing.push(t('delivery.registrationDone'));
    return missing;
  };

  // Status indicator
  const StatusCircle = ({ done }) => (
    <span
      className={`inline-block h-3 w-3 rounded-full shrink-0 ${
        done ? 'bg-green-500' : 'bg-red-500'
      }`}
    />
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-gray-200 border-t-red-600" />
        <span className="ml-2 text-sm text-gray-500">{t('common.loading')}</span>
      </div>
    );
  }

  if (!checklist) return null;

  const missingItems = getMissingItems();
  const allComplete = missingItems.length === 0;
  const src = editing ? form : checklist;

  // Determine if booking section should be visible
  const hasBookingData =
    src.drivers_booked ||
    src.driver_names ||
    src.booking_company ||
    src.booked_delivery_time ||
    src.chaser_car_required ||
    src.chaser_car_booked ||
    src.dealer_plate_required ||
    src.dealer_plate_assigned;
  const showBookingSection = editing || hasBookingData;

  return (
    <div className="space-y-4">
      {/* Red flag banner */}
      {!allComplete && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <svg
            className="h-5 w-5 text-red-500 shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M4 24V0h1v1c2 0 3.5.5 5 1s3 1 5 1c3 0 5-1.5 5-1.5V14s-2 1.5-5 1.5c-2 0-3.5-.5-5-1s-3-1-5-1v10.5H4z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-700">{t('delivery.redFlag')}</p>
            <ul className="mt-1 text-sm text-red-600 list-disc list-inside">
              {missingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* All complete banner */}
      {allComplete && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
          <svg
            className="h-5 w-5 text-green-500 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-semibold text-green-700">{t('delivery.allComplete')}</p>
        </div>
      )}

      {/* 4 critical items */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
        {/* Client Insurance */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StatusCircle done={src.client_insurance_uploaded} />
            <span className="text-sm font-medium text-gray-700">{t('delivery.insurance')}</span>
            <span className={`text-xs ${src.client_insurance_uploaded ? 'text-green-600' : 'text-red-600'}`}>
              {src.client_insurance_uploaded ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div className="ml-5">
            <FileUpload
              dealId={dealId}
              category="insurance"
              currentUrl={src.insurance_file_url || null}
              onUploadComplete={(url) => {
                setForm((prev) => ({ ...prev, client_insurance_uploaded: true, insurance_file_url: url }));
                setChecklist((prev) => prev ? { ...prev, client_insurance_uploaded: true, insurance_file_url: url } : prev);
              }}
              onDeleteComplete={() => {
                setForm((prev) => ({ ...prev, client_insurance_uploaded: false, insurance_file_url: null }));
                setChecklist((prev) => prev ? { ...prev, client_insurance_uploaded: false, insurance_file_url: null } : prev);
              }}
              disabled={!editing}
            />
          </div>
        </div>

        {/* Deal Funded */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StatusCircle done={src.deal_funded} />
            <span className="text-sm font-medium text-gray-700">{t('delivery.funded')}</span>
            <span className={`text-xs ${src.deal_funded ? 'text-green-600' : 'text-red-600'}`}>
              {src.deal_funded ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div className="ml-5">
            <FileUpload
              dealId={dealId}
              category="funding-proof"
              currentUrl={src.funding_proof_url || null}
              onUploadComplete={(url) => {
                setForm((prev) => ({ ...prev, deal_funded: true, funding_proof_url: url }));
                setChecklist((prev) => prev ? { ...prev, deal_funded: true, funding_proof_url: url } : prev);
              }}
              onDeleteComplete={() => {
                setForm((prev) => ({ ...prev, deal_funded: false, funding_proof_url: null }));
                setChecklist((prev) => prev ? { ...prev, deal_funded: false, funding_proof_url: null } : prev);
              }}
              disabled={!editing}
            />
          </div>
        </div>

        {/* Safety Done */}
        <div>
          <div className="flex items-center gap-2">
            <StatusCircle done={src.safety_done} />
            <span className="text-sm font-medium text-gray-700">{t('delivery.safetyDone')}</span>
            {editing ? (
              <input
                type="checkbox"
                name="safety_done"
                checked={form.safety_done ?? false}
                onChange={handleChange}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 ml-2"
              />
            ) : (
              <span className={`text-xs ${src.safety_done ? 'text-green-600' : 'text-red-600'}`}>
                {src.safety_done ? t('common.yes') : t('common.no')}
              </span>
            )}
          </div>
        </div>

        {/* Registration Done */}
        <div>
          <div className="flex items-center gap-2">
            <StatusCircle done={src.registration_done} />
            <span className="text-sm font-medium text-gray-700">{t('delivery.registrationDone')}</span>
            {editing ? (
              <input
                type="checkbox"
                name="registration_done"
                checked={form.registration_done ?? false}
                onChange={handleChange}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 ml-2"
              />
            ) : (
              <span className={`text-xs ${src.registration_done ? 'text-green-600' : 'text-red-600'}`}>
                {src.registration_done ? t('common.yes') : t('common.no')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Delivery Booking Fields */}
      {showBookingSection && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">{t('delivery.bookingSection')}</h3>

          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Drivers Booked */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  name="drivers_booked"
                  checked={form.drivers_booked ?? false}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label className="text-sm font-medium text-gray-700">{t('delivery.driversBooked')}</label>
              </div>

              {/* Driver Names */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('delivery.driverNames')}</label>
                <input
                  type="text"
                  name="driver_names"
                  value={form.driver_names ?? ''}
                  onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Booking Company */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('delivery.bookingCompany')}</label>
                <select
                  name="booking_company"
                  value={form.booking_company ?? ''}
                  onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                >
                  <option value="">{t('common.select')}</option>
                  <option value="supreme">{t('delivery.companySupreme')}</option>
                  <option value="denises_guys">{t('delivery.companyDenisesGuys')}</option>
                </select>
              </div>

              {/* Booked Delivery Time */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('delivery.deliveryTime')}</label>
                <input
                  type="datetime-local"
                  name="booked_delivery_time"
                  value={form.booked_delivery_time ?? ''}
                  onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Chaser Car Required */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  name="chaser_car_required"
                  checked={form.chaser_car_required ?? false}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label className="text-sm font-medium text-gray-700">{t('delivery.chaserCarRequired')}</label>
              </div>

              {/* Chaser Car Booked */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  name="chaser_car_booked"
                  checked={form.chaser_car_booked ?? false}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label className="text-sm font-medium text-gray-700">{t('delivery.chaserCarBooked')}</label>
              </div>

              {/* Dealer Plate Required */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  name="dealer_plate_required"
                  checked={form.dealer_plate_required ?? false}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label className="text-sm font-medium text-gray-700">{t('delivery.dealerPlateRequired')}</label>
              </div>

              {/* Dealer Plate Assigned */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('delivery.dealerPlateAssigned')}</label>
                <input
                  type="text"
                  name="dealer_plate_assigned"
                  value={form.dealer_plate_assigned ?? ''}
                  onChange={handleChange}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          ) : (
            /* Read-only booking display */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {src.drivers_booked !== undefined && (
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-3 h-3 rounded-full ${src.drivers_booked ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-sm text-gray-700">{t('delivery.driversBooked')}</span>
                </div>
              )}
              {src.driver_names && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('delivery.driverNames')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">{src.driver_names}</dd>
                </div>
              )}
              {src.booking_company && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('delivery.bookingCompany')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {src.booking_company === 'supreme'
                      ? t('delivery.companySupreme')
                      : src.booking_company === 'denises_guys'
                        ? t('delivery.companyDenisesGuys')
                        : src.booking_company}
                  </dd>
                </div>
              )}
              {src.booked_delivery_time && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('delivery.deliveryTime')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(src.booked_delivery_time).toLocaleString()}
                  </dd>
                </div>
              )}
              {src.chaser_car_required && (
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-3 h-3 rounded-full ${src.chaser_car_booked ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-sm text-gray-700">
                    {t('delivery.chaserCarRequired')}
                    {src.chaser_car_booked ? ` - ${t('delivery.chaserCarBooked')}` : ''}
                  </span>
                </div>
              )}
              {src.dealer_plate_required && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">{t('delivery.dealerPlateRequired')}</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {src.dealer_plate_assigned || '-'}
                  </dd>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Save button */}
      {editing && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50"
          >
            {saving && (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {t('common.save')}
          </button>
        </div>
      )}
    </div>
  );
}
