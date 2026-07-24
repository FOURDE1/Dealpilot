import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BackLink } from '../../shared/ui/back-link.js';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
} from '@dealpilot/ui';
import { z } from 'zod';
import { CreateLeadInput, LEAD_SOURCES, type CreateLeadInputT } from '@dealpilot/schemas';
import { LOCALES } from '@dealpilot/i18n';
import { ApiError } from '../../shared/api/client.js';

/**
 * Form values = schema INPUT (defaults optional); submit gets the OUTPUT.
 * Optional text fields normalize '' → undefined BEFORE validation, so a
 * typed-then-cleared field is genuinely blank instead of failing min(1).
 */
const emptyToUndefined = <T extends z.ZodType>(schema: T) =>
  schema.or(z.literal('').transform(() => undefined));

const LeadFormSchema = CreateLeadInput.extend({
  first_name: emptyToUndefined(CreateLeadInput.shape.first_name),
  last_name: emptyToUndefined(CreateLeadInput.shape.last_name),
  email: emptyToUndefined(CreateLeadInput.shape.email),
  vehicle_interest: emptyToUndefined(CreateLeadInput.shape.vehicle_interest),
  // The canonical phone schema hardcodes an ENGLISH message — re-validate via
  // a custom issue so the localized error map speaks (Bill 96). The server
  // still normalizes to E.164 at its own boundary.
  phone: z.string().superRefine((value, ctx) => {
    if (!CreateLeadInput.shape.phone.safeParse(value).success) {
      ctx.addIssue({ code: 'custom' });
    }
  }),
});
type LeadFormValues = z.input<typeof LeadFormSchema>;
import { useOrganizations, useStores } from '../organizations/api.js';
import { useCreateLead } from './api.js';
import { LEAD_SOURCE_KEYS } from './labels.js';

/**
 * First consumer of the H-05 Form composition: client-side zod validation
 * with the SAME CreateLeadInput schema the server parses (frontend-stack §6).
 */
export function LeadNewPage() {
  const { t } = useTranslation('leads');
  const { t: tCommonLocale } = useTranslation('orgs');
  const navigate = useNavigate();
  const createLead = useCreateLead();
  const orgs = useOrganizations();
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<LeadFormValues, unknown, CreateLeadInputT>({
    resolver: zodResolver(LeadFormSchema),
    defaultValues: {
      organization_id: '',
      store_id: '',
      phone: '',
      source: 'manual',
      preferred_language: 'fr-CA',
    },
  });

  const orgId = form.watch('organization_id');
  const stores = useStores(orgId || '');

  // Single-org users skip the org picker mentally — preselect for them.
  useEffect(() => {
    if (orgs.data?.items.length === 1 && !form.getValues('organization_id')) {
      form.setValue('organization_id', orgs.data.items[0]?.id ?? '');
    }
  }, [orgs.data, form]);

  // A store belongs to ONE org — never let a stale selection cross over.
  const previousOrg = useRef(orgId);
  useEffect(() => {
    if (previousOrg.current !== orgId) {
      previousOrg.current = orgId;
      form.resetField('store_id', { defaultValue: '' });
    }
  }, [orgId, form]);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function onSubmit(values: CreateLeadInputT) {
    setError(null);
    try {
      const lead = await createLead.mutateAsync(values);
      navigate(`/leads/${lead.id}`, { replace: true });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(err.status === 422 ? t('invalidInput') : t('genericError'));
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <BackLink to={"/leads"}>{t('back')}</BackLink>
      <h1 className="text-2xl font-semibold">{t('newLead')}</h1>
      <Form {...form}>
        <form
          onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
          className="space-y-4 rounded-lg border border-border bg-card p-6"
          noValidate
        >
          <FormField
            control={form.control}
            name="organization_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('organization')}</FormLabel>
                <FormControl>
                  <Select {...field}>
                    <option value="" disabled>
                      —
                    </option>
                    {(orgs.data?.items ?? []).map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="store_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('store')}</FormLabel>
                <FormControl>
                  <Select {...field} disabled={!orgId}>
                    <option value="" disabled>
                      —
                    </option>
                    {(stores.data?.items ?? []).map((store) => (
                      <option key={store.id} value={store.id}>
                        {store.name}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('phone')}</FormLabel>
                <FormControl>
                  <Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+15145551234" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="first_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('firstName')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="last_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('lastName')}</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="source"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('sourceCol')}</FormLabel>
                <FormControl>
                  <Select {...field}>
                    {LEAD_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {t(LEAD_SOURCE_KEYS[source])}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('email')}</FormLabel>
                <FormControl>
                  <Input type="email" inputMode="email" autoComplete="off" {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="preferred_language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('preferredLanguage')}</FormLabel>
                <FormControl>
                  <Select {...field}>
                    {LOCALES.map((locale) => (
                      <option key={locale} value={locale}>
                        {locale === 'fr-CA' ? tCommonLocale('localeFr') : tCommonLocale('localeEn')}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vehicle_interest"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('vehicleInterest')}</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error ? (
            <p
              ref={alertRef}
              tabIndex={-1}
              role="alert"
              className="rounded-md border border-destructive px-3 py-2 text-sm text-danger-text"
            >
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={createLead.isPending}>
            {createLead.isPending ? t('saving') : t('create')}
          </Button>
        </form>
      </Form>
    </div>
  );
}
