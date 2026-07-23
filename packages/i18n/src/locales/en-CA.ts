import type { LocaleShape } from './fr-CA.js';

/**
 * en-CA — secondary locale. `satisfies LocaleShape` makes a missing or extra
 * key a TYPECHECK error; check-parity re-verifies at runtime for CI.
 */
export const enCA = {
  common: {
    appName: '1Dealer',
    signOut: 'Sign out',
    loading: 'Loading…',
    switchLanguage: 'Switch to French',
  },
  nav: {
    mainNav: 'Main navigation',
    dashboard: 'Dashboard',
    prospects: 'Leads',
    pipeline: 'Pipeline',
  },
  auth: {
    signInTitle: 'Sign in',
    signInSubtitle: 'Access your 1Dealer workspace',
    signUpTitle: 'Create an account',
    signUpSubtitle: 'Your dealership on 1Dealer',
    email: 'Email',
    password: 'Password',
    fullName: 'Full name',
    passwordHint: 'At least {min} characters.',
    signInAction: 'Sign in',
    signingIn: 'Signing in…',
    signUpAction: 'Create account',
    creatingAccount: 'Creating…',
    noAccount: 'No account?',
    createAccount: 'Create an account',
    haveAccount: 'Already have an account?',
    invalidCredentials: 'Invalid email or password.',
    passwordTooShort: 'The password must contain at least {min} characters.',
    emailInUse: 'An account already exists with this email.',
    signUpFailed: 'Could not create the account. Please try again.',
  },
  dashboard: {
    greeting: 'Hello',
    greetingName: 'Hello, {name}',
    welcomeTitle: 'Welcome to 1Dealer',
    welcomeBody:
      'The application shell is in place. Modules (leads, pipeline, deliveries) arrive as feature slices.',
  },
} as const satisfies LocaleShape;
