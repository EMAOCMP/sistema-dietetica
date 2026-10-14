import { useState } from 'react';
import {
  SquaresFour,
  ShoppingCart,
  Package,
  ClockCounterClockwise,
  Truck,
  ChartLine,
  Users,
  Gear,
  QrCode,
  X,
  Calculator,
  ChartBar,
  CaretRight,
} from '@phosphor-icons/react';
import type { Profile } from '../types';

interface MobileTabBarProps {
  profile: Profile | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

type Sheet = null | 'more' | 'scan';

/**
 * Navegación móvil (solo < lg): 4 destinos + botón central Escanear + Más.
 * El botón central abre un sheet: Vender / Ingreso / Producto → va al tab
 * y dispara `dv:open-scanner` (la vista montada abre su escáner).
 */
export function MobileTabBar({ profile, activeTab, setActiveTab }: MobileTabBarProps) {
  const [sheet, setSheet] = useState<Sheet>(null);

  const goScan = (tab: 'pos' | 'intake' | 'products') => {
    setSheet(null);
    setActiveTab(tab);
    window.setTimeout(() => window.dispatchEvent(new Event('dv:open-scanner')), 120);
  };

  const tabs = [
    { id: 'dashboard', label: 'Panel', icon: SquaresFour },
    { id: 'pos', label: 'Venta', icon: ShoppingCart },
  ];
  const stockTab = { id: 'products', label: 'Stock', icon: Package };

  const moreItems = [
    { id: 'intake', label: 'Ingreso Mercadería', icon: Truck },
    { id: 'history', label: 'Pedidos & Historial', icon: ClockCounterClockwise },
    { id: 'activity', label: 'Mi actividad', icon: ChartLine },
    ...((['admin', 'supervisor', 'vendedor'].includes(profile?.role || ''))
      ? [
          { id: 'cashclose', label: 'Cierre de Caja', icon: Calculator },
          { id: 'reports', label: 'Reportes de Ganancias', icon: ChartBar },
          { id: 'users', label: 'Usuarios y Actividad', icon: Users },
        ]
      : []),
    ...(['admin', 'supervisor', 'vendedor'].includes(profile?.role || '')
      ? [{ id: 'settings', label: 'Configuración', icon: Gear }]
      : []),
  ];

  const scanOptions = [
    { id: 'pos', label: 'Vender', desc: 'Escanear al carrito', icon: ShoppingCart },
    { id: 'intake', label: 'Ingreso', desc: 'Escanear al lote', icon: Truck },
    { id: 'products', label: 'Producto', desc: 'Buscar o crear', icon: Package },
  ] as const;

  const renderTab = (item: { id: string; label: string; icon: any }) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => { setSheet(null); setActiveTab(item.id); }}
        aria-label={item.label}
        className={`flex-1 flex flex-col items-center gap-0.5 py-2 cursor-pointer transition-colors ${
          isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-zinc-500'
        }`}
      >
        <Icon size={22} weight={isActive ? 'fill' : 'regular'} />
        <span className={`text-[10px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
      </button>
    );
  };

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 dark:bg-obsidian-900/95 dark:border-obsidian-700"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Navegación principal"
      >
        <div className="flex items-end px-2 pt-1.5 pb-1.5">
          {tabs.map(renderTab)}
          <button
            type="button"
            onClick={() => setSheet(sheet === 'scan' ? null : 'scan')}
            aria-label="Escanear"
            className="flex-1 flex flex-col items-center gap-0.5 cursor-pointer"
          >
            <span className={`w-12 h-12 -mt-7 rounded-full flex items-center justify-center shadow-glow-brand transition-transform active:scale-95 ${
              sheet === 'scan' ? 'bg-emerald-500 text-white' : 'bg-emerald-600 text-white'
            }`}>
              <QrCode size={24} weight="bold" />
            </span>
            <span className="text-[10px] font-bold leading-none text-emerald-700 dark:text-emerald-400">Escanear</span>
          </button>
          {renderTab(stockTab)}
          <button
            type="button"
            onClick={() => setSheet(sheet === 'more' ? null : 'more')}
            aria-label="Más opciones"
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 cursor-pointer transition-colors ${
              sheet === 'more' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-zinc-500'
            }`}
          >
            <span className="text-lg leading-none font-bold tracking-widest">···</span>
            <span className="text-[10px] leading-none font-medium">Más</span>
          </button>
        </div>
      </nav>

      {sheet && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSheet(null)} />
          <div
            className="absolute bottom-0 inset-x-0 bg-white dark:bg-obsidian-800 rounded-t-3xl p-4 pb-8 shadow-2xl animate-row"
            style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
          >
            <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-white/15 mx-auto mb-3" />
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-extrabold text-slate-900 dark:text-white">
                {sheet === 'scan' ? '¿Para qué escaneás?' : 'Más opciones'}
              </p>
              <button onClick={() => setSheet(null)} aria-label="Cerrar" className="p-1.5 text-slate-400 cursor-pointer">
                <X size={18} />
              </button>
            </div>
            {sheet === 'scan' ? (
              <div className="space-y-2">
                {scanOptions.map((o) => {
                  const Icon = o.icon;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => goScan(o.id)}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 dark:bg-white/5 dark:hover:bg-emerald-500/10 transition cursor-pointer text-left"
                    >
                      <span className="w-10 h-10 rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <Icon size={20} weight="bold" />
                      </span>
                      <span>
                        <span className="block text-sm font-bold text-slate-900 dark:text-white">{o.label}</span>
                        <span className="block text-xs text-slate-500 dark:text-zinc-400">{o.desc}</span>
                      </span>
                      <CaretRight size={16} className="ml-auto text-slate-300" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1">
                {moreItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setSheet(null); setActiveTab(item.id); }}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl transition cursor-pointer text-left ${
                        isActive ? 'bg-emerald-600/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'
                      }`}
                    >
                      <Icon size={20} weight={isActive ? 'fill' : 'regular'}
                        className={isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
                      <span className={`text-sm ${isActive ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'font-semibold text-slate-700 dark:text-zinc-200'}`}>
                        {item.label}
                      </span>
                      <CaretRight size={16} className="ml-auto text-slate-300" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
