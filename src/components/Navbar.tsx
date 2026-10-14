import { useEffect, useState } from 'react';
import type { Profile } from '../types';
import { supabase } from '../lib/supabase';
import {
  SquaresFour,
  Package,
  ShoppingCart,
  ClockCounterClockwise,
  Users,

  SignOut,
  X,
  Gear,
  CaretDoubleLeft,
  CaretDoubleRight,
  Truck,
  ChartLine,
  ChartBar,
  Calculator,
} from '@phosphor-icons/react';

interface NavbarProps {
  profile: Profile | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCloseSidebar: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Navbar({
  profile,
  activeTab,
  setActiveTab,
  sidebarOpen,
  onCloseSidebar,
  collapsed = false,
  onToggleCollapse,
}: NavbarProps) {
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const [lowStockCount, setLowStockCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const { data } = await supabase
          .from('products')
          .select('stock_quantity, min_stock')
          .eq('is_active', true);
        const critical = (data || []).filter(
          (p: any) => Number(p.stock_quantity) <= Number(p.min_stock || 5)
        ).length;
        setLowStockCount(critical);
      } catch { /* offline: sin badge */ }
      try {
        const { getPendingCount } = await import('../lib/offlineDB');
        setPendingCount(await getPendingCount());
      } catch { /* IndexedDB no disponible */ }
    };
    fetchBadges();
    const id = setInterval(fetchBadges, 60000);
    window.addEventListener('online', fetchBadges);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', fetchBadges);
    };
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Panel Principal', icon: SquaresFour, badge: pendingCount > 0 ? pendingCount : undefined, badgeColor: 'sky' as const },
    { id: 'pos', label: 'Venta Rápida (POS)', icon: ShoppingCart },
    { id: 'products', label: 'Productos / Stock', icon: Package, badge: lowStockCount > 0 ? lowStockCount : undefined, badgeColor: 'red' as const },
    { id: 'intake', label: 'Ingreso Mercadería', icon: Truck },
    { id: 'history', label: 'Pedidos & Historial', icon: ClockCounterClockwise },
    { id: 'activity', label: 'Mi actividad', icon: ChartLine },
    ...(['admin', 'supervisor', 'vendedor'].includes(profile?.role || '') ? [{ id: 'cashclose', label: 'Cierre de Caja', icon: Calculator }] : []),
    ...(['admin', 'supervisor', 'vendedor'].includes(profile?.role || '') ? [{ id: 'reports', label: 'Reportes de Ganancias', icon: ChartBar }] : []),
    ...(['admin', 'supervisor', 'vendedor'].includes(profile?.role || '') ? [{ id: 'users', label: 'Usuarios y Actividad', icon: Users }] : []),
  ];

  const badgeStyles: Record<string, string> = {
    red: 'bg-red-500 text-white',
    sky: 'bg-sky-500 text-white',
  };

  const renderItem = (item: { id: string; label: string; icon: any; badge?: number; badgeColor?: 'red' | 'sky' }) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <li key={item.id} className="relative">
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 -ml-3 w-1 h-8 rounded-r-full bg-brand-500 shadow-glow-brand" />
        )}
        <button
          type="button"
          onClick={() => setActiveTab(item.id)}
          title={collapsed ? item.label : undefined}
          aria-label={item.label}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all cursor-pointer group ${
            collapsed ? 'justify-center px-0' : ''
          } ${
            isActive
              ? 'bg-brand-500/10 text-brand-600 font-semibold dark:bg-brand-500/10 dark:text-brand-400'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-medium dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
          }`}
        >
          <span className="relative shrink-0">
            <Icon
              size={18}
              weight={isActive ? 'fill' : 'regular'}
              className={`transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-brand-600 dark:text-brand-400' : 'group-hover:text-slate-900 dark:group-hover:text-white'}`}
            />
            {collapsed && item.badge !== undefined && (
              <span className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center ${badgeStyles[item.badgeColor || 'red']}`}>
                {item.badge > 99 ? '99+' : item.badge}
              </span>
            )}
          </span>
          {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
          {!collapsed && item.badge !== undefined && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badgeStyles[item.badgeColor || 'red']}`}>
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <>
      {/* Sidebar — Campify Dark x Premium SaaS (plegable a demanda) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col transition-all duration-300 lg:static lg:translate-x-0 dark:bg-obsidian-800 dark:border-obsidian-700 ${
          collapsed ? 'lg:w-20' : 'lg:w-64'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* User Profile Area */}
        <div className="p-5 border-b border-slate-200 flex items-center gap-3 relative bg-gradient-to-b from-brand-50/50 to-transparent dark:border-obsidian-700 dark:from-white/5 dark:to-transparent">
          <div className={`shrink-0 shadow-glow-brand ${collapsed ? 'mx-auto' : ''}`}>
            <img src="/logo-512.jpg" alt="Vishal" className="w-10 h-10 object-contain rounded-xl" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h2 className="text-[13px] font-bold truncate text-slate-900 uppercase tracking-wider dark:text-white">Dietética Vishal</h2>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse" />
                <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider dark:text-zinc-400">{profile?.role || 'usuario'}</p>
              </div>
              <span className="mt-2 inline-block text-[10px] uppercase tracking-wider border border-accent-emerald/50 text-accent-emerald px-2 py-0.5 rounded-lg bg-accent-emerald/10 font-bold">
                Pro Activo
              </span>
            </div>
          )}
          <button
            type="button"
            className="lg:hidden text-slate-400 hover:text-slate-900 absolute top-3 right-3 cursor-pointer dark:text-zinc-400 dark:hover:text-white"
            onClick={onCloseSidebar}
          >
            <X size={18} />
          </button>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={collapsed ? 'Expandir menú' : 'Plegar menú'}
              className={`hidden lg:flex absolute top-3 right-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 cursor-pointer dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/5`}
            >
              {collapsed ? <CaretDoubleRight size={16} weight="bold" /> : <CaretDoubleLeft size={16} weight="bold" />}
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          {!collapsed && <div className="px-6 pb-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider dark:text-zinc-500">Principal</div>}
          <ul className="space-y-1 px-3">
            {navItems.slice(0, 3).map(renderItem)}
          </ul>
          {!collapsed && <div className="px-6 pt-4 pb-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider dark:text-zinc-500">Gestión</div>}
          <ul className="space-y-1 px-3">
            {navItems.slice(3).map(renderItem)}
          </ul>
          </nav>

        {/* Configuración (solo admin) */}
        {['admin', 'supervisor', 'vendedor'].includes(profile?.role || '') && !collapsed && (
          <ul className="space-y-1 px-3 mt-1 pb-2">
            <li>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg font-medium text-sm transition-all cursor-pointer group ${activeTab === 'settings' ? 'bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'}`}
              >
                <Gear size={18} className="shrink-0" />
                Configuración
              </button>
            </li>
          </ul>
        )}

        {/* Footer / Perfil + Logout */}
        <div className="p-4 border-t border-slate-200 dark:border-obsidian-700">
          {!collapsed ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 dark:bg-white/5 dark:border-obsidian-700">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-white">{profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate dark:text-zinc-200">{profile?.full_name || 'Usuario'}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider dark:text-zinc-500">{profile?.role || 'usuario'}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Cerrar Sesión"
                  aria-label="Cerrar Sesión"
                  className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer dark:hover:text-red-400 dark:hover:bg-red-500/10"
                >
                  <SignOut size={17} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              title="Cerrar Sesión"
              aria-label="Cerrar Sesión"
              className="w-full flex justify-center px-0 py-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-medium text-sm transition-all cursor-pointer dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
            >
              <SignOut size={18} className="shrink-0" />
            </button>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden" onClick={onCloseSidebar} />
      )}
    </>
  );
}