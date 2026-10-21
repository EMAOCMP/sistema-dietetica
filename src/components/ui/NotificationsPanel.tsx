import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Bell, Warning, Clock, CloudSlash, CheckCircle } from '@phosphor-icons/react';

export interface AppNotification {
  id: string;
  type: 'low_stock' | 'expiring' | 'offline_queue' | 'goal';
  title: string;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
  tab: string;
}

interface NotificationsPanelProps {
  onNavigate: (tab: string) => void;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const notifs: AppNotification[] = [];

      // 1. Stock crítico
      const { data: lowStock } = await supabase
        .from('products')
        .select('id, name, stock_quantity, min_stock')
        .eq('is_active', true);

      const critical = (lowStock || []).filter(
        (p: any) => Number(p.stock_quantity) <= Number(p.min_stock || 5)
      );
      if (critical.length > 0) {
        notifs.push({
          id: 'low-stock',
          type: 'low_stock',
          title: `${critical.length} producto${critical.length !== 1 ? 's' : ''} con stock crítico`,
          detail: critical.slice(0, 3).map((p: any) => p.name).join(', ') + (critical.length > 3 ? '…' : ''),
          severity: 'critical',
          tab: 'dashboard',
        });
      }

      // 2. Próximos a vencer (30 días)
      const in30 = new Date();
      in30.setDate(in30.getDate() + 30);
      const { data: expiring } = await supabase
        .from('product_batches')
        .select('id, expiry_date, quantity, products(name)')
        .gt('quantity', 0)
        .lte('expiry_date', in30.toISOString().split('T')[0])
        .order('expiry_date', { ascending: true })
        .limit(10);

      if (expiring && expiring.length > 0) {
        const expired = expiring.filter((b: any) => new Date(b.expiry_date) < new Date());
        notifs.push({
          id: 'expiring',
          type: 'expiring',
          title: expired.length > 0
            ? `${expired.length} lote${expired.length !== 1 ? 's' : ''} vencido${expired.length !== 1 ? 's' : ''}`
            : `${expiring.length} lote${expiring.length !== 1 ? 's' : ''} por vencer`,
          detail: (expiring[0] as any)?.products?.name || 'Ver detalle en dashboard',
          severity: expired.length > 0 ? 'critical' : 'warning',
          tab: 'dashboard',
        });
      }

      // 3. Cola offline pendiente
      try {
        const { getPendingCount } = await import('../../lib/offlineDB');
        const pending = await getPendingCount();
        if (pending > 0) {
          notifs.push({
            id: 'offline-queue',
            type: 'offline_queue',
            title: `${pending} operación${pending !== 1 ? 'es' : ''} pendiente${pending !== 1 ? 's' : ''} de sincronizar`,
            detail: navigator.onLine ? 'Se sincronizarán automáticamente' : 'Sin conexión — se guardan localmente',
            severity: navigator.onLine ? 'info' : 'warning',
            tab: 'dashboard',
          });
        }
      } catch { /* IndexedDB no disponible */ }

      // 4. Meta de ventas diaria cumplida
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (authData.user) {
          const [{ data: settings }, { data: todaySales }] = await Promise.all([
            supabase.from('user_settings').select('daily_goal').eq('user_id', authData.user.id).maybeSingle(),
            supabase
              .from('sales')
              .select('total_amount, created_at, status')
              .gte('created_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
          ]);
          const goal = Number(settings?.daily_goal || 0);
          const rev = (todaySales || [])
            .filter((s: any) => s.status !== 'cancelled')
            .reduce((acc: number, s: any) => acc + Number(s.total_amount), 0);
          if (goal > 0 && rev >= goal) {
            notifs.push({
              id: 'goal',
              type: 'goal',
              title: '¡Meta diaria cumplida!',
              detail: `$${rev.toLocaleString('es-AR')} de $${goal.toLocaleString('es-AR')} hoy`,
              severity: 'info',
              tab: 'dashboard',
            });
          }
        }
      } catch { /* sin meta definida o sin permiso */ }

      setNotifications(notifs);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 60000);
    window.addEventListener('online', fetchNotifications);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', fetchNotifications);
    };
  }, []);

  return { notifications, loading, refresh: fetchNotifications };
}

export function NotificationsPanel({ onNavigate }: NotificationsPanelProps) {
  const { notifications, loading, refresh } = useNotifications();
  const [open, setOpen] = useState(false);

  const severityStyles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    info: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
  };

  const severityIcon = (s: string) => {
    if (s === 'critical') return <Warning size={18} weight="fill" />;
    if (s === 'warning') return <Clock size={18} weight="fill" />;
    return <CloudSlash size={18} weight="fill" />;
  };

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) refresh(); }}
        className="relative p-2 rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/5"
        title="Notificaciones"
        aria-label="Notificaciones"
        aria-expanded={open}
      >
        <Bell size={19} weight="fill" />
        {notifications.length > 0 && (
          <span className="absolute top-0.5 right-0.5 bg-accent-orange text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border-2 border-[#f4f7f6] dark:border-obsidian-950">
            {notifications.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-1rem)] origin-top-right animate-in fade-in-0 zoom-in-95 duration-200">
            <div className="bg-white dark:bg-[#1F1F1F] rounded-2xl shadow-xl border border-slate-200 dark:border-[#333333] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-[#333333]">
                <h4 className="font-bold text-slate-900 dark:text-white text-sm">Notificaciones</h4>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400">
                  {notifications.length}
                </span>
              </div>

              <div className="max-h-80 overflow-y-auto">
                {loading ? (
                  <div className="p-4 space-y-2">
                    {[0, 1].map((i) => (
                      <div key={i} className="h-14 bg-slate-100 dark:bg-white/5 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-6 text-center">
                    <CheckCircle size={32} weight="fill" className="mx-auto text-emerald-500 mb-2" />
                    <p className="font-bold text-slate-800 dark:text-white text-sm">Todo al día</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">No hay alertas pendientes</p>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => { setOpen(false); onNavigate(n.tab); }}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/5 transition text-left cursor-pointer border-b border-slate-50 dark:border-white/5 last:border-0"
                    >
                      <span className={`p-2 rounded-xl shrink-0 ${severityStyles[n.severity]}`}>
                        {severityIcon(n.severity)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-bold text-slate-800 dark:text-white text-sm">{n.title}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{n.detail}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
