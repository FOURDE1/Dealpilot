import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Eye, EyeOff } from 'lucide-react';
import SectionCard, { Field, MoneyInput, NumberInput, TextInput } from './SectionCard';

export default function VehicleCard({ state, setVehicle, setField, isManager = true }) {
  const { t } = useTranslation();
  const [showCost, setShowCost] = useState(false);
  const v = (state && state.vehicle) || {};

  return (
    <SectionCard title={t('desking.vehicle')} icon={Car}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Field label={t('desking.year')}><TextInput value={v.year} onChange={(x) => setVehicle({ year: x })} /></Field>
        <Field label={t('desking.make')}><TextInput value={v.make} onChange={(x) => setVehicle({ make: x })} /></Field>
        <Field label={t('desking.model')}><TextInput value={v.model} onChange={(x) => setVehicle({ model: x })} /></Field>
        <Field label={t('desking.color')}><TextInput value={v.color} onChange={(x) => setVehicle({ color: x })} /></Field>
        <Field label="VIN"><TextInput value={v.vin} onChange={(x) => setVehicle({ vin: x })} /></Field>
        <Field label={t('desking.stock')}><TextInput value={v.stock} onChange={(x) => setVehicle({ stock: x })} /></Field>
        <Field label={t('desking.mileage')}><NumberInput value={v.mileage} onChange={(x) => setVehicle({ mileage: x })} suffix="km" /></Field>
        <Field label={t('desking.condition')}>
          <select value={v.condition || 'new'} onChange={(e) => setVehicle({ condition: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="new">{t('desking.new')}</option>
            <option value="used">{t('desking.used')}</option>
          </select>
        </Field>
        <Field label={t('desking.msrp')}><MoneyInput value={state.msrp} onChange={(x) => setField('msrp', x)} /></Field>
        <Field label={t('desking.salePrice')} className="md:col-span-2"><MoneyInput value={state.salePrice} onChange={(x) => setField('salePrice', x)} /></Field>
        {isManager && (
          <Field label={
            <span className="flex items-center gap-2">
              {t('desking.vehicleCost')}
              <button onClick={() => setShowCost(!showCost)} type="button" className="text-gray-400 hover:text-gray-600">
                {showCost ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </span>
          }>
            <MoneyInput value={showCost ? state.vehicleCost : 0} onChange={(x) => setField('vehicleCost', x)} disabled={!showCost} />
          </Field>
        )}
      </div>
    </SectionCard>
  );
}
