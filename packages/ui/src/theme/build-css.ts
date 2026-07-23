import {
  primitives,
  semanticLight,
  semanticDark,
  componentTokens,
  densityCompact,
  durations,
} from './tokens.js';

const PRIMITIVE_PREFIX: Record<string, string> = {
  blue: 'blue',
  neutralLight: 'neutral-light',
  neutralDark: 'neutral-dark',
  status: 'status',
};

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const block = (entries: Record<string, string>, indent = '  ') =>
  Object.entries(entries)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n');

/**
 * Builds tokens.css from the D-024 token source. Pure — the same function is
 * unit-tested and executed by scripts/generate-css.mjs at build time, so the
 * shipped CSS can never drift from the values the contrast gate asserts.
 */
export function buildTokensCss(): string {
  const primitiveVars: Record<string, string> = {};
  for (const [group, ramp] of Object.entries(primitives)) {
    const prefix = PRIMITIVE_PREFIX[group];
    if (prefix === undefined) {
      throw new Error(`Unknown primitive group "${group}" — add it to PRIMITIVE_PREFIX`);
    }
    for (const [key, hex] of Object.entries(ramp)) {
      primitiveVars[`${prefix}-${kebab(key)}`] = hex;
    }
  }

  const css = `/* GENERATED from src/theme/tokens.ts (locked by D-024) — do not edit by hand. */

/* Make Tailwind scan this package's shipped JS for component class names —
   without this, an app importing the library gets no utilities for them. */
@source './';

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  /* primitive layer */
${block(primitiveVars)}

  /* semantic layer (light) */
${block(semanticLight)}

  /* component layer */
${block(componentTokens)}
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
}

[data-theme="dark"] {
${block(semanticDark)}
}

[data-density="compact"] {
${block(densityCompact)}
}

@theme inline {
${Object.keys(semanticLight)
  .map((name) => `  --color-${name}: var(--${name});`)
  .join('\n')}
  --font-sans: var(--font-sans);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
${Object.entries(durations)
  .map(([name, value]) => `  --transition-duration-${name}: ${value};`)
  .join('\n')}
}
`;

  if (css.includes('undefined')) {
    throw new Error('Generated CSS contains "undefined" — a token value is missing');
  }
  return css;
}
