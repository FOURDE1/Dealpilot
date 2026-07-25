import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogTitle, Input, Label, Select } from '@dealpilot/ui';
import type { MemberT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { parseMoneyToCents, parsePctToBps } from '../deals/money.js';
import { usePayPlan, useUpsertPayPlan } from './api.js';

/** % as decimal for the API (0.25) from human "25". */
function parsePctToRate(raw: string): number | null {
  const bps = parsePctToBps(raw);
  return bps === null || bps > 10_000 ? null : bps / 10_000;
}

/**
 * The member's pay plan: rate, pad, optional tier and override. Mirrors the
 * F-09 contract; the commission math itself lives in @dealpilot/core.
 */
export function PayPlanDialog({
  member,
  orgId,
  colleagues,
  onClose,
}: {
  member: MemberT | null;
  orgId: string | undefined;
  colleagues: readonly MemberT[];
  onClose: () => void;
}) {
  const { t } = useTranslation('commissions');
  const plan = usePayPlan(orgId, member?.user_id ?? '', { enabled: member !== null });
  const upsert = useUpsertPayPlan(orgId);
  const [rate, setRate] = useState('');
  const [pad, setPad] = useState('');
  const [tierOn, setTierOn] = useState(false);
  const [tierThreshold, setTierThreshold] = useState('');
  const [tierRate, setTierRate] = useState('');
  const [overrideOn, setOverrideOn] = useState('');
  const [overrideRate, setOverrideRate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    const p = plan.data;
    setError(null);
    setRate(p ? (p.commission_rate * 100).toFixed(2).replace(/\.?0+$/, '') : '');
    setPad(p && p.has_pad ? (p.pad_cents / 100).toFixed(2) : '');
    setTierOn(p?.has_tiered_rate ?? false);
    setTierThreshold(p?.tier_threshold_cents != null ? (p.tier_threshold_cents / 100).toFixed(2) : '');
    setTierRate(p?.tier_rate != null ? (p.tier_rate * 100).toFixed(2).replace(/\.?0+$/, '') : '');
    setOverrideOn(p?.override_on_user_id ?? '');
    setOverrideRate(p?.override_rate != null ? (p.override_rate * 100).toFixed(2).replace(/\.?0+$/, '') : '');
  }, [member, plan.data]);

  function handleSave() {
    if (!member || !orgId) return;
    setError(null);
    const rateDec = parsePctToRate(rate);
    const padCents = pad.trim() === '' ? 0 : parseMoneyToCents(pad);
    const thresholdCents = tierThreshold.trim() === '' ? null : parseMoneyToCents(tierThreshold);
    const tierDec = tierRate.trim() === '' ? null : parsePctToRate(tierRate);
    const overrideDec = overrideRate.trim() === '' ? null : parsePctToRate(overrideRate);
    if (
      rateDec === null ||
      padCents === null ||
      (tierOn && (thresholdCents === null || tierDec === null)) ||
      (overrideOn !== '' && overrideDec === null)
    ) {
      setError(t('checkFields'));
      return;
    }
    upsert
      .mutateAsync({
        organization_id: orgId,
        user_id: member.user_id,
        commission_rate: rateDec,
        has_pad: padCents > 0,
        pad_cents: padCents,
        has_tiered_rate: tierOn,
        ...(tierOn && thresholdCents !== null && tierDec !== null
          ? { tier_threshold_cents: thresholdCents, tier_rate: tierDec }
          : {}),
        ...(overrideOn !== '' && overrideDec !== null
          ? { override_on_user_id: overrideOn, override_rate: overrideDec }
          : {}),
      })
      .then(() => onClose())
      .catch((err: unknown) => {
        setError(t('genericError'));
        if (!(err instanceof ApiError)) throw err;
      });
  }

  return (
    <Dialog.Root open={member !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogTitle>{member ? t('planFor', { name: member.name }) : t('planTitle')}</DialogTitle>
        {plan.isPending && member ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="plan-rate">{t('rate')}</Label>
                <Input id="plan-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-pad">{t('pad')}</Label>
                <Input id="plan-pad" inputMode="decimal" value={pad} onChange={(e) => setPad(e.target.value)} />
              </div>
            </div>
            <label htmlFor="plan-tier-on" className="flex items-center gap-2 text-sm max-lg:min-h-11">
              <input
                id="plan-tier-on"
                type="checkbox"
                checked={tierOn}
                onChange={(e) => setTierOn(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              {t('tierOn')}
            </label>
            {tierOn ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="plan-tier-threshold">{t('tierThreshold')}</Label>
                  <Input
                    id="plan-tier-threshold"
                    inputMode="decimal"
                    value={tierThreshold}
                    onChange={(e) => setTierThreshold(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="plan-tier-rate">{t('tierRate')}</Label>
                  <Input id="plan-tier-rate" inputMode="decimal" value={tierRate} onChange={(e) => setTierRate(e.target.value)} />
                </div>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="plan-override-on">{t('overrideOn')}</Label>
                <Select id="plan-override-on" value={overrideOn} onChange={(e) => setOverrideOn(e.target.value)}>
                  <option value="">{t('noOverride')}</option>
                  {colleagues
                    .filter((c) => c.user_id !== member?.user_id)
                    .map((c) => (
                      <option key={c.user_id} value={c.user_id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="plan-override-rate">{t('overrideRate')}</Label>
                <Input
                  id="plan-override-rate"
                  inputMode="decimal"
                  value={overrideRate}
                  disabled={overrideOn === ''}
                  onChange={(e) => setOverrideRate(e.target.value)}
                />
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close
                render={
                  <Button type="button" variant="outline">
                    {t('cancel')}
                  </Button>
                }
              />
              <Button type="button" disabled={upsert.isPending || rate.trim() === ''} onClick={handleSave}>
                {upsert.isPending ? t('saving') : t('save')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog.Root>
  );
}
