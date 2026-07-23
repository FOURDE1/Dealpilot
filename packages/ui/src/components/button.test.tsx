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
      link: 'text-primary',
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
