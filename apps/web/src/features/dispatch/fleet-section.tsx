import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label } from '@dealpilot/ui';
import { ApiError } from '../../shared/api/client.js';
import { useAddChaser, useAddPlate, useDriverCompanies, useCreateDriverCompany, useFleet } from './api.js';

/**
 * Store logistics roster: driver companies (the request email goes to them),
 * chaser cars and dealer plates. Availability is DERIVED from runs — there is
 * deliberately no hand-set status here.
 */
export function FleetSection({ orgId, storeId }: { orgId: string; storeId: string }) {
  const { t } = useTranslation('dispatch');
  const fleet = useFleet(storeId, orgId);
  const companies = useDriverCompanies(orgId, { enabled: true });
  const addChaser = useAddChaser(storeId);
  const addPlate = useAddPlate(storeId);
  const addCompany = useCreateDriverCompany();
  const [chaserName, setChaserName] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  function run(p: Promise<unknown>, clear: () => void) {
    setError(null);
    p.then(clear).catch((err: unknown) => {
      setError(t('genericError'));
      if (!(err instanceof ApiError)) throw err;
    });
  }

  function handleCompany(e: FormEvent) {
    e.preventDefault();
    run(
      addCompany.mutateAsync({ organization_id: orgId, store_id: storeId, name: companyName.trim(), email: companyEmail.trim() }),
      () => {
        setCompanyName('');
        setCompanyEmail('');
      },
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="fleet-title">
      <div>
        <h2 id="fleet-title" className="text-[15px] font-semibold">
          {t('fleetTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('fleetNote')}</p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}
      {fleet.isError || companies.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : null}

      <form onSubmit={handleCompany} noValidate className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1 space-y-1">
          <Label htmlFor="fleet-company-name">{t('companyName')}</Label>
          <Input id="fleet-company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="fleet-company-email">{t('companyEmail')}</Label>
          <Input id="fleet-company-email" type="email" inputMode="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={addCompany.isPending || companyName.trim() === '' || companyEmail.trim() === ''}>
          {t('addCompany')}
        </Button>
      </form>
      <ul className="divide-y divide-border text-sm">
        {(companies.data?.items ?? [])
          .filter((c) => c.active)
          .map((c) => (
            <li key={c.id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{c.name}</span>
              <span className="font-mono text-[13px] text-muted-foreground">{c.email}</span>
            </li>
          ))}
      </ul>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="fleet-chaser">{t('chaserName')}</Label>
              <Input id="fleet-chaser" value={chaserName} onChange={(e) => setChaserName(e.target.value)} />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={addChaser.isPending || chaserName.trim() === ''}
              onClick={() =>
                run(
                  addChaser.mutateAsync({ organization_id: orgId, store_id: storeId, name: chaserName.trim() }),
                  () => setChaserName(''),
                )
              }
            >
              {t('addChaser')}
            </Button>
          </div>
          <ul className="divide-y divide-border text-sm">
            {(fleet.data?.chasers ?? []).map((c) => (
              <li key={c.id} className="flex justify-between gap-2 py-1.5">
                <span>{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.status === 'in_use' ? t('inUse') : t('available')}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="fleet-plate">{t('plateNumber')}</Label>
              <Input id="fleet-plate" className="font-mono" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={addPlate.isPending || plateNumber.trim().length < 2}
              onClick={() =>
                run(
                  addPlate.mutateAsync({ organization_id: orgId, store_id: storeId, plate_number: plateNumber.trim() }),
                  () => setPlateNumber(''),
                )
              }
            >
              {t('addPlate')}
            </Button>
          </div>
          <ul className="divide-y divide-border text-sm">
            {(fleet.data?.plates ?? []).map((p) => (
              <li key={p.id} className="flex justify-between gap-2 py-1.5">
                <span className="font-mono">{p.plate_number}</span>
                <span className="text-xs text-muted-foreground">
                  {p.status === 'in_use' ? t('inUse') : t('available')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
