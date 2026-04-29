import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { UserRole, Profile as UserProfile } from './types';
import { supabase } from './services/supabase';
import { getOrCreateProfile } from './services/profileService';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import BottomNavBar from './components/BottomNavBar';

// Páginas principais — carregamento imediato (rota mais usada pelos inscritos)
import Dashboard from './pages/Dashboard';
import Bailarinos from './pages/Bailarinos';
import MinhasCoreografias from './pages/MinhasCoreografias';
import CentralDeMidia from './pages/CentralDeMidia';
import Profile from './pages/Profile';
import Auth from './pages/Auth';
import LandingPage from './pages/LandingPage';

// Páginas secundárias — lazy loading para reduzir bundle inicial
const RegistrationGradeConfig = lazy(() => import('./pages/RegistrationGradeConfig'));
const Registrations            = lazy(() => import('./pages/Registrations'));
const JudgeManagement          = lazy(() => import('./pages/JudgeManagement'));
const Schedule                 = lazy(() => import('./pages/Schedule'));
const AINarration              = lazy(() => import('./pages/AINarration'));
const AIAnalysis               = lazy(() => import('./pages/AIAnalysis'));
const CheckIn                  = lazy(() => import('./pages/CheckIn'));
const JudgeTerminal            = lazy(() => import('./pages/JudgeTerminal'));
const JudgePractice            = lazy(() => import('./pages/JudgePractice'));
const ProducerDashboard        = lazy(() => import('./pages/ProducerDashboard'));
const SuperAdminDashboard      = lazy(() => import('./pages/SuperAdmin'));
const ProducerInviteLanding    = lazy(() => import('./pages/ProducerInvite'));
const TeamInviteLanding        = lazy(() => import('./pages/TeamInvite'));
const CreateEvent              = lazy(() => import('./pages/CreateEvent'));
const CriarEventoGate          = lazy(() => import('./pages/CriarEventoGate'));
const FestivalShowcase         = lazy(() => import('./pages/FestivalShowcase'));
const PublicEventPage          = lazy(() => import('./pages/PublicEventPage'));
const Festivais                = lazy(() => import('./pages/Festivais'));
const NewRegistration          = lazy(() => import('./pages/NewRegistration'));
const Checkout                 = lazy(() => import('./pages/Checkout'));
const PagamentoInscrito        = lazy(() => import('./pages/PagamentoInscrito'));
const PagamentoSucesso         = lazy(() => import('./pages/PagamentoSucesso'));
const PagamentoPendente        = lazy(() => import('./pages/PagamentoPendente'));
const PagamentoErro            = lazy(() => import('./pages/PagamentoErro'));
const AccountSettings          = lazy(() => import('./pages/AccountSettings'));
const JudgesManagement         = lazy(() => import('./pages/JudgesManagement'));
const Leaderboard              = lazy(() => import('./pages/Leaderboard'));
const BattleConfig             = lazy(() => import('./pages/BattleConfig'));
const BattleArenaLive          = lazy(() => import('./pages/BattleArenaLive'));
const ResultsPanel             = lazy(() => import('./pages/ResultsPanel'));
const MyResults                = lazy(() => import('./pages/MyResults'));
const MesaDeSom                = lazy(() => import('./pages/MesaDeSom'));
const TracksManagement         = lazy(() => import('./pages/TracksManagement'));
const Ingressos                = lazy(() => import('./pages/Ingressos'));
const Live                     = lazy(() => import('./pages/Live'));
const Certificates             = lazy(() => import('./pages/Certificates'));
const StageMarker              = lazy(() => import('./pages/StageMarker'));
const EquipeProdutor           = lazy(() => import('./pages/EquipeProdutor'));
const SuporteJuri              = lazy(() => import('./pages/SuporteJuri'));
const VideoSelection           = lazy(() => import('./pages/VideoSelection'));
const SeletivaInscrito         = lazy(() => import('./pages/SeletivaInscrito'));
const RegulationAIParser       = lazy(() => import('./pages/RegulationAIParser'));

const PageLoader = () => (
  <div className="flex-1 flex items-center justify-center min-h-[40vh]">
    <Loader2 size={28} className="animate-spin text-[#ff0068]" />
  </div>
);

interface PrivateRouteProps {
  session: any;
  profile: UserProfile | null;
  activeRole: UserRole | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setActiveRole: (role: UserRole) => void;
  videoSelectionEnabled: boolean;
  children: React.ReactNode;
}

const PrivateRoute: React.FC<PrivateRouteProps> = ({
  session, profile, activeRole, theme, toggleTheme, setActiveRole, videoSelectionEnabled, children,
}) => {
  const location = useLocation();
  if (!session) {
    // Preserva a rota original pra Auth retomar após login/signup.
    const redirectTo = location.pathname + location.search;
    return <Navigate to="/login" state={{ redirectTo }} replace />;
  }
  if (!profile || !activeRole) return null;
  return (
    <PrivateLayout
      profile={profile}
      theme={theme}
      toggleTheme={toggleTheme}
      activeRole={activeRole}
      setActiveRole={setActiveRole}
      videoSelectionEnabled={videoSelectionEnabled}
    >
      {children}
    </PrivateLayout>
  );
};

const PrivateLayout: React.FC<{
  profile: UserProfile,
  children: React.ReactNode,
  theme: 'light' | 'dark',
  toggleTheme: () => void,
  activeRole: UserRole | null,
  setActiveRole: (role: UserRole) => void,
  videoSelectionEnabled: boolean,
}>  = ({ children, profile, theme, toggleTheme, activeRole, setActiveRole, videoSelectionEnabled }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-sans selection:bg-[#ff0068]/30 text-sm">
      <Sidebar
        isOpen={sidebarOpen}
        toggle={() => setSidebarOpen(!sidebarOpen)}
        onLogout={handleLogout}
        theme={theme}
        toggleTheme={toggleTheme}
        activeRole={activeRole}
        profile={profile}
        videoSelectionEnabled={videoSelectionEnabled}
      />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#3b0764,transparent)] pointer-events-none opacity-5 dark:opacity-20" />

        <Header
          toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          profile={profile}
          theme={theme}
          toggleTheme={toggleTheme}
          activeRole={activeRole}
          setActiveRole={setActiveRole}
        />
        {/* pb-20 no mobile para não sobrepor o BottomNavBar */}
        <main className="flex-1 overflow-y-auto p-3 lg:p-4 relative z-10 pb-20 sm:pb-4">
          <Suspense fallback={<PageLoader />}>
            {children}
          </Suspense>
        </main>
      </div>

      <BottomNavBar activeRole={activeRole} videoSelectionEnabled={videoSelectionEnabled} />
    </div>
  );
};

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });
  const [config, setConfig] = useState<any>({ nome_evento: "", data_evento: "" });

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase.from('configuracoes').select('*').eq('id', 1).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) setConfig(data);
    } catch (err: any) {
      console.error('Error fetching config:', err);
    }
  };

  useEffect(() => {
    // Timeout de segurança: se após 5s a autenticação ainda não resolveu, libera a UI.
    // Evita que o app fique preso em loading quando a aba é suspensa/reativada pelo navegador.
    const safetyTimeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) console.warn('[auth] initAuth demorou mais de 5s — liberando UI');
        return false;
      });
    }, 5000);

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        if (session?.user) {
          const userProfile = await getOrCreateProfile(session.user);
          if (userProfile) {
            setProfile(userProfile);
            setActiveRole(userProfile.role);
          }
        }
        await fetchConfig();
      } catch (err: any) {
        console.error('Auth error:', err);
      } finally {
        clearTimeout(safetyTimeout);
        setLoading(false);
      }
    };

    initAuth();

    // IMPORTANTE: não usar async/await direto neste callback.
    // O Supabase mantém um lock interno de auth enquanto o callback roda; fazer await
    // de outras queries do Supabase aqui causa DEADLOCK (login trava em "Autenticando...").
    // Por isso adiamos o trabalho com setTimeout(..., 0).
    // Ref: https://github.com/supabase/auth-js/issues/762
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        setTimeout(async () => {
          try {
            const userProfile = await getOrCreateProfile(session.user);
            if (userProfile) {
              setProfile(userProfile);
              setActiveRole(userProfile.role);
            }
          } catch (err) {
            console.error('[auth] erro ao carregar perfil:', err);
          }
        }, 0);
      } else {
        setProfile(null);
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-6">
        <div className="w-16 h-16 border-4 border-[#ff0068] border-t-transparent rounded-full animate-spin shadow-[0_0_30px_rgba(255,0,104,0.3)]" />
        <h2 className="text-slate-900 dark:text-white text-xl font-black uppercase tracking-tighter italic">Coreo<span className="text-[#ff0068]">Hub</span></h2>
      </div>
    );
  }

  const videoSelectionEnabled = config.video_selection_enabled ?? false;
  const privateRouteProps = { session, profile, activeRole, theme, toggleTheme, setActiveRole, videoSelectionEnabled };

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/register" element={<Auth />} />
        <Route path="/convite/:token" element={<Suspense fallback={<PageLoader />}><ProducerInviteLanding /></Suspense>} />
        <Route path="/equipe-convite/:token" element={<Suspense fallback={<PageLoader />}><TeamInviteLanding /></Suspense>} />

        <Route path="/dashboard" element={<PrivateRoute {...privateRouteProps}><Dashboard profile={profile!} config={config} activeRole={activeRole!} /></PrivateRoute>} />
        <Route path="/bailarinos" element={<PrivateRoute {...privateRouteProps}><Bailarinos /></PrivateRoute>} />
        <Route path="/minhas-coreografias" element={<PrivateRoute {...privateRouteProps}><MinhasCoreografias /></PrivateRoute>} />
        <Route path="/central-de-midia" element={<PrivateRoute {...privateRouteProps}><CentralDeMidia /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute {...privateRouteProps}><Profile /></PrivateRoute>} />
        <Route path="/meus-resultados" element={<PrivateRoute {...privateRouteProps}><MyResults activeRole={activeRole!} /></PrivateRoute>} />

        <Route path="/qg-organizador" element={<PrivateRoute {...privateRouteProps}><ProducerDashboard profile={profile!} /></PrivateRoute>} />
        <Route path="/registrations" element={<PrivateRoute {...privateRouteProps}><Registrations /></PrivateRoute>} />
        <Route path="/manage-schedule" element={<PrivateRoute {...privateRouteProps}><Schedule /></PrivateRoute>} />
        <Route path="/apuracao" element={<PrivateRoute {...privateRouteProps}><ResultsPanel /></PrivateRoute>} />
        <Route path="/equipe-jurados" element={<PrivateRoute {...privateRouteProps}><JudgesManagement /></PrivateRoute>} />
        <Route path="/account-settings" element={<PrivateRoute {...privateRouteProps}><AccountSettings onSaveSuccess={fetchConfig} /></PrivateRoute>} />

        <Route path="/judge-terminal" element={<PrivateRoute {...privateRouteProps}><JudgeTerminal /></PrivateRoute>} />
        <Route path="/judge-practice" element={<PrivateRoute {...privateRouteProps}><JudgePractice /></PrivateRoute>} />
        <Route path="/equipe-jurados-config" element={<PrivateRoute {...privateRouteProps}><JudgeManagement /></PrivateRoute>} />

        <Route path="/check-in" element={<PrivateRoute {...privateRouteProps}><CheckIn /></PrivateRoute>} />
        <Route path="/marcacao-palco" element={<PrivateRoute {...privateRouteProps}><StageMarker /></PrivateRoute>} />
        <Route path="/minha-equipe" element={<PrivateRoute {...privateRouteProps}><EquipeProdutor /></PrivateRoute>} />
        <Route path="/suporte-juri" element={<PrivateRoute {...privateRouteProps}><SuporteJuri /></PrivateRoute>} />
        <Route path="/mesa-de-som" element={<PrivateRoute {...privateRouteProps}><MesaDeSom /></PrivateRoute>} />
        <Route path="/ingressos" element={<PrivateRoute {...privateRouteProps}><Ingressos /></PrivateRoute>} />
        <Route path="/live" element={<PrivateRoute {...privateRouteProps}><Live /></PrivateRoute>} />

        <Route path="/seletiva-video"       element={<PrivateRoute {...privateRouteProps}><VideoSelection /></PrivateRoute>} />
        <Route path="/minha-seletiva"       element={<PrivateRoute {...privateRouteProps}><SeletivaInscrito /></PrivateRoute>} />
        <Route path="/importar-regulamento" element={<PrivateRoute {...privateRouteProps}><RegulationAIParser /></PrivateRoute>} />

        <Route path="/criar-evento" element={<Suspense fallback={<PageLoader />}><CriarEventoGate /></Suspense>} />
        <Route path="/event-config" element={<PrivateRoute {...privateRouteProps}><RegistrationGradeConfig /></PrivateRoute>} />
        <Route path="/generate-narration" element={<PrivateRoute {...privateRouteProps}><AINarration /></PrivateRoute>} />
        <Route path="/ai-analysis" element={<PrivateRoute {...privateRouteProps}><AIAnalysis /></PrivateRoute>} />
        <Route path="/super-admin" element={<PrivateRoute {...privateRouteProps}><SuperAdminDashboard /></PrivateRoute>} />
        <Route path="/certificados" element={<PrivateRoute {...privateRouteProps}><Certificates /></PrivateRoute>} />
        <Route path="/trilhas" element={<PrivateRoute {...privateRouteProps}><TracksManagement /></PrivateRoute>} />
        <Route path="/battle-config" element={<PrivateRoute {...privateRouteProps}><BattleConfig /></PrivateRoute>} />
        <Route path="/battle-arena" element={<PrivateRoute {...privateRouteProps}><BattleArenaLive /></PrivateRoute>} />

        <Route path="/festivais" element={<Suspense fallback={<PageLoader />}><Festivais /></Suspense>} />
        <Route path="/evento/:idOrSlug" element={<Suspense fallback={<PageLoader />}><PublicEventPage /></Suspense>} />
        <Route path="/festival/:id" element={<FestivalShowcase />} />
        <Route path="/festival/:id/register" element={<PrivateRoute {...privateRouteProps}><NewRegistration /></PrivateRoute>} />
        <Route path="/festival/:id/checkout" element={<PrivateRoute {...privateRouteProps}><Checkout /></PrivateRoute>} />
        <Route path="/pagamento"             element={<PrivateRoute {...privateRouteProps}><PagamentoInscrito /></PrivateRoute>} />
        <Route path="/pagamento/sucesso"     element={<PrivateRoute {...privateRouteProps}><PagamentoSucesso /></PrivateRoute>} />
        <Route path="/pagamento/pendente"    element={<PrivateRoute {...privateRouteProps}><PagamentoPendente /></PrivateRoute>} />
        <Route path="/pagamento/erro"        element={<PrivateRoute {...privateRouteProps}><PagamentoErro /></PrivateRoute>} />
        <Route path="/festival/:id/leaderboard" element={<Leaderboard />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
