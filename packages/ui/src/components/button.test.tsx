import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, buttonVariants } from './button.js';

describe('Button', () => {
  it('renders a real <button type="button"> with the primary token classes by default', () => {
    const html = renderToStaticMarkup(<Button>Enregistrer</Button>);
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('bg-primary');
    expect(html).toContain('text-primary-foreground');
    expect(html).toContain('focus-visible:ring-ring');
  });

  it('maps each variant to its semantic token, never a raw palette class', () => {
    const variantTokens = {
      default: 'hover:bg-primary-hover',
      secondary: 'bg-secondary',
      outline: 'border-border',
      ghost: 'hover:bg-accent',
      destructive: 'hover:bg-destructive-hover',
      // F-75 role split: the link variant reads the on-surface TONE, never the fill.
      link: 'text-primary-text',
    } as const;
    // ADR-018 raw-color ban: every Tailwind palette name, every color-bearing
    // utility prefix, and arbitrary color values.
    const RAW_PALETTE =
      /(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|accent|caret|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/;
    const RAW_ARBITRARY = /\[(?:#|rgb|hsl|oklch|oklab|color\()/i;
    const sizes = ['default', 'sm', 'lg', 'icon'] as const;
    for (const [variant, expected] of Object.entries(variantTokens)) {
      for (const size of sizes) {
        const classes = buttonVariants({ variant: variant as keyof typeof variantTokens, size });
        expect(classes).toContain(expected);
        expect(classes).not.toMatch(RAW_PALETTE);
        expect(classes).not.toMatch(RAW_ARBITRARY);
        // Opacity fades break the AA-thin D-024 pairings — hover must swap tokens.
        expect(classes).not.toContain('hover:opacity');
      }
    }
  });

  it('a hover fill carries its own hover label, and the base fill stays a fill (F-75)', () => {
    // Under a tenant brand `--primary-hover` may take the opposite label from
    // `--primary` (a mid-tone fill); the hover foreground token is what keeps
    // the pair AA. The role guard (token-roles.ts) holds every literal to this;
    // the vendored button is the one every page inherits it from.
    const primary = buttonVariants({ variant: 'default' });
    expect(primary).toContain('bg-primary');
    expect(primary).toContain('text-primary-foreground');
    expect(primary).toContain('hover:bg-primary-hover');
    expect(primary).toContain('hover:text-primary-hover-foreground');
    const destructive = buttonVariants({ variant: 'destructive' });
    expect(destructive).toContain('bg-destructive');
    expect(destructive).toContain('text-destructive-foreground');
    expect(destructive).toContain('hover:bg-destructive-hover');
    expect(destructive).toContain('hover:text-destructive-hover-foreground');
    expect(buttonVariants({ variant: 'link' })).not.toMatch(/(?<![\w-])text-primary(?![\w-])/);
  });

  it('enforces the 44px touch-target floor below lg on every size', () => {
    for (const size of ['default', 'sm', 'lg', 'icon'] as const) {
      const classes = buttonVariants({ size });
      expect(classes).toContain('max-lg:min-h-11');
      expect(classes).toContain('max-lg:min-w-11');
    }
  });

  it('merges caller classes through cn (conflict-resolving)', () => {
    const html = renderToStaticMarkup(<Button className="h-12">Ok</Button>);
    expect(html).toContain('h-12');
    expect(html).not.toContain('h-10'); // tailwind-merge drops the losing height
  });

  it('honors an explicit submit type', () => {
    const html = renderToStaticMarkup(<Button type="submit">Envoyer</Button>);
    expect(html).toContain('type="submit"');
  });
});
