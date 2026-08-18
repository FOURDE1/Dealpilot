import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Contact,
  Deal,
  DuplicateMatch,
  MergeContactsResult,
  paginated,
  type CreateContactInputT,
  type MergeContactsInputT,
  type UpdateContactInputT,
} from '@dealpilot/schemas';
import { z } from 'zod';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { dealKeys } from '../deals/api.js';
import { leadKeys } from '../leads/api.js';

const PaginatedContacts = paginated(Contact);
const CreateResponse = z.object({ contact: Contact, duplicates: z.array(DuplicateMatch) });

export const contactKeys = {
  all: ['contacts'] as const,
  list: (orgId: string | undefined, q: string) => ['contacts', 'list', orgId ?? 'single-org', q] as const,
  detail: (id: string) => ['contacts', id] as const,
};

export function useContacts(orgId?: string, opts?: { enabled?: boolean; q?: string }) {
  const q = opts?.q?.trim() ?? '';
  return useQuery({
    queryKey: contactKeys.list(orgId, q),
    enabled: opts?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.contacts.list, {
        query: { limit: 100, organization_id: orgId, ...(q === '' ? {} : { q }) },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return PaginatedContacts.parse(res.body);
    },
  });
}

export function useContact(id: string) {
  return useQuery({
    queryKey: contactKeys.detail(id),
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.contacts.get, { params: { id }, signal });
      if (res.status !== 200) fail(res.status, res.body);
      return Contact.parse(res.body);
    },
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateContactInputT) => {
      const res = await apiRequest(routes.contacts.create, { body: input });
      if (res.status !== 201) fail(res.status, res.body);
      return CreateResponse.parse(res.body);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: contactKeys.all }),
  });
}

export function useUpdateContact(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateContactInputT) => {
      const res = await apiRequest(routes.contacts.update, { params: { id }, body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return Contact.parse(res.body);
    },
    onSuccess: (contact) => {
      queryClient.setQueryData(contactKeys.detail(id), contact);
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
    },
  });
}

export function useMergeContacts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MergeContactsInputT) => {
      const res = await apiRequest(routes.contacts.merge, { body: input });
      if (res.status !== 200) fail(res.status, res.body);
      return MergeContactsResult.parse(res.body);
    },
    onSuccess: () => {
      // A merge moves deals and leads, not just contacts — their caches now
      // name a customer that no longer exists. Invalidate all three.
      void queryClient.invalidateQueries({ queryKey: contactKeys.all });
      void queryClient.invalidateQueries({ queryKey: dealKeys.all });
      void queryClient.invalidateQueries({ queryKey: leadKeys.all });
    },
  });
}

/** Every deal this customer is a party to — buyer or cosigner (FR-CON-006). */
export function useContactDeals(contactId: string, orgId?: string) {
  return useQuery({
    queryKey: ['deals', 'for-contact', contactId],
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.deals.list, {
        query: { contact_id: contactId, organization_id: orgId, limit: 100 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return paginated(Deal).parse(res.body);
    },
  });
}
