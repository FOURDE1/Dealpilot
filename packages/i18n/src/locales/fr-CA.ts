/**
 * fr-CA — the PRIMARY locale (Bill 96: French-first, including staff UI).
 * This file defines the key shape; en-CA.ts must mirror it exactly
 * (enforced at typecheck via `satisfies` and at runtime by check-parity).
 * Messages use ICU syntax (i18next-icu).
 */
export const frCA = {
  common: {
    appName: '1Dealer',
    signOut: 'Se déconnecter',
    loading: 'Chargement…',
    switchLanguage: "Passer à l'anglais",
  },
  nav: {
    mainNav: 'Navigation principale',
    dashboard: 'Tableau de bord',
    prospects: 'Prospects',
    pipeline: 'Pipeline',
  },
  auth: {
    signInTitle: 'Connexion',
    signInSubtitle: 'Accédez à votre espace 1Dealer',
    signUpTitle: 'Créer un compte',
    signUpSubtitle: 'Votre concession sur 1Dealer',
    email: 'Courriel',
    password: 'Mot de passe',
    fullName: 'Nom complet',
    passwordHint: 'Au moins {min} caractères.',
    signInAction: 'Se connecter',
    signingIn: 'Connexion…',
    signUpAction: 'Créer le compte',
    creatingAccount: 'Création…',
    noAccount: 'Pas de compte?',
    createAccount: 'Créer un compte',
    haveAccount: 'Déjà un compte?',
    invalidCredentials: 'Courriel ou mot de passe invalide.',
    passwordTooShort: 'Le mot de passe doit contenir au moins {min} caractères.',
    emailInUse: 'Un compte existe déjà avec ce courriel.',
    signUpFailed: 'Impossible de créer le compte. Réessayez.',
  },
  dashboard: {
    greeting: 'Bonjour',
    greetingName: 'Bonjour, {name}',
    welcomeTitle: 'Bienvenue sur 1Dealer',
    welcomeBody:
      "La coquille de l'application est en place. Les modules (prospects, pipeline, livraisons) arriveront par tranches fonctionnelles.",
  },
} as const;

type MirrorShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : MirrorShape<T[K]>;
};

/** Recursive key mirror of fr-CA — any nesting depth, string leaves. */
export type LocaleShape = MirrorShape<typeof frCA>;
