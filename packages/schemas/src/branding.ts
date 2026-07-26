import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * F-14 white-label branding (white-labeling.md §2).
 *
 * Colours arrive as either a hex the picker produced or an `oklch(L C H)`
 * string, and are stored as OKLCH — perceptual lightness is what makes the dark
 * palette and the contrast fixes predictable (§5, §12).
 */
const OKLCH = /^oklch\(\s*-?[0-9.]+%?\s+-?[0-9.]+\s+-?[0-9.]+\s*\)$/i;
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

/** Either form in, OKLCH out. Rejecting a colour outright would strand a brand. */
export const BrandColor = z
  .string()
  .trim()
  .refine((v) => OKLCH.test(v) || HEX.test(v), {
    message: 'Use a hex colour (#RRGGBB) or an oklch(L C H) value',
  });

export const FontFamily = z.enum(['inter', 'system', 'custom']);
export const Radius = z.enum(['none', 'sm', 'md', 'lg']);
export const Density = z.enum(['comfortable', 'compact']);
export const DarkMode = z.enum(['derived', 'custom', 'disabled']);
export const BrandingStatus = z.enum(['draft', 'published']);

/** One recorded auto-fix, with the numbers that justify it (§12). */
export const ContrastAdjustment = z.object({
  token: z.string(),
  from: z.string(),
  to: z.string(),
  ratioBefore: z.number(),
  ratioAfter: z.number(),
  reason: z.string(),
});

export const TenantBranding = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  display_name: z.string().nullable(),
  legal_name: z.string().nullable(),
  support_email: z.string().nullable(),
  support_phone: z.string().nullable(),
  sms_sender_name: z.string().nullable(),
  ai_persona_name: z.string(),
  logo_light_key: z.string().nullable(),
  logo_dark_key: z.string().nullable(),
  favicon_key: z.string().nullable(),
  email_logo_key: z.string().nullable(),
  login_bg_key: z.string().nullable(),
  primary_color: z.string(),
  accent_color: z.string().nullable(),
  success_color: z.string().nullable(),
  warning_color: z.string().nullable(),
  danger_color: z.string().nullable(),
  info_color: z.string().nullable(),
  font_family: FontFamily,
  font_woff2_key: z.string().nullable(),
  font_woff2_bold_key: z.string().nullable(),
  radius: Radius,
  density: Density,
  dark_mode: DarkMode,
  /**
   * The whole published view, frozen at publish: name, asset keys, font,
   * radius, density, dark-mode strategy and the computed palette. Null until
   * the brand has been published once.
   */
  published_snapshot: z
    .object({
      display_name: z.string().nullable(),
      logo_light_key: z.string().nullable(),
      logo_dark_key: z.string().nullable(),
      favicon_key: z.string().nullable(),
      font_family: FontFamily,
      font_woff2_key: z.string().nullable(),
      font_woff2_bold_key: z.string().nullable(),
      radius: Radius,
      density: Density,
      dark_mode: DarkMode,
      palette: z.record(z.string(), z.record(z.string(), z.string())),
    })
    .nullable(),
  contrast_adjustments: z.array(ContrastAdjustment),
  status: BrandingStatus,
  version: z.number().int(),
  published_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/** Defaults-free (the F-05 lesson): a PUT carries only what it changes. */
export const UpdateBrandingInput = z
  .strictObject({
    // No `store_id` here on purpose: the scope is a query parameter, so a brand
    // can never be moved to a different rooftop by a field sitting in a payload
    // beside a set of colours.
    display_name: z.string().trim().min(1).max(120).nullable().optional(),
    legal_name: z.string().trim().min(1).max(200).nullable().optional(),
    support_email: z.email().nullable().optional(),
    support_phone: z.string().trim().min(1).max(40).nullable().optional(),
    sms_sender_name: z.string().trim().min(1).max(40).nullable().optional(),
    ai_persona_name: z.string().trim().min(1).max(40).optional(),
    logo_light_key: z.string().trim().min(1).max(500).nullable().optional(),
    logo_dark_key: z.string().trim().min(1).max(500).nullable().optional(),
    favicon_key: z.string().trim().min(1).max(500).nullable().optional(),
    email_logo_key: z.string().trim().min(1).max(500).nullable().optional(),
    login_bg_key: z.string().trim().min(1).max(500).nullable().optional(),
    primary_color: BrandColor.optional(),
    accent_color: BrandColor.nullable().optional(),
    success_color: BrandColor.nullable().optional(),
    warning_color: BrandColor.nullable().optional(),
    danger_color: BrandColor.nullable().optional(),
    info_color: BrandColor.nullable().optional(),
    font_family: FontFamily.optional(),
    font_woff2_key: z.string().trim().min(1).max(500).nullable().optional(),
    font_woff2_bold_key: z.string().trim().min(1).max(500).nullable().optional(),
    radius: Radius.optional(),
    density: Density.optional(),
    dark_mode: DarkMode.optional(),
  })
  // An empty body changes nothing; answering 200 to it is a lie (the F-08 lesson).
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to change',
    path: ['primary_color'],
  })
  // A custom font with no file is a font nobody can load — the app would fall
  // back silently and the tenant would think their brand shipped.
  .refine((v) => v.font_family !== 'custom' || v.font_woff2_key !== undefined, {
    message: 'A custom font needs its WOFF2 file',
    path: ['font_woff2_key'],
  });

/** What the SPA loads before first paint — published only, no draft ever. */
export const PublishedBranding = z.object({
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  display_name: z.string().nullable(),
  logo_light_key: z.string().nullable(),
  logo_dark_key: z.string().nullable(),
  favicon_key: z.string().nullable(),
  font_family: FontFamily,
  font_woff2_key: z.string().nullable(),
  font_woff2_bold_key: z.string().nullable(),
  radius: Radius,
  density: Density,
  dark_mode: DarkMode,
  palette: z.record(z.string(), z.record(z.string(), z.string())),
  version: z.number().int(),
});

export type TenantBranding = z.infer<typeof TenantBranding>;
export type UpdateBrandingInput = z.infer<typeof UpdateBrandingInput>;
export type PublishedBranding = z.infer<typeof PublishedBranding>;
