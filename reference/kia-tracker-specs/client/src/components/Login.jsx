import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';

export default function Login({ onLogin }) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const currentLang = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const toggleLanguage = () => {
    const newLang = currentLang === 'en' ? 'fr' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('kia_language', newLang);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError(t('login.errorRequired'));
      return;
    }

    setLoading(true);

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(t('login.invalidCredentials'));
        return;
      }

      // Fetch user profile from our API
      const API_URL = import.meta.env.VITE_API_URL;
      const res = await fetch(`${API_URL}/users/me`, {
        headers: {
          'Authorization': `Bearer ${data.session.access_token}`,
        },
      });

      if (!res.ok) {
        setError(t('login.profileNotFound'));
        await supabase.auth.signOut();
        return;
      }

      const userProfile = await res.json();
      onLogin({ ...userProfile, session: data.session });
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        setError(t('login.errorNetwork'));
      } else {
        setError(err.message || t('login.errorGeneral'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center px-4">
      {/* Language toggle */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleLanguage}
          className="px-3 py-1 text-sm font-semibold rounded bg-[#1e3a5f] text-white hover:bg-[#16304f] transition-colors"
        >
          {currentLang === 'en' ? 'FR' : 'EN'}
        </button>
      </div>

      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#1e3a5f]">
            Kia <span className="text-[#c4342d]">Mont-Laurier</span>
          </h1>
          <p className="mt-2 text-gray-500 text-sm">
            {t('login.subtitle')}
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-lg shadow-md p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">
            {t('login.title')}
          </h2>

          {error && (
            <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('login.email')}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.emailPlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-[#1e3a5f] text-sm"
                disabled={loading}
                autoComplete="email"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('login.password')}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-[#1e3a5f] text-sm"
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-md text-white font-medium text-sm bg-[#1e3a5f] hover:bg-[#16304f] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1e3a5f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? t('login.loading') : t('login.submit')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
