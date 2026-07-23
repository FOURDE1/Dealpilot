import { describe, expect, it } from 'vitest';
import { loginRedirect, safeReturnTo } from './guards.js';

describe('loginRedirect', () => {
  it('sends the root path to plain /login', () => {
    expect(loginRedirect('/', '')).toBe('/login');
  });

  it('preserves the intended destination including query', () => {
    expect(loginRedirect('/pipeline', '?stage=new')).toBe(
      `/login?returnTo=${encodeURIComponent('/pipeline?stage=new')}`,
    );
  });
});

describe('safeReturnTo', () => {
  it('returns the stored same-origin path', () => {
    expect(safeReturnTo('?returnTo=%2Fpipeline%3Fstage%3Dnew')).toBe('/pipeline?stage=new');
  });

  it('falls back to / when absent', () => {
    expect(safeReturnTo('')).toBe('/');
  });

  it('rejects absolute and scheme-relative URLs (open-redirect guard)', () => {
    expect(safeReturnTo('?returnTo=https%3A%2F%2Fevil.example')).toBe('/');
    expect(safeReturnTo('?returnTo=%2F%2Fevil.example')).toBe('/');
  });
});
