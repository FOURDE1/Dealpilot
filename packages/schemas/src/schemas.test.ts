import { describe, expect, it } from 'vitest';
import {
  MESSAGE_KEYS,
  CreateLeadInput,
  CreateOrganizationInput,
  CreateStoreInput,
  Email,
  LeadSource,
  LeadStatus,
  Membership,
  MoneyCents,
  PhoneE164,
  PostalCodeCA,
  Role,
  UpdateLeadInput,
  UpdateOrganizationInput,
  UpdateStoreInput,
  UpdateUserInput,
} from './index.js';

const UUID_A = '5e6f7a80-1b2c-4d3e-8f90-a1b2c3d4e5f6';
const UUID_B = '0f1e2d3c-4b5a-4c6d-9e8f-102132435465';

describe('PhoneE164', () => {
  it('normalizes human formats to E.164', () => {
    expect(PhoneE164.parse('(819) 555-0123')).toBe('+18195550123');
    expect(PhoneE164.parse('1 819 555 0123')).toBe('+18195550123');
    expect(PhoneE164.parse('819.555.0123')).toBe('+18195550123');
  });
  it('rejects numbers that are not 10-digit NANP', () => {
    expect(() => PhoneE164.parse('555-0123')).toThrow();
    expect(() => PhoneE164.parse('abc')).toThrow();
    expect(() => PhoneE164.parse('+44 20 7946 0958')).toThrow();
  });
});

describe('Email', () => {
  it('trims and lowercases before validating', () => {
    expect(Email.parse('  Hassan@ReadyCar.CA ')).toBe('hassan@readycar.ca');
  });
  it('rejects invalid emails', () => {
    expect(() => Email.parse('not-an-email')).toThrow();
  });
});

describe('PostalCodeCA', () => {
  it('normalizes to "A1A 1A1"', () => {
    expect(PostalCodeCA.parse('j9l3g1')).toBe('J9L 3G1');
    expect(PostalCodeCA.parse('J9L 3G1')).toBe('J9L 3G1');
  });
  it('rejects non-Canadian formats', () => {
    expect(() => PostalCodeCA.parse('12345')).toThrow();
  });
});

describe('MoneyCents', () => {
  it('accepts integers only — money is integer cents (ADR-009)', () => {
    expect(MoneyCents.parse(1999)).toBe(1999);
    expect(() => MoneyCents.parse(19.99)).toThrow();
  });
});

describe('vocabularies', () => {
  it('Role: the 10 canonical roles and nothing else', () => {
    expect(Role.parse('bdc_agent')).toBe('bdc_agent');
    expect(() => Role.parse('admin')).toThrow();
  });
  it('LeadStatus: the 10-state machine from leads.md', () => {
    expect(LeadStatus.parse('chatbot_engaged')).toBe('chatbot_engaged');
    expect(() => LeadStatus.parse('working')).toThrow();
  });
  it('LeadSource: canonical source enum from leads.md §2.1', () => {
    expect(LeadSource.parse('meta_lead_form')).toBe('meta_lead_form');
    expect(() => LeadSource.parse('facebook')).toThrow();
  });
});

describe('update inputs never inject defaults (defaults-leak regression)', () => {
  it('an empty PATCH body parses to an empty object', () => {
    expect(UpdateOrganizationInput.parse({})).toEqual({});
    expect(UpdateStoreInput.parse({})).toEqual({});
    expect(UpdateUserInput.parse({})).toEqual({});
    expect(UpdateLeadInput.parse({})).toEqual({});
  });
});

describe('input schemas are strict', () => {
  it('rejects unknown keys instead of silently stripping them', () => {
    expect(() =>
      CreateOrganizationInput.parse({ name: 'X', slug: 'x-y-z', is_admin: true }),
    ).toThrow();
    expect(() => UpdateLeadInput.parse({ statuss: 'lost' })).toThrow();
  });
});

describe('CreateLeadInput', () => {
  const base = {
    organization_id: UUID_A,
    store_id: UUID_B,
    source: 'website',
    phone: '819 555 0123',
  };
  it('requires phone (leads.md §1: phone NOT NULL) and normalizes it', () => {
    const noPhone = { organization_id: base.organization_id, store_id: base.store_id, source: base.source };
    expect(() => CreateLeadInput.parse(noPhone)).toThrow();
    expect(CreateLeadInput.parse(base).phone).toBe('+18195550123');
  });
  it('leads are born new — status is not accepted on create', () => {
    expect(() => CreateLeadInput.parse({ ...base, status: 'converted' })).toThrow();
  });
  it('score is engine-owned — not accepted on create or update', () => {
    expect(() => CreateLeadInput.parse({ ...base, score: 100 })).toThrow();
    expect(() => UpdateLeadInput.parse({ score: 100 })).toThrow();
  });
  it('defaults preferred_language to fr-CA (Bill 96)', () => {
    expect(CreateLeadInput.parse(base).preferred_language).toBe('fr-CA');
  });
});

describe('CreateStoreInput', () => {
  it('normalizes code to uppercase (spec example KIA-ML)', () => {
    const store = CreateStoreInput.parse({
      organization_id: UUID_A,
      name: 'Kia Mont-Laurier',
      code: 'kia-ml',
      province: 'QC',
    });
    expect(store.code).toBe('KIA-ML');
    expect(store.timezone).toBe('America/Montreal');
  });
});

describe('Membership', () => {
  it('requires at least one role', () => {
    const m = {
      id: UUID_A,
      user_id: UUID_B,
      organization_id: UUID_A,
      store_id: null,
      roles: [],
      status: 'active',
      created_at: '2026-07-24T12:00:00Z',
      updated_at: '2026-07-24T12:00:00Z',
    };
    expect(() => Membership.parse(m)).toThrow();
    expect(Membership.parse({ ...m, roles: ['owner'] }).roles).toEqual(['owner']);
  });
});

describe('message keys (A-10 — client-localizable validation)', () => {
  // zod's safeParse result is a discriminated union; read the first issue's
  // key through a narrow view of the error shape.
  const keyOf = (r: { success: boolean; error?: unknown }): string | undefined => {
    const issues = (r.error as { issues?: { params?: { key?: string } }[] } | undefined)?.issues;
    return issues?.[0]?.params?.key;
  };

  it('every domain constraint carries a stable key instead of an English literal', () => {
    expect(keyOf(PhoneE164.safeParse('123'))).toBe(MESSAGE_KEYS.phone_nanp);
    expect(keyOf(PostalCodeCA.safeParse('90210'))).toBe(MESSAGE_KEYS.postal_code_ca);
    expect(keyOf(CreateOrganizationInput.safeParse({ name: 'X', slug: 'Bad Slug' }))).toBe(
      MESSAGE_KEYS.org_slug_format,
    );
    expect(keyOf(CreateOrganizationInput.safeParse({ name: 'X', slug: 'admin' }))).toBe(
      MESSAGE_KEYS.org_slug_reserved,
    );
    expect(keyOf(CreateStoreInput.safeParse({ organization_id: crypto.randomUUID(), name: 'S', code: 'a b', province: 'QC' }))).toBe(
      MESSAGE_KEYS.store_code_format,
    );
  });

  it('keys are stable strings the web app can map to FR/EN text', () => {
    for (const key of Object.values(MESSAGE_KEYS)) {
      expect(key).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('CreateOrganizationInput', () => {
  it('enforces kebab-case slug and FR-first defaults', () => {
    const org = CreateOrganizationInput.parse({ name: 'Kia Mont-Laurier', slug: 'kia-mont-laurier' });
    expect(org.default_locale).toBe('fr-CA');
    // plan_tier/status defaults moved server-side (platform authority, D-028).
    expect(() => CreateOrganizationInput.parse({ name: 'X', slug: 'Kia ML' })).toThrow();
  });

  it('rejects reserved slugs (subdomain/intake namespace collisions)', () => {
    for (const slug of ['www', 'api', 'app', 'admin', 'status']) {
      expect(() => CreateOrganizationInput.parse({ name: 'X', slug })).toThrow();
    }
  });

  it('status and plan_tier are platform authority — not accepted from clients', () => {
    expect(() =>
      CreateOrganizationInput.parse({ name: 'X', slug: 'x-y-z', plan_tier: 'enterprise' }),
    ).toThrow();
    expect(() =>
      CreateOrganizationInput.parse({ name: 'X', slug: 'x-y-z', status: 'active' }),
    ).toThrow();
    expect(() => UpdateOrganizationInput.parse({ status: 'active' })).toThrow();
    expect(() => UpdateOrganizationInput.parse({ plan_tier: 'scale' })).toThrow();
  });
});

describe('UpdateOrganizationInput', () => {
  it('slug is immutable after creation — update rejects it', () => {
    // multi-tenancy.md §7: the slug drives subdomains + intake URLs, never renamed.
    expect(() => UpdateOrganizationInput.parse({ slug: 'new-slug' })).toThrow();
    expect(UpdateOrganizationInput.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });
});
