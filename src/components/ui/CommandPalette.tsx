import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  MagnifyingGlass, ShoppingCart, Package, ClockCounterClockwise,
  Users, SquaresFour, Sun, Moon, ChartBar,
} from '@phosphor-icons/react';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: string, productSearch?: string) => void;
  onToggleTheme: () => void;
  dark: boolean;
}

interface ActionItem {
  kind: 'action';
  id: string;
  label: string;
  hint: string;
  keywords: string;
  icon: React.ReactNode;
  run: () => void;
}

interface ProductItem {
  kind: 'product';
  id: string;
  name: string;
  meta: string;
  price: string;
}

type Item = ActionItem | ProductItem;

export function CommandPalette({ open, onClose, onNavigate, onToggleTheme, dark }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset al abrir + foco
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      if (products.length === 0) {
        setLoadingProducts(true);
        (async () => {
          try {
            const { data } = await supabase
              .from('products')
              .select('id, name, barcode, category, retail_price, stock_quantity, unit_type')
              .eq('is_active', true)
              .order('name')
              .limit(200);
            setProducts(data || []);
          } catch { /* offline: sin resultados de productos */ }
          setLoadingProducts(false);
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const actions: ActionItem[] = useMemo(() => [
    { kind: 'action', id: 'pos', label: 'Venta Rápida', hint: 'Caja / POS', keywords: 'caja pos vender cobrar venta rapida', icon: <ShoppingCart size={17} weight="fill" />, run: () => onNavigate('pos') },
    { kind: 'action', id: 'products', label: 'Productos', hint: 'Stock', keywords: 'productos stock inventario mercaderia', icon: <Package size={17} weight="fill" />, run: () => onNavigate('products') },
    { kind: 'action', id: 'dashboard', label: 'Panel Principal', hint: 'Resumen', keywords: 'panel dashboard inicio resumen operativo', icon: <SquaresFour size={17} weight="fill" />, run: () => onNavigate('dashboard') },
    { kind: 'action', id: 'history', label: 'Historial', hint: 'Pedidos', keywords: 'historial pedidos tickets ventas', icon: <ClockCounterClockwise size={17} weight="fill" />, run: () => onNavigate('history') },
    { kind: 'action', id: 'reports', label: 'Reportes de Ganancias', hint: 'Diario / Semanal / Mensual', keywords: 'reportes ganancias profit diario semanal mensual margen', icon: <ChartBar size={17} weight="fill" />, run: () => onNavigate('reports') },
    { kind: 'action', id: 'users', label: 'Usuarios', hint: 'Permisos', keywords: 'usuarios permisos roles empleados', icon: <Users size={17} weight="fill" />, run: () => onNavigate('users') },
    { kind: 'action', id: 'theme', label: dark ? 'Tema claro' : 'Tema oscuro', hint: 'Apariencia', keywords: 'tema oscuro claro dark light apariencia modo', icon: dark ? <Sun size={17} weight="fill" /> : <Moon size={17} weight="fill" />, run: () => { onToggleTheme(); onClose(); } },
  ], [onNavigate, onToggleTheme, onClose, dark]);

  const matchedActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => (a.label + ' ' + a.keywords).toLowerCase().includes(q));
  }, [actions, query]);

  const matchedProducts: ProductItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(q) ||
        String(p.barcode || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q)
      )
      .slice(0, 6)
      .map((p) => ({
        kind: 'product' as const,
        id: p.id,
        name: p.name,
        meta: `${p.category || 'General'} · Stock ${p.stock_quantity} ${p.unit_type === 'kg' ? 'kg' : 'un'}`,
        price: `$${Number(p.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      }));
  }, [products, query]);

  const flat: Item[] = useMemo(
    () => [...matchedActions, ...matchedProducts],
    [matchedActions, matchedProducts]
  );

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runItem = (item: Item) => {
    if (item.kind === 'action') item.run();
    else onNavigate('products', item.name);
  };

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="Búsqueda global">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative mx-auto mt-[8vh] sm:mt-[12vh] w-[calc(100%-2rem)] max-w-lg rounded-2xl glass-card border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150">
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-slate-200 dark:border-white/10">
          <MagnifyingGlass size={18} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (flat.length ? (a + 1) % flat.length : 0)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); const it = flat[active]; if (it) runItem(it); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            }}
            placeholder="Buscar productos, acciones..."
            className="flex-1 bg-transparent text-sm font-medium text-slate-800 dark:text-white focus:outline-none placeholder:text-slate-400"
            aria-label="Buscar en la app"
          />
          <kbd className="text-[10px] font-mono text-slate-400 border border-slate-200 dark:border-white/10 rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {matchedActions.length > 0 && (
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Acciones</p>
          )}
          {matchedActions.map((a) => {
            const idx = flat.indexOf(a);
            const on = idx === active;
            return (
              <button
                key={a.id}
                data-active={on}
                onMouseEnter={() => setActive(idx)}
                onClick={() => runItem(a)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${on ? 'bg-slate-100 dark:bg-white/10' : ''}`}
              >
                <span className="text-slate-500 dark:text-zinc-300">{a.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-800 dark:text-white truncate">{a.label}</span>
                </span>
                <span className="text-[10px] font-semibold text-slate-400 shrink-0">{a.hint}</span>
              </button>
            );
          })}

          {(matchedProducts.length > 0 || (loadingProducts && query.trim().length >= 2)) && (
            <p className="px-2.5 pt-2 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">Productos</p>
          )}
          {loadingProducts && query.trim().length >= 2 && matchedProducts.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400 animate-pulse">Buscando...</p>
          )}
          {matchedProducts.map((p) => {
            const idx = flat.indexOf(p);
            const on = idx === active;
            return (
              <button
                key={p.id}
                data-active={on}
                onMouseEnter={() => setActive(idx)}
                onClick={() => runItem(p)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${on ? 'bg-slate-100 dark:bg-white/10' : ''}`}
              >
                <Package size={17} className="text-slate-400 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-800 dark:text-white truncate">{p.name}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{p.meta}</span>
                </span>
                <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 tnum shrink-0">{p.price}</span>
              </button>
            );
          })}

          {query.trim().length >= 2 && flat.length === 0 && !loadingProducts && (
            <p className="px-3 py-6 text-center text-sm text-slate-400">Sin resultados para “{query.trim()}”</p>
          )}
        </div>

        <div className="hidden sm:flex items-center gap-4 px-4 py-2.5 border-t border-slate-200 dark:border-white/10 text-[11px] text-slate-400">
          <span><kbd className="font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="font-mono">Enter</kbd> abrir</span>
          <span><kbd className="font-mono">Esc</kbd> cerrar</span>
        </div>
      </div>
    </div>
  );
}
