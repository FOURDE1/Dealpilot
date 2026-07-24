import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Input, Label, Select } from './field.js';

describe('field primitives', () => {
  it('Input uses the D-024 field semantics (border-input + bg-input-bg) and the touch floor', () => {
    const html = renderToStaticMarkup(<Input aria-label="x" />);
    expect(html).toContain('border-input');
    expect(html).toContain('bg-input-bg');
    expect(html).toContain('focus-visible:ring-ring');
    expect(html).toContain('max-lg:min-h-11');
  });

  it('Select shares the field styling; Label renders a real <label>', () => {
    expect(renderToStaticMarkup(<Select aria-label="x" />)).toContain('border-input');
    expect(renderToStaticMarkup(<Label htmlFor="a">B</Label>)).toContain('<label');
  });

  it('merges caller classes with conflict resolution', () => {
    const html = renderToStaticMarkup(<Input aria-label="x" className="h-12" />);
    expect(html).toContain('h-12');
    expect(html).not.toContain('h-10');
  });
});
