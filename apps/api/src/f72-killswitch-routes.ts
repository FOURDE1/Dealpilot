import type { FastifyInstance } from 'fastify';
import type { Pool } from '@dealpilot/db';
import {
  PlatformSettingKey,
  SetPlatformSettingInput,
  type PlatformSettingT,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { definer } from './f69-admin-routes.js';
import { requirePlatform } from './platform.js';
import { resetKillSwitchCache } from './platform-settings.js';

/**
 * F-72 — the platform kill switches (admin-console.md §5.3; D-073).
 *
 * Two handlers. The READ goes through `admin_list_platform_settings()` and
 * never through the TTL cache in `platform-settings.ts`: a staffer who has
 * just flipped a switch must see the truth, not a five-second-old picture of
 * it. The WRITE is `platform_super_admin` alone, enforced by the capability
 * here and re-asserted by the definer.
 *
 * §5.3 says flipping one "emits a Sentry event + Better Stack incident".
 * Neither is wired into this codebase and F-72 does not invent them. What a
 * flip actually produces is three real things: an immutable
 * `platform_audit_events` row, the WARN line below (whose stable message token
 * a log drain can alert on), and the standing banner in the console shell.
 * That is recorded as a deviation in D-073 and in SECURITY.md.
 */

interface SettingRow {
  setting_key: string;
  enabled: boolean;
  reason: string | null;
  changed_at: Date;
  changed_by_email: string | null;
}

const settingOf = (row: SettingRow): PlatformSettingT => ({
  setting_key: row.setting_key as PlatformSettingT['setting_key'],
  enabled: row.enabled,
  reason: row.reason,
  changed_by_email: row.changed_by_email,
  changed_at: row.changed_at.toISOString(),
});

export function registerF72KillSwitchRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/admin/platform-settings', async (request, reply) => {
    const actor = requirePlatform(request, 'settings:read');
    const r = await definer(() =>
      pool.query<SettingRow>('SELECT * FROM admin_list_platform_settings($1::uuid)', [actor.userId]),
    );
    return reply.send({ items: r.rows.map(settingOf) });
  });

  app.post('/api/v1/admin/platform-settings/:setting_key', async (request, reply) => {
    const actor = requirePlatform(request, 'settings:write');
    const parsed = PlatformSettingKey.safeParse((request.params as { setting_key?: string }).setting_key);
    // An unknown key is a 404, never a hint about which keys exist.
    if (!parsed.success) throw notFound();
    const settingKey = parsed.data;
    const input = parseOrThrow(SetPlatformSettingInput, request.body);
    // Stopping is one click and a reason: at 3am, fast matters. RESUMING
    // releases a backlog onto real customers, so it costs typing the switch
    // name back — the F-69 confirm_slug idea, pointed at the dangerous
    // direction rather than the safe one.
    if (!input.enabled && input.confirm_setting_key !== settingKey) {
      throw new AppError(422, 'validation_failed', 'Type the switch name to resume sending', [
        { path: 'confirm_setting_key', code: 'key_mismatch', message: 'The name does not match' },
      ]);
    }
    await definer(() =>
      pool.query('SELECT admin_set_platform_setting($1::uuid, $2::text, $3::boolean, $4::text)', [
        actor.userId,
        settingKey,
        input.enabled,
        input.reason,
      ]),
    );
    // This process obeys immediately; every other waits out KILL_SWITCH_TTL_MS.
    resetKillSwitchCache();
    request.log.warn(
      { settingKey, enabled: input.enabled, staffUserId: actor.userId, role: actor.role },
      'platform_killswitch_flipped',
    );
    const after = await definer(() =>
      pool.query<SettingRow>('SELECT * FROM admin_list_platform_settings($1::uuid)', [actor.userId]),
    );
    const row = after.rows.find((s) => s.setting_key === settingKey);
    if (!row) throw notFound();
    return reply.send(settingOf(row));
  });
}
