import type {
  AdminTenantSnapshotT,
  SnapshotIntakeKeyT,
  SnapshotStoreHealthT,
} from '@dealpilot/schemas';

/**
 * F-77 — the allow-lists the tenant snapshot page renders from.
 *
 * Each table is checked in two directions. `satisfies readonly (keyof …T)[]`
 * makes a name the wire schema does not carry a compile error; guard (d) in
 * snapshot-secret-guard.test.ts is the consumer for the reverse — the page
 * reads nothing outside these tables, and every top-level key of
 * `AdminTenantSnapshot` is classified exactly once.
 *
 * `id` is deliberately absent from both column tables: it is the React row
 * key and the store↔key join key, never a printed cell — no UUID reaches a
 * text node on this page.
 */

/**
 * The rooftop columns (SnapshotStoreHealth, platform.ts:808-818).
 * `last_message_at` is not a top-level key of a rooftop: it sits inside
 * `traffic_30d` (SnapshotTraffic) beside the three counts.
 */
export const STORE_HEALTH_COLUMNS = [
  'name',
  'code',
  'status',
  'timezone',
  'sms_number',
  'business_hours_set',
  'traffic_30d',
] as const satisfies readonly (keyof SnapshotStoreHealthT)[];

/**
 * The intake-key columns (SnapshotIntakeKey, platform.ts:821-830). The wire
 * carries these six plus `id` and nothing else, and this table cannot name
 * what the schema does not.
 */
export const INTAKE_KEY_COLUMNS = [
  'label',
  'provider',
  'store_id',
  'active',
  'revoked_at',
  'last_lead_accepted_at',
] as const satisfies readonly (keyof SnapshotIntakeKeyT)[];

/**
 * Every top-level key of `AdminTenantSnapshot`, classified once: rendered on
 * the snapshot page, or left to the tenant detail page — the producer of the
 * `AdminTenantDetail` half the snapshot spreads. Guard (d) asserts the union
 * is exactly `Object.keys(AdminTenantSnapshot.shape)` (12 + 19 = 31) and the
 * halves are disjoint, so a new schema key fails until someone decides where
 * it is shown.
 */
export const SNAPSHOT_TOP_LEVEL = {
  rendered: [
    'id',
    'name',
    'plan_code',
    'status',
    'deleted_at',
    'seats_provisioned',
    'store_health',
    'intake_keys',
    'comms_config',
    'branding',
    'connectors_active',
    'platform',
  ],
  detailPage: [
    'slug',
    'legal_name',
    'plan_id',
    'province',
    'default_locale',
    'store_count',
    'member_count',
    'created_at',
    'activated_at',
    'suspended_at',
    'trial_ends_at',
    'privacy_officer_name',
    'privacy_officer_email',
    'stripe_customer_id',
    'stores',
    'owner_emails',
    'last_activity_at',
    'allowed_transitions',
    'owner_invitation',
  ],
} as const satisfies {
  rendered: readonly (keyof AdminTenantSnapshotT)[];
  detailPage: readonly (keyof AdminTenantSnapshotT)[];
};
