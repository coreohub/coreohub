import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { UserRole, Profile as UserProfile } from './types';
import { supabase } from './services/supabase';
import { getOrCreateProfile } from './services/profileService';
import Sidebar from './components/Sidebar';
import DemoBanner from './components/DemoBanner';
import InstallAppBanner from './components/InstallAppBanner';
import EmailVerifyBanner from './components/EmailVerifyBanner';
import ImpersonateBanner from './components/ImpersonateBanner';
import Header from './components/Header';
import BottomNavBar from './components/BottomNavBar';
import CookieBanner from './components/CookieBanner';

// Páginas principais — carregamento imediato (rota mais usada pelos inscritos)
import Dashboard from './pages/Dashboard';
import Bailarinos from './pages/Bailarinos';
import MinhasCoreografias from './pages/MinhasCoreografias';
import CentralDeMidia from './pages/CentralDeMidia';
import Profile from './pages/Profile';
import Auth from './pages/Auth';
import LandingPage from './pages/LandingPage';
const LandingGoverno  = lazy(() => import('./pages/LandingGoverno'));
const PropostaGoverno = lazy(() => import('./pages/PropostaGoverno'));
const LandingEstudios = lazy(() => import('./pages/LandingEstudios'));

// Páginas secundárias — lazy loading para reduzir bundle inicial
const RegistrationGradeConfig = lazy(() => import('./pages/RegistrationGradeConfig'));
const Registrations            = lazy(() => import('./pages/Registrations'));
const JudgeManagement          = lazy(() => import('./pages/JudgeManagement'));
const Schedule                 = lazy(() => import('./pages/Schedule'));
const AIAnalysis               = lazy(() => import('./pages/AIAnalysis'));
const CheckIn                  = lazy(() => import('./pages/CheckIn'));
const JudgeTerminal            = lazy(() => import('./pages/JudgeTerminal'));
const Deliberacao              = lazy(() => import('./pages/Deliberacao'));
const Conferencia              = lazy(() => import('./pages/Conferencia'));
const Deliberacoes             = lazy(() => import('./pages/Deliberacoes'));
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
const ShortCodeRedirect        = lazy(() => import('./pages/ShortCodeRedirect'));
const InscricaoWizard          = lazy(() => import('./pages/InscricaoWizard'));
const Checkout                 = lazy(() => import('./pages/Checkout'));
const CheckoutIngresso         = lazy(() => import('./pages/CheckoutIngresso'));
const MeuIngresso              = lazy(() => import('./pages/MeuIngresso'));
const VendasIngressos          = lazy(() => import('./pages/VendasIngressos'));
const VendasOverview           = lazy(() => import('./pages/VendasOverview'));
const Coupons                  = lazy(() => import('./pages/Coupons'));
const WorkshopsManagement      = lazy(() => import('./pages/WorkshopsManagement'));
const PublicWorkshopPage       = lazy(() => import('./pages/PublicWorkshopPage'));
const CheckoutWorkshop         = lazy(() => import('./pages/CheckoutWorkshop'));
const MeuWorkshop              = lazy(() => import('./pages/MeuWorkshop'));
const MeusCertificados         = lazy(() => import('./pages/MeusCertificados'));
const ValidarCertificado       = lazy(() => import('./pages/ValidarCertificado'));
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
const Credencial               = lazy(() => import('./pages/Credencial'));
const Credenciais              = lazy(() => import('./pages/Credenciais'));
const TracksManagement         = lazy(() => import('./pages/TracksManagement'));
const Ingressos                = lazy(() => import('./pages/Ingressos'));
const Live                     = lazy(() => import('./pages/Live'));
const Certificates             = lazy(() => import('./pages/Certificates'));
const StageMarker              = lazy(() => import('./pages/StageMarker'));
const EquipeProdutor           = lazy(() => import('./pages/EquipeProdutor'));
const SuporteJuri              = lazy(() => import('./pages/SuporteJuri'));
const VideoSelection           = lazy(() => import('./pages/VideoSelection'));
// SeletivaInscrito removido — funcionalidade consolidada em /minhas-coreografias
// (refactor 2026-05-19, padrão Sympla/Eventbrite). Redirect 301 abaixo.
const RegulationAIParser       = lazy(() => import('./pages/RegulationAIParser'));
const JudgeLogin               = lazy(() => import('./pages/JudgeLogin'));
const JuradoSeletiva           = lazy(() => import('./pages/JuradoSeletiva'));
const TermoProdutor            = lazy(() => import('./pages/TermoProdutor'));

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

/** Phase 2B: rota do /judge-terminal que aceita ambos os modos:
 * - judgeSession (localStorage) → renderiza standalone (sem layout do produtor)
 * - sem judgeSession → fluxo do produtor com PrivateRoute completo
 *
 * Componente wrapper porque a checagem precisa ser feita no momento do mount
 * (não no momento de criação do JSX da rota, que só roda quando App re-renderiza).
 */
const JudgeTerminalRoute: React.FC<{ privateRouteProps: any }> = ({ privateRouteProps }) => {
  let hasJudgeSession = false;
  try {
    const raw = localStorage.getItem('coreohub_judge_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.expires_at && parsed.expires_at > Date.now()) {
        hasJudgeSession = true;
      }
    }
  } catch {}

  if (hasJudgeSession) {
    // Wrapper h-screen pra o terminal preencher o viewport (sem PrivateLayout
    // que normalmente provê esse contexto pro fluxo do produtor).
    // Em desktop (lg+) usa fundo cinza pra dar contraste com o "card flutuante"
    // do terminal (lg:max-h-[820px]) — mesmo visual do preview tablet.
    return (
      <Suspense fallback={<PageLoader />}>
        <div className="h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 lg:bg-slate-200 lg:dark:bg-black">
          <JudgeTerminal />
        </div>
      </Suspense>
    );
  }
  return <PrivateRoute {...privateRouteProps}><JudgeTerminal /></PrivateRoute>;
};

/** Wrapper genérico pra rotas de jurado standalone (judgeSession do localStorage).
 *  Usado por /deliberacao e /conferencia — não exigem auth de produtor. */
const JudgeStandaloneRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  let hasJudgeSession = false;
  try {
    const raw = localStorage.getItem('coreohub_judge_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.expires_at && parsed.expires_at > Date.now()) hasJudgeSession = true;
    }
  } catch {}

  if (!hasJudgeSession) return <Navigate to="/" replace />;

  return (
    <Suspense fallback={<PageLoader />}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        {children}
      </div>
    </Suspense>
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
        <main className="flex-1 overflow-y-auto relative z-10 pb-20 sm:pb-4">
          {/* ImpersonateBanner: sticky topo quando super admin está
              "Visualizando como Produtor". Z-index alto pra ficar sobre
              outros banners. Some automaticamente quando não está impersonando. */}
          <ImpersonateBanner />
          {/* DemoBanner: sticky no topo se evento ativo é demo (Stripe Test Mode pattern) */}
          <DemoBanner />
          {/* EmailVerifyBanner: padrão Stripe/Linear — sinaliza email não
              confirmado sem bloquear. Some quando user verifica ou dispensa por 24h. */}
          <EmailVerifyBanner />
          {/* InstallAppBanner: aparece após 2ª sessão (não first-load) — research
              Pinterest mostra que prompt cedo demais tem 91% dismiss rate. */}
          <InstallAppBanner />
          <div className="p-3 lg:p-4">
            <Suspense fallback={<PageLoader />}>
              {children}
            </Suspense>
          </div>
          {/* Rodapé global do selo Asaas removido em 2026-05-13 — playbook
              pág. 16 proíbe usar selo fora de contexto financeiro. O selo
              segue presente em todas as telas explicitamente financeiras
              (Auth, Checkouts, comprovantes, AccountSettings, e-mails). */}
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

  // Phase 5: bootstrapa o drainer de outbox uma vez por sessão. Idempotente —
  // chamadas extras são no-op. Lazy-import pra não inflar bundle inicial.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('./services/outboxDrainer');
        if (!cancelled) mod.startDrainer();
      } catch (e) {
        console.warn('[Phase5] drainer falhou ao bootar:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fase 4 parcial: captura UTM params da URL no mount inicial e persiste em
  // sessionStorage. Quando inscrição for criada, os UTMs salvos vão pra
  // registrations pra produtor saber origem da venda. Idempotente.
  useEffect(() => {
    void import('./services/utmTracking').then(mod => mod.captureUtmsFromUrl());
  }, []);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  const fetchConfig = async () => {
    try {
      const { fetchActiveEventConfig } = await import('./services/supabase');
      const data = await fetchActiveEventConfig('*');
      if (data) setConfig(data);
    } catch (err: any) {
      console.error('Error fetching config:', err);
    }
  };

  // Seletiva de Vídeo: a flag agora é DERIVADA — produtor vê o link se algum
  // evento dele tem seletiva ativa; inscrito vê se tem inscrição em evento com
  // seletiva. configuracoes.video_selection_enabled (global) virou stale —
  // a feature é por evento, não por tenant.
  const [videoSelectionFromEvents, setVideoSelectionFromEvents] = useState(false);
  useEffect(() => {
    const checkVideoSelection = async () => {
      const userId = session?.user?.id;
      if (!userId) { setVideoSelectionFromEvents(false); return; }
      try {
        // Como produtor: tem evento próprio com flag ON?
        const { data: ownedEvents } = await supabase
          .from('events')
          .select('id')
          .eq('created_by', userId)
          .eq('video_selection_enabled', true)
          .limit(1);
        if (ownedEvents && ownedEvents.length > 0) {
          setVideoSelectionFromEvents(true);
          return;
        }
        // Como inscrito: tem alguma registration em evento com flag ON?
        // Query split (mais robusta que !inner+eq.foreign_table) — pega event_ids
        // das registrations e checa video_selection_enabled em events separado.
        const { data: regs } = await supabase
          .from('registrations')
          .select('event_id')
          .eq('user_id', userId);
        const eventIds = Array.from(new Set((regs ?? []).map((r: any) => r.event_id).filter(Boolean)));
        if (eventIds.length > 0) {
          const { data: eventsWithSel } = await supabase
            .from('events')
            .select('id')
            .in('id', eventIds)
            .eq('video_selection_enabled', true)
            .limit(1);
          if ((eventsWithSel ?? []).length > 0) {
            setVideoSelectionFromEvents(true);
            return;
          }
        }
        setVideoSelectionFromEvents(false);
      } catch {
        setVideoSelectionFromEvents(false);
      }
    };
    void checkVideoSelection();
  }, [session?.user?.id]);

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

  // Flag derivada: produtor com evento de seletiva OU inscrito em evento de
  // seletiva. Mantém legacy config.video_selection_enabled como fallback OR.
  const videoSelectionEnabled = videoSelectionFromEvents || (config.video_selection_enabled ?? false);
  const privateRouteProps = { session, profile, activeRole, theme, toggleTheme, setActiveRole, videoSelectionEnabled };

  // Phase 2B+: tablet em modo Terminal redireciona / pra /judge-login/<token>
  // automaticamente (kiosk mode).
  const RootRedirect = () => {
    try {
      const isKiosk = localStorage.getItem('coreohub_tablet_kiosk_mode') === 'true';
      const token = localStorage.getItem('coreohub_tablet_judge_token');
      if (isKiosk && token) return <Navigate to={`/judge-login/${token}`} replace />;
    } catch {}
    return <Navigate to="/login" replace />;
  };

  return (
    <Router>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        {/* Sales page nova (preview) — acesse via /lp pra ver sem afetar a home */}
        <Route path="/lp" element={<LandingPage />} />
        {/* Setor público: landing dedicada + PDF técnico imprimível */}
        <Route path="/governo" element={<Suspense fallback={<PageLoader />}><LandingGoverno /></Suspense>} />
        <Route path="/governo/proposta" element={<Suspense fallback={<PageLoader />}><PropostaGoverno /></Suspense>} />
        {/* Estúdios de dança: espetáculo / mostra / recital de fim de ano */}
        <Route path="/estudios" element={<Suspense fallback={<PageLoader />}><LandingEstudios /></Suspense>} />
        <Route path="/login" element={<Auth />} />
        <Route path="/register" element={<Auth />} />
        <Route path="/judge-login" element={<Suspense fallback={<PageLoader />}><JudgeLogin /></Suspense>} />
        <Route path="/judge-login/:token" element={<Suspense fallback={<PageLoader />}><JudgeLogin /></Suspense>} />
        <Route path="/convite/:token" element={<Suspense fallback={<PageLoader />}><ProducerInviteLanding /></Suspense>} />
        <Route path="/equipe-convite/:token" element={<Suspense fallback={<PageLoader />}><TeamInviteLanding /></Suspense>} />

        <Route path="/dashboard" element={<PrivateRoute {...privateRouteProps}><Dashboard profile={profile!} config={config} activeRole={activeRole!} /></PrivateRoute>} />
        <Route path="/bailarinos" element={<PrivateRoute {...privateRouteProps}><Bailarinos /></PrivateRoute>} />
        <Route path="/minhas-coreografias" element={<PrivateRoute {...privateRouteProps}><MinhasCoreografias /></PrivateRoute>} />
        <Route path="/central-de-midia" element={<PrivateRoute {...privateRouteProps}><CentralDeMidia /></PrivateRoute>} />
        <Route path="/profile" element={<PrivateRoute {...privateRouteProps}><Profile /></PrivateRoute>} />
        <Route path="/meus-resultados" element={<PrivateRoute {...privateRouteProps}><MyResults activeRole={activeRole!} /></PrivateRoute>} />
        <Route path="/credencial/:registrationId" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><Credencial /></Suspense></PrivateRoute>} />
        <Route path="/credenciais" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><Credenciais /></Suspense></PrivateRoute>} />

        <Route path="/qg-organizador" element={<PrivateRoute {...privateRouteProps}><ProducerDashboard profile={profile!} /></PrivateRoute>} />
        <Route path="/registrations" element={<PrivateRoute {...privateRouteProps}><Registrations /></PrivateRoute>} />
        <Route path="/manage-schedule" element={<PrivateRoute {...privateRouteProps}><Schedule /></PrivateRoute>} />
        <Route path="/apuracao" element={<PrivateRoute {...privateRouteProps}><ResultsPanel /></PrivateRoute>} />
        <Route path="/equipe-jurados" element={<PrivateRoute {...privateRouteProps}><JudgesManagement /></PrivateRoute>} />
        <Route path="/account-settings" element={<PrivateRoute {...privateRouteProps}><AccountSettings onSaveSuccess={fetchConfig} /></PrivateRoute>} />
        <Route path="/termo-produtor" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><TermoProdutor /></Suspense></PrivateRoute>} />
        {/* Narração IA: atalho dedicado em vez de aba dentro de Configurações.
            Reusa AccountSettings com tab pré-selecionada e label customizado. */}
        <Route path="/narracao-ia" element={<PrivateRoute {...privateRouteProps}><AccountSettings onSaveSuccess={fetchConfig} forcedTab="Fluxo do Evento" pageLabel="Narração IA" /></PrivateRoute>} />

        <Route path="/judge-terminal" element={<JudgeTerminalRoute privateRouteProps={privateRouteProps} />} />
        <Route path="/deliberacao" element={<JudgeStandaloneRoute><Deliberacao /></JudgeStandaloneRoute>} />
        <Route path="/conferencia" element={<JudgeStandaloneRoute><Conferencia /></JudgeStandaloneRoute>} />
        <Route path="/jurado-seletiva" element={<JudgeStandaloneRoute><JuradoSeletiva /></JudgeStandaloneRoute>} />
        <Route path="/deliberacoes" element={<PrivateRoute {...privateRouteProps}><Deliberacoes /></PrivateRoute>} />
        <Route path="/judge-practice" element={<PrivateRoute {...privateRouteProps}><JudgePractice /></PrivateRoute>} />
        <Route path="/equipe-jurados-config" element={<PrivateRoute {...privateRouteProps}><JudgeManagement /></PrivateRoute>} />

        <Route path="/check-in" element={<PrivateRoute {...privateRouteProps}><CheckIn /></PrivateRoute>} />
        <Route path="/marcacao-palco" element={<PrivateRoute {...privateRouteProps}><StageMarker /></PrivateRoute>} />
        <Route path="/minha-equipe" element={<PrivateRoute {...privateRouteProps}><EquipeProdutor /></PrivateRoute>} />
        <Route path="/suporte-juri" element={<PrivateRoute {...privateRouteProps}><SuporteJuri /></PrivateRoute>} />
        <Route path="/ingressos" element={<PrivateRoute {...privateRouteProps}><Ingressos /></PrivateRoute>} />
        <Route path="/live" element={<PrivateRoute {...privateRouteProps}><Live /></PrivateRoute>} />

        <Route path="/seletiva-video"       element={<PrivateRoute {...privateRouteProps}><VideoSelection /></PrivateRoute>} />
        {/* Compat 301 — refactor 2026-05-19 consolidou em /minhas-coreografias */}
        <Route path="/minha-seletiva"       element={<Navigate to="/minhas-coreografias?tab=selecao" replace />} />
        <Route path="/importar-regulamento" element={<PrivateRoute {...privateRouteProps}><RegulationAIParser /></PrivateRoute>} />

        <Route path="/criar-evento" element={<Suspense fallback={<PageLoader />}><CriarEventoGate /></Suspense>} />
        <Route path="/event-config" element={<PrivateRoute {...privateRouteProps}><RegistrationGradeConfig /></PrivateRoute>} />
        <Route path="/ai-analysis" element={<PrivateRoute {...privateRouteProps}><AIAnalysis /></PrivateRoute>} />
        <Route path="/super-admin" element={<PrivateRoute {...privateRouteProps}><SuperAdminDashboard /></PrivateRoute>} />
        <Route path="/certificados" element={<PrivateRoute {...privateRouteProps}><Certificates /></PrivateRoute>} />
        <Route path="/trilhas" element={<PrivateRoute {...privateRouteProps}><TracksManagement /></PrivateRoute>} />
        <Route path="/battle-config" element={<PrivateRoute {...privateRouteProps}><BattleConfig /></PrivateRoute>} />
        <Route path="/battle-arena" element={<PrivateRoute {...privateRouteProps}><BattleArenaLive /></PrivateRoute>} />

        <Route path="/festivais" element={<Suspense fallback={<PageLoader />}><Festivais /></Suspense>} />
        <Route path="/evento/:idOrSlug" element={<Suspense fallback={<PageLoader />}><PublicEventPage /></Suspense>} />
        <Route path="/u/:code" element={<Suspense fallback={<PageLoader />}><ShortCodeRedirect /></Suspense>} />
        {/* Ingressos de plateia — todas públicas (guest checkout / acesso por token).
            Carrinho multi-tipo via /checkout-ingresso/<slug> (state.cart da vitrine);
            a rota legada com :ticketTypeIdx vira cart {idx:1} dentro do componente
            (cobre links antigos compartilhados via WhatsApp/Instagram). */}
        <Route path="/checkout-ingresso/:idOrSlug" element={<Suspense fallback={<PageLoader />}><CheckoutIngresso /></Suspense>} />
        <Route path="/checkout-ingresso/:idOrSlug/:ticketTypeIdx" element={<Suspense fallback={<PageLoader />}><CheckoutIngresso /></Suspense>} />
        <Route path="/meu-ingresso/:token" element={<Suspense fallback={<PageLoader />}><MeuIngresso /></Suspense>} />
        {/* Workshops Etapa 1 — todas públicas (vitrine + guest checkout + voucher por token) */}
        <Route path="/workshop/:idOrSlug" element={<Suspense fallback={<PageLoader />}><PublicWorkshopPage /></Suspense>} />
        <Route path="/checkout-workshop/:id" element={<Suspense fallback={<PageLoader />}><CheckoutWorkshop /></Suspense>} />
        <Route path="/meu-workshop/:token" element={<Suspense fallback={<PageLoader />}><MeuWorkshop /></Suspense>} />
        {/* Etapa 2 Certificados — pública (validação por hash) e privada (lista do inscrito) */}
        <Route path="/validar-certificado/:hash" element={<Suspense fallback={<PageLoader />}><ValidarCertificado /></Suspense>} />
        <Route path="/meus-certificados" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><MeusCertificados /></Suspense></PrivateRoute>} />
        <Route path="/vendas"           element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><VendasOverview /></Suspense></PrivateRoute>} />
        <Route path="/vendas-ingressos" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><VendasIngressos /></Suspense></PrivateRoute>} />
        <Route path="/workshops-do-evento" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><WorkshopsManagement /></Suspense></PrivateRoute>} />
        <Route path="/cupons"           element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><Coupons /></Suspense></PrivateRoute>} />
        <Route path="/festival/:idOrSlug" element={<FestivalShowcase />} />
        {/* Inscrição unificada: ambas as rotas renderizam o mesmo Wizard.
            /inscrever (sem modalidade) → mostra Passo 0 (seleção visual de
            modalidade) antes do passo Coreografia. Usado por entry points
            sem intent expresso (botão "Inscreva-se" do header, link compartilhado,
            site externo, "Ver todas e escolher depois").
            /inscrever/:modalidade → pula Passo 0 e abre direto no Passo 1
            com a modalidade pré-selecionada (editável via select). Usado pelos
            cards Solo/Duo/Trio/Grupo da vitrine, onde o intent é claro.
            /register é alias legacy redirecionando pra /inscrever — mantém
            links externos do produtor funcionando sem refactor de QR code/flyer. */}
        <Route path="/festival/:idOrSlug/register" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><InscricaoWizard /></Suspense></PrivateRoute>} />
        <Route path="/festival/:idOrSlug/inscrever" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><InscricaoWizard /></Suspense></PrivateRoute>} />
        <Route path="/festival/:idOrSlug/inscrever/:modalidade" element={<PrivateRoute {...privateRouteProps}><Suspense fallback={<PageLoader />}><InscricaoWizard /></Suspense></PrivateRoute>} />
        <Route path="/festival/:idOrSlug/checkout" element={<PrivateRoute {...privateRouteProps}><Checkout /></PrivateRoute>} />
        <Route path="/pagamento"             element={<PrivateRoute {...privateRouteProps}><PagamentoInscrito /></PrivateRoute>} />
        <Route path="/pagamento/sucesso"     element={<PrivateRoute {...privateRouteProps}><PagamentoSucesso /></PrivateRoute>} />
        <Route path="/pagamento/pendente"    element={<PrivateRoute {...privateRouteProps}><PagamentoPendente /></PrivateRoute>} />
        <Route path="/pagamento/erro"        element={<PrivateRoute {...privateRouteProps}><PagamentoErro /></PrivateRoute>} />
        <Route path="/festival/:idOrSlug/leaderboard" element={<Leaderboard />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* LGPD — banner de consent de cookies de marketing. Renderiza só
          em surface públicas (lógica interna do componente) e respeita
          consent salvo em localStorage com TTL de 12 meses. */}
      <Suspense fallback={null}><CookieBanner /></Suspense>
    </Router>
  );
};

export default App;
