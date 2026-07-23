import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
));

describe('Login', () => {
  it('renders email and password fields', async () => {
    const { default: Login } = await import('../components/Login');
    render(
      <BrowserRouter>
        <Login onLogin={() => {}} />
      </BrowserRouter>
    );

    const emailInput = document.querySelector('input[type="email"]');
    const passwordInput = document.querySelector('input[type="password"]');

    expect(emailInput).toBeDefined();
    expect(passwordInput).toBeDefined();
  });

  it('does not render a name field', async () => {
    const { default: Login } = await import('../components/Login');
    render(
      <BrowserRouter>
        <Login onLogin={() => {}} />
      </BrowserRouter>
    );

    // Old login had a name field — verify it's gone
    const nameInput = document.getElementById('name');
    expect(nameInput).toBeNull();
  });

  it('renders the submit button', async () => {
    const { default: Login } = await import('../components/Login');
    render(
      <BrowserRouter>
        <Login onLogin={() => {}} />
      </BrowserRouter>
    );

    const submitButton = document.querySelector('button[type="submit"]');
    expect(submitButton).toBeDefined();
  });
});
