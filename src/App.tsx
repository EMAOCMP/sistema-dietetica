import { useEffect, useState, useRef, Suspense, lazy } from 'react';
import { supabase } from './lib/supabase';
import type { Profile } from './types';
import { Login } from './components/layout/Login';
import { Navbar } from './components/layout/Navbar';
import { DashboardView } from './components/views/DashboardView';
import { POSView } from './components/views/POSView';
import { OfflineIndicator } from './components/ui/OfflineIndicator';
import { NotificationsPanel } from './components/ui/NotificationsPanel';
import { CommandPalette } from './components/ui/CommandPalette';
import { MobileTabBar } from './components/layout/MobileTabBar';
import { List, MagnifyingGlass, Sun, Moon, SignOut, SidebarSimple, Sidebar, Question } from '@phosphor-icons/react';
import { Plus, Check } from 'lucide-react';
import { startSyncEngine, stopSyncEngine } from './lib/syncEngine';
import { ScannerProvider } from './features/scanner/ScannerProvider';
import { OnboardingProvider, ProductTour, GuideCenter, SectionHint, useOnboarding, hasCompletedTour, CHECKLIST_SECTIONS } from './features/onboarding';

/** Botón para abrir el Centro de guías. */
function TourButton() {
  const { openGuide } = useOnboarding();
  return (
    <button
      onClick={openGuide}
      data-tour="help"
      title="Centro de guías"
      aria-label="Abrir centro de guías"
      className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-obsidian-800 hover:bg-slate-200 dark:hover:bg-obsidian-700 transition-colors cursor-pointer text-slate-500 dark:text-zinc-400 shrink-0"
    >
      <Question size={18} weight="bold" />
    </button>
  );
}

/** Auto-inicia el recorrido la primera vez (persiste en localStorage + nube). */
function TourStarter() {
  const { startTour, tourOpen, ready } = useOnboarding();
  useEffect(() => {
    if (!ready || tourOpen || hasCompletedTour()) return;
    const t = window.setTimeout(() => startTour(), 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tourOpen]);
  return null;
}

/** Onboarding contextual: sugiere la guía la primera vez que se entra a cada sección. */
function SectionHintTrigger({ activeTab }: { activeTab: string }) {
  const { requestSectionHint, tourOpen, guideOpen, ready } = useOnboarding();
  useEffect(() => {
    if (!ready || tourOpen || guideOpen) return;
    const t = window.setTimeout(() => requestSectionHint(activeTab), 1600);
    return () => window.clearTimeout(t);
  }, [activeTab, tourOpen, guideOpen, ready, requestSectionHint]);
  return null;
}

/** Marca las secciones visitadas (alimenta el checklist de inicio del dashboard). */
function VisitedMarker({ activeTab }: { activeTab: string }) {
  const { markSectionVisited } = useOnboarding();
  useEffect(() => {
    if (!CHECKLIST_SECTIONS.includes(activeTab)) return;
    markSectionVisited(activeTab);
  }, [activeTab, markSectionVisited]);
  return null;
}

const ProductsView = lazy(() => import('./components/views/ProductsView').then(m => ({ default: m.ProductsView })));
const HistoryView = lazy(() => import('./components/views/HistoryView').then(m => ({ default: m.HistoryView })));
const UsersView = lazy(() => import('./components/views/UsersView').then(m => ({ default: m.UsersView })));
const StockIntakeView = lazy(() => import('./components/views/StockIntakeView').then(m => ({ default: m.StockIntakeView })));
const MyActivityView = lazy(() => import('./components/views/MyActivityView').then(m => ({ default: m.MyActivityView })));
const SettingsView = lazy(() => import('./components/views/SettingsView').then(m => ({ default: m.SettingsView })));
const CashCloseView = lazy(() => import('./components/views/CashCloseView').then(m => ({ default: m.CashCloseView })));
const ReportsView = lazy(() => import('./components/views/ReportsView').then(m => ({ default: m.ReportsView })));

export function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem('dv-theme') as 'light' | 'dark') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('dv-theme', theme);
    } catch { /* noop */ }
  }, [theme]);

  // Imprimir siempre en tema claro (legible en papel) y restaurar al cerrar el diálogo
  useEffect(() => {
    const before = () => document.documentElement.classList.remove('dark');
    const after = () => document.documentElement.classList.toggle('dark', theme === 'dark');
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [theme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user);
      else setLoadingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfile(session.user);
      } else {
        setProfile(null);
        setLoadingSession(false);
      }
    });

    // Iniciar motor de sincronización offline
    startSyncEngine();

    return () => {
      subscription.unsubscribe();
      stopSyncEngine();
    };
  }, []);

  type ToastKind = 'info' | 'success' | 'warning' | 'error';
  const [toastKind, setToastKind] = useState<ToastKind>('info');
  const toastTimer = useRef<number | null>(null);
  // DS v2 §4.6: success/info 3.5s, warning/error 6s
  const showToast = (msg: string, kind: ToastKind = 'info') => {
    setToast(msg);
    setToastKind(kind);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      kind === 'warning' || kind === 'error' ? 6000 : 3500
    );
  };

  const fetchProfile = async (user: any) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.warn('Fetch profile failed (offline?), using auth metadata:', error.message);
      } else if (!data) {
        const newProfileData = {
          id: user.id,
          email: user.email || '',
          full_name: user.user_metadata?.full_name || 'Usuario',
          role: 'vendedor' as const,
        };
        const { data: createdProfile, error: insertError } = await supabase
          .from('profiles')
          .insert(newProfileData)
          .select()
          .single();

        if (insertError) {
          console.warn('Insert profile failed (offline?), using auth metadata:', insertError.message);
        } else {
          setProfile(createdProfile);
        }
      } else {
        setProfile(data);
      }
    } catch (err: any) {
      console.warn('Profile fetch error (offline?), using auth metadata:', err?.message || err);
      // Fallback a metadata de auth si todo falla (mínimo privilegio)
      setProfile({
        id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || 'Usuario',
        role: 'vendedor',
      });
    } finally {
      setLoadingSession(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const goTo = (tab: string) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewKey, setViewKey] = useState(0);

  // ⌘K / Ctrl+K global
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goToSearch = (tab: string, productSearch?: string) => {
    if (productSearch) {
      try { localStorage.setItem('dv-product-search', productSearch); } catch { /* noop */ }
      setViewKey((k) => k + 1); // remonta Productos aunque ya estés ahí
    }
    goTo(tab);
    setPaletteOpen(false);
  };

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-[#f4f7f6] flex items-center justify-center text-slate-800 dark:bg-obsidian-950 dark:text-white">
        <p className="text-lg font-medium animate-pulse">Cargando Dietética Vishal...</p>
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <OnboardingProvider userId={profile?.id}>
    <ScannerProvider>
      <div className="min-h-screen flex bg-[#f4f7f6] text-slate-800 dark:bg-obsidian-950 dark:text-zinc-200">
      <Navbar
        profile={profile}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onCloseSidebar={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />

      <OfflineIndicator />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={goToSearch}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        dark={theme === 'dark'}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header (Campify Dark x Premium SaaS) */}
        <header className="h-16 glass-card border-b border-slate-200 dark:border-obsidian-700 flex items-center justify-between px-4 lg:px-6 gap-3 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="hidden text-slate-500 hover:text-slate-900 bg-slate-100 p-2 rounded-lg cursor-pointer dark:text-zinc-400 dark:hover:text-white dark:bg-white/5"
            >
              <List size={20} weight="bold" />
            </button>
            <button
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? 'Expandir menú' : 'Plegar menú'}
              className="hidden lg:flex text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 p-2 rounded-lg cursor-pointer dark:text-zinc-400 dark:hover:text-white dark:bg-white/5 dark:hover:bg-white/10"
            >
              {collapsed ? <SidebarSimple size={20} weight="bold" /> : <Sidebar size={20} weight="bold" />}
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              title="Buscar en la app"
              data-tour="search"
              className="sm:hidden text-slate-500 hover:text-slate-900 bg-slate-100 p-2 rounded-lg cursor-pointer dark:text-zinc-400 dark:hover:text-white dark:bg-white/5"
            >
              <MagnifyingGlass size={20} weight="bold" />
            </button>
            <div
              onClick={() => setPaletteOpen(true)}
              data-tour="search"
              className="relative w-full max-w-xl hidden sm:block group cursor-pointer"
              title="Buscar en la app (Ctrl+K)"
            >
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-hover:text-brand-400 transition-colors" size={16} />
              <input
                type="text"
                readOnly
                placeholder="Buscar productos, ventas, clientes..."
                className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl pl-9 pr-20 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 transition-all dark:bg-obsidian-800 dark:border-obsidian-600 dark:text-zinc-200 cursor-pointer"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 pointer-events-none" data-tour="shortcuts">
                <kbd className="bg-white dark:bg-obsidian-800 border border-slate-200 dark:border-obsidian-600 shadow-sm px-1.5 py-0.5 rounded text-[10px] text-slate-500 font-mono dark:text-zinc-400">⌘</kbd>
                <kbd className="bg-white dark:bg-obsidian-800 border border-slate-200 dark:border-obsidian-600 shadow-sm px-1.5 py-0.5 rounded text-[10px] text-slate-500 font-mono dark:text-zinc-400">K</kbd>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <NotificationsPanel onNavigate={(tab) => goTo(tab)} />
            <div className="h-7 w-px bg-slate-200 hidden sm:block dark:bg-obsidian-700" />
            <TourButton />
            <button
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              data-tour="theme"
              className="w-9 h-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-obsidian-800 hover:bg-slate-200 dark:hover:bg-obsidian-700 transition-colors cursor-pointer"
              title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? <Sun size={19} weight="bold" className="text-amber-400" /> : <Moon size={19} weight="bold" className="text-brand-500" />}
            </button>
            <div className="hidden sm:flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100 transition-colors dark:hover:bg-white/5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-white">{profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}</span>
              </div>
              <div className="hidden md:block text-right min-w-0">
                <p className="text-[12px] font-bold text-slate-800 leading-tight truncate dark:text-zinc-200">{profile?.full_name}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider dark:text-zinc-400">{profile?.role}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Cerrar Sesión"
                className="p-2 text-slate-400 hover:text-red-500 cursor-pointer dark:text-zinc-400 dark:hover:text-red-400"
              >
                <SignOut size={18} />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto relative pb-[76px] lg:pb-0">
          <div key={activeTab} className="view-fade min-h-full">
            {activeTab === 'dashboard' && <DashboardView setActiveTab={setActiveTab} profile={profile} showToast={showToast} />}
            {activeTab === 'products' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando productos…</div>}>
                <ProductsView key={`products-${viewKey}`} showToast={showToast} profile={profile} />
              </Suspense>
            )}
            {activeTab === 'pos' && <POSView profile={profile} showToast={showToast} />}
            {activeTab === 'intake' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando ingresos…</div>}>
                <StockIntakeView showToast={showToast} profile={profile} />
              </Suspense>
            )}
            {activeTab === 'history' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando historial…</div>}>
                <HistoryView />
              </Suspense>
            )}
            {activeTab === 'users' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando usuarios…</div>}>
                <UsersView currentUser={profile} />
              </Suspense>
            )}
            {activeTab === 'activity' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando actividad…</div>}>
                <MyActivityView profile={profile} />
              </Suspense>
            )}
            {activeTab === 'cashclose' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando cierre de caja…</div>}>
                <CashCloseView profile={profile} showToast={showToast} />
              </Suspense>
            )}
            {activeTab === 'reports' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando reportes…</div>}>
                <ReportsView profile={profile} showToast={showToast} />
              </Suspense>
            )}
            {activeTab === 'settings' && (
              <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Cargando configuración…</div>}>
                <SettingsView currentUser={profile} showToast={showToast} />
              </Suspense>
            )}
          </div>
        </main>
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => { goTo('products'); showToast('Nuevo Producto / Stock'); }}
        className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 w-14 h-14 bg-brand-600 hover:bg-brand-500 text-white rounded-full shadow-glow-brand flex items-center justify-center transition-transform hover:scale-110 active:scale-95 z-40 cursor-pointer"
        title="Nueva acción (+)"
      >
        <Plus size={22} />
      </button>

      {/* Mobile bottom navigation */}
      <MobileTabBar profile={profile} activeTab={activeTab} setActiveTab={goTo} />

      {/* Toast */}
      {toast && (
        <div
          role={toastKind === 'error' || toastKind === 'warning' ? 'alert' : 'status'}
          className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-white border border-slate-200 text-slate-800 px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold backdrop-blur-md animate-row flex items-center gap-3 dark:bg-obsidian-800 dark:border-obsidian-600 dark:text-white max-w-[92vw]"
        >
          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
            toastKind === 'error' ? 'bg-red-500/15 text-red-500'
            : toastKind === 'warning' ? 'bg-amber-500/15 text-amber-500'
            : toastKind === 'success' ? 'bg-emerald-500/15 text-emerald-500'
            : 'bg-brand-500/20 text-brand-500 dark:text-brand-400'
          }`}>
            <Check size={14} strokeWidth={3} />
          </div>
          <span className="break-words">{toast}</span>
        </div>
      )}
    </div>
    </ScannerProvider>
    <ProductTour activeTab={activeTab} onNavigate={goTo} />
    <GuideCenter />
    <SectionHint />
    <SectionHintTrigger activeTab={activeTab} />
    <VisitedMarker activeTab={activeTab} />
    <TourStarter />
    </OnboardingProvider>
  );
}

export default App;