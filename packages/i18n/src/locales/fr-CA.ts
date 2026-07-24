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
    organizations: 'Organisations',
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
  orgs: {
    title: 'Organisations',
    newOrg: 'Nouvelle organisation',
    emptyTitle: 'Aucune organisation',
    emptyBody: 'Créez votre organisation pour commencer à configurer vos concessions.',
    name: "Nom de l'organisation",
    slug: 'Identifiant (slug)',
    slugHint: 'Minuscules et tirets, 3 à 40 caractères — permanent après création.',
    defaultLocale: 'Langue par défaut',
    localeFr: 'Français (Canada)',
    localeEn: 'Anglais (Canada)',
    create: "Créer l'organisation",
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    saved: 'Modifications enregistrées.',
    back: 'Retour aux organisations',
    slugTaken: 'Cet identifiant est déjà utilisé.',
    slugInvalid: 'Identifiant invalide — minuscules et tirets, 3 à 40 caractères, non réservé.',
    codeInvalid: 'Code invalide — lettres majuscules, chiffres et tirets.',
    invalidInput: 'Certaines informations sont invalides. Vérifiez les champs.',
    status_active: 'Active',
    status_trial: 'Essai',
    status_past_due: 'Paiement en retard',
    status_read_only: 'Lecture seule',
    status_suspended: 'Suspendue',
    status_offboarding: 'En fermeture',
    status_purged: 'Purgée',
    tier_core: 'Essentiel',
    tier_growth: 'Croissance',
    tier_scale: 'Échelle',
    tier_enterprise: 'Entreprise',
    genericError: "L'opération a échoué. Réessayez.",
    loadError: 'Impossible de charger les données. Réessayez.',
    statusLabel: 'Statut',
    planLabel: 'Forfait',
    storesTitle: 'Succursales',
    newStore: 'Nouvelle succursale',
    storesEmpty: 'Aucune succursale pour cette organisation.',
    storeName: 'Nom de la succursale',
    storeCode: 'Code',
    storeCodeHint: 'Code court unique dans l’organisation (ex. KIA-ML).',
    codeTaken: 'Ce code est déjà utilisé dans cette organisation.',
    province: 'Province',
    city: 'Ville',
    createStore: 'Créer la succursale',
    editStore: 'Modifier la succursale',
    loading: 'Chargement…',
  },
} as const;

type MirrorShape<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : MirrorShape<T[K]>;
};

/** Recursive key mirror of fr-CA — any nesting depth, string leaves. */
export type LocaleShape = MirrorShape<typeof frCA>;
