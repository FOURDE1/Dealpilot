/**
 * Design tokens locked by D-024 (H-01 — direction "Nordique", owner pick 2026-07-23).
 * This file is the single source of truth: `tokens.css` is generated from these
 * values at build time (see generate-css.ts) and the WCAG contrast gate in
 * contrast.test.ts asserts the pairings D-024 requires. Change tokens only
 * through a superseding DECISIONS.md entry.
 *
 * Values are sRGB hex (as rendered in the winning Stitch direction); the OKLCH
 * equivalents are recorded in D-024. Tenant-branding OKLCH derivation (ADR-018)
 * is runtime work in packages/core, not here.
 */

/** Primitive layer — static reference ramps. Never referenced by components. */
export const primitives = {
  blue: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
  },
  neutralLight: {
    page: '#F5F7FA',
    card: '#FFFFFF',
    input: '#F9FAFB',
    border: '#E5E7EB',
    borderSubtle: '#F3F4F6',
    text: '#1A1D23',
    textSecondary: '#6B7280',
    /** Derived AA variant (D-024 §12 rule): secondary text on tinted surfaces. */
    textSecondaryStrong: '#4B5563',
    textMuted: '#9CA3AF',
  },
  neutralDark: {
    page: '#0F1117',
    sidebar: '#141720',
    card: '#1A1D27',
    elevated: '#232738',
    input: '#1A1D27',
    border: '#2A2D3A',
    borderSubtle: '#1F2231',
    text: '#F0F2F5',
    textSecondary: '#9CA3AF',
    textMuted: '#6B7280',
  },
  status: {
    success: '#10B981',
    successDark: '#34D399',
    successTint: '#D1FAE5',
    successTintDark: '#064E3B',
    warning: '#F59E0B',
    warningDark: '#FBBF24',
    warningTint: '#FEF3C7',
    warningTintDark: '#451A03',
    /** F-52 (D-054): the be-back urgency ramp needs a YELLOW distinct from
     * warning's amber. AA-gated pairs: 8.0:1 light, 10.9:1 dark. */
    caution: '#EAB308',
    cautionText: '#854D0E',
    cautionTextDark: '#FACC15',
    cautionTint: '#FEF9C3',
    cautionTintDark: '#422006',
    danger: '#EF4444',
    /** Derived AA fill variant (D-024 §12 rule): white text 4.83:1. */
    dangerStrong: '#DC2626',
    /** Derived AA text/hover variant: on page 6.03:1, white on it 6.47:1. */
    dangerDeep: '#B91C1C',
    /** Dark-theme destructive hover fill (near-black text 8.89:1). */
    dangerSoft: '#FCA5A5',
    dangerDark: '#F87171',
    dangerTint: '#FEE2E2',
    dangerTintDark: '#450A0A',
    info: '#6366F1',
    /** Derived AA fill variant (D-024 §12 rule): white text 6.29:1. */
    infoStrong: '#4F46E5',
    infoDark: '#818CF8',
    infoTint: '#EEF2FF',
    infoTintDark: '#1E1B4B',
    /** D-024 status-as-TEXT variants, light theme (dark theme reuses *Dark). */
    successText: '#047857',
    warningText: '#B45309',
  },
} as const;

/** Motion durations (ui-design-system §11) — mapped to Tailwind duration-fast/normal/slow. */
export const durations = {
  fast: '150ms',
  normal: '250ms',
  slow: '350ms',
} as const;

/**
 * Semantic layer, light theme. shadcn variable names (ui-design-system §2) so
 * vendored components consume tokens untouched. Components reference ONLY this
 * layer — never primitives, never raw hex (release blocker per ADR-018).
 *
 * D-024 contrast rules encoded here:
 * - `primary` is blue-600, the AA-safe interactive tone (white foreground
 *   5.17:1; as link text on page 4.82:1).
 * - blue-500 is the brand accent (`ring`, `chart-1`) — 3:1 class only, never
 *   text on white.
 */
export const semanticLight = {
  background: primitives.neutralLight.page,
  foreground: primitives.neutralLight.text,
  card: primitives.neutralLight.card,
  'card-foreground': primitives.neutralLight.text,
  popover: primitives.neutralLight.card,
  'popover-foreground': primitives.neutralLight.text,
  primary: primitives.blue[600],
  'primary-foreground': '#FFFFFF',
  'primary-hover': primitives.blue[700],
  secondary: primitives.neutralLight.borderSubtle,
  'secondary-foreground': primitives.neutralLight.text,
  muted: primitives.neutralLight.borderSubtle,
  'muted-foreground': primitives.neutralLight.textSecondaryStrong,
  accent: primitives.blue[50],
  'accent-foreground': primitives.blue[700],
  destructive: primitives.status.dangerStrong,
  'destructive-foreground': '#FFFFFF',
  'destructive-hover': primitives.status.dangerDeep,
  success: primitives.status.success,
  'success-foreground': primitives.neutralLight.text,
  warning: primitives.status.warning,
  'warning-foreground': primitives.neutralLight.text,
  info: primitives.status.infoStrong,
  'info-foreground': '#FFFFFF',
  'success-text': primitives.status.successText,
  'warning-text': primitives.status.warningText,
  'caution-text': primitives.status.cautionText,
  'danger-text': primitives.status.dangerDeep,
  'info-text': primitives.status.infoStrong,
  // Status surfaces: tint fills the *-text colors sit on (AA-gated pairs).
  'success-bg': primitives.status.successTint,
  'warning-bg': primitives.status.warningTint,
  'caution-bg': primitives.status.cautionTint,
  'danger-bg': '#FEE2E2',
  'danger-border': primitives.status.dangerStrong,
  border: primitives.neutralLight.border,
  // shadcn semantic: --input is the form-field BORDER; the fill is --input-bg.
  input: primitives.neutralLight.border,
  'input-bg': primitives.neutralLight.input,
  ring: primitives.blue[500],
  sidebar: primitives.neutralLight.card,
  'sidebar-foreground': primitives.neutralLight.text,
  'sidebar-primary': primitives.blue[600],
  'sidebar-primary-foreground': '#FFFFFF',
  'sidebar-accent': primitives.blue[50],
  'sidebar-accent-foreground': primitives.blue[700],
  'sidebar-border': primitives.neutralLight.border,
  'sidebar-ring': primitives.blue[500],
  'chart-1': primitives.blue[500],
  'chart-2': primitives.blue[300],
  'chart-3': primitives.blue[700],
  'chart-4': primitives.status.success,
  'chart-5': primitives.status.warning,
} as const;

/**
 * Semantic layer, dark theme. Dark `primary` is blue-400 with a near-black
 * foreground (6.64:1); elevation is lighter surfaces, not shadows (§6).
 */
export const semanticDark: Record<keyof typeof semanticLight, string> = {
  background: primitives.neutralDark.page,
  foreground: primitives.neutralDark.text,
  card: primitives.neutralDark.card,
  'card-foreground': primitives.neutralDark.text,
  popover: primitives.neutralDark.elevated,
  'popover-foreground': primitives.neutralDark.text,
  primary: primitives.blue[400],
  'primary-foreground': primitives.neutralLight.text,
  'primary-hover': primitives.blue[300],
  secondary: primitives.neutralDark.elevated,
  'secondary-foreground': primitives.neutralDark.text,
  muted: primitives.neutralDark.borderSubtle,
  'muted-foreground': primitives.neutralDark.textSecondary,
  accent: primitives.neutralDark.elevated,
  'accent-foreground': primitives.blue[300],
  destructive: primitives.status.dangerDark,
  'destructive-foreground': primitives.neutralLight.text,
  'destructive-hover': primitives.status.dangerSoft,
  success: primitives.status.successDark,
  'success-foreground': primitives.neutralLight.text,
  warning: primitives.status.warningDark,
  'warning-foreground': primitives.neutralLight.text,
  info: primitives.status.infoDark,
  'info-foreground': primitives.neutralLight.text,
  'success-text': primitives.status.successDark,
  'warning-text': primitives.status.warningDark,
  'caution-text': primitives.status.cautionTextDark,
  'danger-text': primitives.status.dangerDark,
  'info-text': primitives.status.infoDark,
  'success-bg': primitives.status.successTintDark,
  'warning-bg': primitives.status.warningTintDark,
  'caution-bg': primitives.status.cautionTintDark,
  'danger-bg': '#450A0A',
  'danger-border': primitives.status.dangerDark,
  border: primitives.neutralDark.border,
  input: primitives.neutralDark.border,
  'input-bg': primitives.neutralDark.card,
  ring: primitives.blue[400],
  sidebar: primitives.neutralDark.sidebar,
  'sidebar-foreground': primitives.neutralDark.text,
  'sidebar-primary': primitives.blue[400],
  'sidebar-primary-foreground': primitives.neutralLight.text,
  'sidebar-accent': primitives.neutralDark.elevated,
  'sidebar-accent-foreground': primitives.blue[300],
  'sidebar-border': primitives.neutralDark.border,
  'sidebar-ring': primitives.blue[400],
  'chart-1': primitives.blue[400],
  'chart-2': primitives.blue[200],
  'chart-3': primitives.blue[600],
  'chart-4': primitives.status.successDark,
  'chart-5': primitives.status.warningDark,
} as const;

/** Component layer — layout/motion constants (ui-design-system §5, §11). */
export const componentTokens = {
  radius: '0.5rem',
  'sidebar-width': '240px',
  'sidebar-collapsed-width': '60px',
  'topbar-height': '56px',
  'kanban-col-min-w': '280px',
  'row-h': '44px',
  'cell-py': '10px',
  'transition-fast': '150ms ease',
  'transition-normal': '250ms ease',
  'transition-slow': '350ms ease',
} as const;

/** Density overrides applied via `[data-density="compact"]` (§5). */
export const densityCompact = {
  'row-h': '34px',
  'cell-py': '6px',
} as const;

export type SemanticToken = keyof typeof semanticLight;
