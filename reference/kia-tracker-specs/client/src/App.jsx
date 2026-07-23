import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabaseClient';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import DealPipeline from './components/DealPipeline';
import DealForm from './components/DealForm';
import DealDetail from './components/DealDetail';
import DeliveryDashboard from './components/DeliveryDashboard';
import DispatchDashboard from './components/DispatchDashboard';
import ReportsDashboard from './components/ReportsDashboard';
import SalespeopleManager from './components/SalespeopleManager';
import ContactsPage from './components/ContactsPage';
import ContactDetail from './components/ContactDetail';
import InventoryPage from './components/InventoryPage';
import LeadsPage from './components/LeadsPage';
import LeadDetail from './components/LeadDetail';
import LeadAssignmentRules from './components/LeadAssignmentRules';
import CommandPalette from './components/CommandPalette';
import TemplatesPage from './components/TemplatesPage';
import AppointmentsPage from './components/AppointmentsPage';
import ScoringRulesPage from './components/ScoringRulesPage';
import DuplicatesPage from './components/DuplicatesPage';
import BeBackQueue from './components/BeBackQueue';
import WinLossPage from './components/WinLossPage';
import SourceROIPage from './components/SourceROIPage';
import SalespersonLeaderboard from './components/SalespersonLeaderboard';
import WorkflowSequences from './components/WorkflowSequences';
import DeskingPage from './pages/DeskingPage';
import BillOfSalePage from './pages/BillOfSalePage';
import AccountingPage from './pages/AccountingPage';
import InventoryDetailPage from './pages/InventoryDetailPage';
import SuppliersPage from './components/suppliers/SuppliersPage';

const API_URL = import.meta.env.VITE_API_URL;

function ProtectedRoute({ user, children }) {
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const { i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedLang = localStorage.getItem('kia_language');
    if (savedLang) {
      i18n.changeLanguage(savedLang);
    }

    // Check for existing Supabase session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        fetchUserProfile(session.access_token).then((profile) => {
          if (profile) {
            setUser({ ...profile, session });
          }
          setLoading(false);
        });
      } else {
        // Fallback: check localStorage for legacy session
        try {
          const stored = localStorage.getItem('kia_user');
          if (stored) {
            setUser(JSON.parse(stored));
          }
        } catch {
          localStorage.removeItem('kia_user');
        }
        setLoading(false);
      }
    });

    // Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          const profile = await fetchUserProfile(session.access_token);
          if (profile) {
            setUser({ ...profile, session });
            localStorage.removeItem('kia_user'); // Clean up legacy storage
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          localStorage.removeItem('kia_user');
        } else if (event === 'TOKEN_REFRESHED' && session) {
          setUser((prev) => prev ? { ...prev, session } : null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [i18n]);

  async function fetchUserProfile(accessToken) {
    try {
      const res = await fetch(`\${API_URL}/users/me`, {
        headers: { 'Authorization': `Bearer \${accessToken}` },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  const handleLogin = (userData) => {
    setUser(userData);
    // Also store in localStorage for legacy compatibility
    localStorage.setItem('kia_user', JSON.stringify(userData));
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem('kia_user');
  };

  if (loading) {
    return null;
  }

  return (
    <>
    {user && <CommandPalette />}
    <Routes>
      <Route
        path="/login"
        element={
          user ? (
            <Navigate to="/" replace />
          ) : (
            <Login onLogin={handleLogin} />
          )
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipeline"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <DealPipeline />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/deal/new"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <DealForm />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/deal/:id"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <DealDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/deliveries"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <DeliveryDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/dispatch"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <DispatchDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <ReportsDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/salespeople"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <SalespeopleManager />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/contacts"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <ContactsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/contacts/:id"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <ContactDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <LeadsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads/assignment-rules"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <LeadAssignmentRules />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads/:id"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <LeadDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <InventoryPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/:id"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <InventoryDetailPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads/scoring-rules"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <ScoringRulesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads/duplicates"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <DuplicatesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/leads/be-back"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <BeBackQueue />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/appointments"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <AppointmentsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/templates"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <TemplatesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics/win-loss"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <WinLossPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics/source-roi"
        element={
          <ProtectedRoute user={user}>
            <Layout user={user} onLogout={handleLogout}>
              <SourceROIPage />
            </Layout>
          </ProtectedRoute>
        }
      />
          <Route
            path="/analytics/leaderboard"
            element={
              <ProtectedRoute user={user}>
                <Layout user={user} onLogout={handleLogout}>
                  <SalespersonLeaderboard />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows"
            element={
              <ProtectedRoute user={user}>
                <Layout user={user} onLogout={handleLogout}>
                  <WorkflowSequences />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/desking"
            element={
              <ProtectedRoute user={user}>
                <Layout user={user} onLogout={handleLogout}>
                  <DeskingPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route path="/bill-of-sale" element={<BillOfSalePage />} />
          <Route
            path="/accounting"
            element={
              <ProtectedRoute user={user}>
                <Layout user={user} onLogout={handleLogout}>
                  <AccountingPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/suppliers"
            element={
              <ProtectedRoute user={user}>
                <Layout user={user} onLogout={handleLogout}>
                  <SuppliersPage />
                </Layout>
              </ProtectedRoute>
            }
          />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}