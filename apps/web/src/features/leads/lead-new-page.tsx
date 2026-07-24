import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
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
import type { z } from 'zod';
import { CreateLeadInput, LEAD_SOURCES, type CreateLeadInputT } from '@dealpilot/schemas';

/** Form values = schema INPUT (defaults optional); submit gets the OUTPUT. */
type LeadFormValues = z.input<typeof CreateLeadInput>;
import { useOrganizations, useStores } from '../organizations/api.js';
import { useCreateLead } from './api.js';
import { formErrorMessage } from '../organizations/form-error.js';
import { LEAD_SOURCE_KEYS } from './labels.js';

/**
 * First consumer of the H-05 Form composition: client-side zod validation
 * with the SAME CreateLeadInput schema the server parses (frontend-stack §6).
 */
export function LeadNewPage() {
  const { t } = useTranslation('leads');
  const { t: tOrgs } = useTranslation('orgs');
  const navigate = useNavigate();
  const createLead = useCreateLead();
  const orgs = useOrganizations();
  const [error, setError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<LeadFormValues, unknown, CreateLeadInputT>({
    resolver: zodResolver(CreateLeadInput),
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

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function onSubmit(values: CreateLeadInputT) {
    setError(null);
    try {
      const lead = await createLead.mutateAsync(values);
      navigate(`/leads/${lead.id}`, { replace: true });
    } catch (err) {
      setError(formErrorMessage(tOrgs, err, 'slug'));
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link to="/leads" className="text-sm font-medium text-primary hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center">
        ← {t('back')}
      </Link>
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
