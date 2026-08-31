import { describe, expect, it } from 'vitest';
import { oklchToHex, SURFACE_DARK, SURFACE_LIGHT } from '@dealpilot/core';
import { relativeLuminance, semanticDark, semanticLight } from '@dealpilot/ui';
import { SURFACES, worstCaseSurfaces } from './brand-style.js';

/**
 * F-75 (D-076) — core proves a brand's text tone and ring against
 * SURFACE_LIGHT / SURFACE_DARK; the SPA re-proves against
 * `worstCaseSurfaces()`, computed from the token source. The two must be one
 * value: a token edit that darkens a light surface or lightens a dark one must
 * redden this test until core follows, or a "proven" tone would ship at less
 * than 4.5:1 on a surface the app actually paints.
 */
describe('proof surfaces are in lockstep with the token source', () => {
  it('SURFACE_LIGHT is the min-luminance light surface', () => {
    const light = SURFACES.map((name) => semanticLight[name]).reduce((worst, hex) =>
      relativeLuminance(hex) < relativeLuminance(worst) ? hex : worst,
    );
    expect(worstCaseSurfaces().light).toBe(light);
    expect(oklchToHex(SURFACE_LIGHT)).toBe(light.toLowerCase());
  });

  it('SURFACE_DARK is the max-luminance dark surface', () => {
    const dark = SURFACES.map((name) => semanticDark[name]).reduce((worst, hex) =>
      relativeLuminance(hex) > relativeLuminance(worst) ? hex : worst,
    );
    expect(worstCaseSurfaces().dark).toBe(dark);
    expect(oklchToHex(SURFACE_DARK)).toBe(dark.toLowerCase());
  });

  it('the SURFACES list covers every semantic token that names a surface', () => {
    const surfaceNames = Object.keys(semanticLight).filter((name) =>
      /^(background|card|popover|muted|secondary|input-bg|sidebar|accent|sidebar-accent)$/.test(name),
    );
    expect(surfaceNames.length).toBe(SURFACES.length);
    for (const name of surfaceNames) expect(SURFACES as readonly string[]).toContain(name);
  });
});
