import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Car, Plus, Truck, Send, BarChart3, Users, Contact, Kanban, UserPlus,
  Shuffle, Trophy, GitBranch, Copy, FileText, CalendarDays, TrendingUp, CircleDollarSign, ChevronLeft, ChevronRight, Search, Bell, Sun, Moon, LogOut, Calculator,
  Menu, X, History, Calculator as CalcIcon, Building2,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

const NAV_ITEMS = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { path: '/pipeline', icon: Kanban, labelKey: 'nav.pipeline' },
  { path: '/deal/new', icon: Plus, labelKey: 'nav.newDeal' },
  { path: '/desking', icon: Calculator, labelKey: 'nav.desking' },
  { path: '/deliveries', icon: Truck, labelKey: 'nav.deliveries' },
  { path: '/dispatch', icon: Send, labelKey: 'nav.dispatch' },
  { path: '/inventory', icon: Car, labelKey: 'nav.inventory' },
  { path: '/contacts', icon: Contact, labelKey: 'nav.contacts' },
  { path: '/leads', icon: UserPlus, labelKey: 'nav.leads' },
  { path: '/leads/assignment-rules', icon: Shuffle, labelKey: 'nav.assignmentRules' },
  { path: '/leads/scoring-rules', icon: Trophy, labelKey: 'nav.scoringRules' },
  { path: '/leads/duplicates', icon: Copy, labelKey: 'nav.duplicates' },
  { path: '/leads/be-back', icon: History, labelKey: 'nav.beBack' },
  { path: '/appointments', icon: CalendarDays, labelKey: 'nav.appointments' },
  { path: '/templates', icon: FileText, labelKey: 'nav.templates' },
  { path: '/analytics/win-loss', icon: TrendingUp, labelKey: 'nav.winLoss' },
  { path: '/analytics/source-roi', icon: CircleDollarSign, labelKey: 'nav.sourceRoi' },
  { path: '/analytics/leaderboard', icon: Trophy, labelKey: 'nav.leaderboard' },
    { path: '/workflows', icon: GitBranch, labelKey: 'nav.workflows' },
  { path: '/reports', icon: BarChart3, labelKey: 'nav.reports' },
  { path: '/accounting', icon: CalcIcon, labelKey: 'nav.accounting' },
  { path: '/suppliers', icon: Building2, labelKey: 'nav.suppliers' },
  { path: '/salespeople', icon: Users, labelKey: 'nav.salespeople' },
];

function Sidebar({ collapsed, setCollapsed, user, onLogout }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const currentLang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const toggleLang = () => {
    const newLang = currentLang === 'en' ? 'fr' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('kia_language', newLang);
  };

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    const hasMoreSpecificSibling = NAV_ITEMS.some(
      (other) => other.path !== path && other.path.startsWith(path + '/')
    );
    if (hasMoreSpecificSibling) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 60 : 240 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="fixed top-0 left-0 h-full z-40 flex flex-col bg-surface-sidebar border-r border-border"
    >
      {/* Brand */}
      <div className="flex items-center h-14 px-3 border-b border-border shrink-0">
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 overflow-hidden"
          >
            <Car size={22} className="text-brand-red shrink-0" />
            <span className="text-content-primary font-semibold text-sm whitespace-nowrap">
              Kia <span className="text-brand-red">Mont-Laurier</span>
            </span>
          </motion.div>
        )}
        {collapsed && <Car size={22} className="text-brand-red mx-auto" />}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              title={collapsed ? t(item.labelKey) : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-fast relative group
                \${active
                  ? 'bg-brand-accent/10 text-brand-accent'
                  : 'text-content-secondary hover:text-content-primary hover:bg-surface-elevated'
                }`}
            >
              {active && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-brand-accent rounded-r-full"
                  transition={{ duration: 0.2 }}
                />
              )}
              <Icon size={20} className="shrink-0" />
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="whitespace-nowrap"
                >
                  {t(item.labelKey)}
                </motion.span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Controls */}
      <div className="p-2 border-t border-border space-y-1 shrink-0">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-content-secondary hover:text-content-primary hover:bg-surface-elevated w-full transition-colors duration-fast"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          {!collapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>

        {/* Language Toggle */}
        <button
          onClick={toggleLang}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-content-secondary hover:text-content-primary hover:bg-surface-elevated w-full transition-colors duration-fast"
        >
          <span className="w-[18px] text-center font-semibold text-xs shrink-0">
            {currentLang === 'en' ? 'FR' : 'EN'}
          </span>
          {!collapsed && <span>{t('nav.language')}</span>}
        </button>

        {/* Collapse Toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-content-secondary hover:text-content-primary hover:bg-surface-elevated w-full transition-colors duration-fast"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!collapsed && <span>Collapse</span>}
        </button>

        {/* User + Logout */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-border mt-1 pt-2">
          <div className="w-7 h-7 rounded-full bg-brand-accent/20 text-brand-accent flex items-center justify-center text-xs font-semibold shrink-0">
            {user?.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-content-primary truncate">{user?.name}</p>
            </div>
          )}
          <button
            onClick={() => { onLogout(); navigate('/login'); }}
            title={t('nav.logout')}
            className="text-content-muted hover:text-status-danger transition-colors shrink-0"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </motion.aside>
  );
}

function TopBar({ onMobileMenuToggle }) {
  const { t } = useTranslation();

  return (
    <header
      className="h-14 border-b border-border bg-surface-card flex items-center justify-between px-4 sticky top-0 z-30"
      style={{ marginLeft: 0 }}
    >
      {/* Mobile menu button */}
      <button
        onClick={onMobileMenuToggle}
        className="md:hidden text-content-secondary hover:text-content-primary p-1"
      >
        <Menu size={22} />
      </button>

      {/* Search (desktop) */}
      <div className="hidden md:flex items-center gap-2 bg-surface-page border border-border rounded-lg px-3 py-1.5 w-72">
        <Search size={16} className="text-content-muted" />
        <input
          type="text"
          placeholder={t('filters.searchPlaceholder')}
          className="bg-transparent text-sm text-content-primary placeholder:text-content-muted outline-none w-full"
        />
        <kbd className="hidden lg:inline text-[10px] text-content-muted bg-surface-elevated px-1.5 py-0.5 rounded border border-border font-mono">
          /
        </kbd>
      </div>

      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <button className="relative text-content-secondary hover:text-content-primary transition-colors p-1">
          <Bell size={20} />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-status-danger rounded-full animate-pulse-dot" />
        </button>
      </div>
    </header>
  );
}

function MobileNav({ isOpen, onClose, user, onLogout }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const currentLang = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const toggleLang = () => {
    const newLang = currentLang === 'en' ? 'fr' : 'en';
    i18n.changeLanguage(newLang);
    localStorage.setItem('kia_language', newLang);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 z-50 md:hidden"
          />
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
            className="fixed top-0 left-0 w-72 h-full bg-surface-sidebar border-r border-border z-50 flex flex-col md:hidden"
          >
            <div className="flex items-center justify-between h-14 px-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Car size={22} className="text-brand-red" />
                <span className="text-content-primary font-semibold text-sm">
                  Kia <span className="text-brand-red">Mont-Laurier</span>
                </span>
              </div>
              <button onClick={onClose} className="text-content-secondary">
                <X size={20} />
              </button>
            </div>

            <nav className="flex-1 py-3 px-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const hasMoreSpecificSibling = NAV_ITEMS.some(
                  (other) => other.path !== item.path && other.path.startsWith(item.path + '/')
                );
                const active = item.path === '/'
                  ? location.pathname === '/'
                  : hasMoreSpecificSibling
                    ? location.pathname === item.path
                    : location.pathname.startsWith(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                      \${active ? 'bg-brand-accent/10 text-brand-accent' : 'text-content-secondary hover:text-content-primary hover:bg-surface-elevated'}`}
                  >
                    <Icon size={20} />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="p-3 border-t border-border space-y-2">
              <button onClick={toggleTheme} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-content-secondary hover:bg-surface-elevated w-full">
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
              <button onClick={toggleLang} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-content-secondary hover:bg-surface-elevated w-full">
                <span className="w-[18px] text-center font-semibold text-xs">{currentLang === 'en' ? 'FR' : 'EN'}</span>
                <span>{t('nav.language')}</span>
              </button>
              <div className="flex items-center justify-between px-3 py-2 border-t border-border pt-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-brand-accent/20 text-brand-accent flex items-center justify-center text-xs font-semibold">
                    {user?.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <span className="text-xs font-medium text-content-primary">{user?.name}</span>
                </div>
                <button onClick={() => { onClose(); onLogout(); navigate('/login'); }} className="text-content-muted hover:text-status-danger">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);
  useEffect(() => {
    const handler = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isDesktop;
}

export default function Layout({ user, onLogout, children }) {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('kia_sidebar_collapsed');
    return stored === 'true';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('kia_sidebar_collapsed', String(collapsed));
  }, [collapsed]);

  return (
    <div className="min-h-screen bg-surface-page">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          user={user}
          onLogout={onLogout}
        />
      </div>

      {/* Mobile Nav */}
      <MobileNav
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        user={user}
        onLogout={onLogout}
      />

      {/* Main Content */}
      <div
        className="transition-[margin] duration-200 ease-in-out"
        style={{ marginLeft: isDesktop ? (collapsed ? 60 : 240) : 0 }}
      >
        <TopBar
          onMobileMenuToggle={() => setMobileMenuOpen(true)}
        />
        <main className="p-4 sm:p-6 max-w-[1400px] mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}