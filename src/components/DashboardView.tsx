import { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Product, Supplier, Profile } from '../types';
import { DollarSign, ShoppingBag, AlertTriangle, TrendingUp, PackageCheck, X, FileText, Award, Receipt, Calendar, Printer, Trash2, Download, Search, Check, Maximize2 } from 'lucide-react';
import { CurrencyDollar, ChartLineUp, Warning, TrendUp, ShoppingBag as ShoppingBagPh, ShoppingCart as ShoppingCartPh, WhatsappLogo } from '@phosphor-icons/react';
import { DatePicker } from './DatePicker';
import { SalesTrendChart, type DayStat } from './SalesTrendChart';
import { PaymentDonut } from './PaymentDonut';
import { TopSellers } from './TopSellers';
import { CategoryProfits } from './CategoryProfits';
import { HourlyDemand } from './HourlyDemand';
import { ModalShell } from './ModalShell';
import { RevenueBreakdown } from './RevenueBreakdown';
import { StockBreakdown } from './StockBreakdown';
// Exportaciones de ventas: xlsx dinámico (exportXlsx)
import { netoFromTotal, ivaFromTotal, round2 } from '../lib/tax';
import { loadMetaSchedule, hoursOf, formatHour } from '../lib/metaSchedule';

const DAY_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const money0 = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export interface SaleWithItems {
  id: string;
  customer_name: string;
  sale_type: string;
  total_amount: number;
  profit_amount: number;
  payment_method?: string;
  dispatch_type?: string;
  status?: string;
  created_at: string;
  profiles?: {
    full_name: string;
  };
  sale_items?: {
    quantity: number;
    unit_price: number;
    subtotal: number;
    product_id: string;
    cost_price_at_sale?: number;
    discount_amount?: number;
    products?: {
      name: string;
      category: string;
      cost_price: number;
    };
  }[];
}

interface BestSeller {
  name: string;
  category: string;
  totalQty: number;
  totalRevenue: number;
}

interface CategoryProfit {
  category: string;
  revenue: number;
  profit: number;
  units: number;
}

interface DashboardViewProps {
  setActiveTab: (tab: string) => void;
  profile?: Profile | null;
  showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function DashboardView({ setActiveTab, profile, showToast }: DashboardViewProps) {
  const [localToast, setLocalToast] = useState<string | null>(null);
  const localTimer = useRef<number | null>(null);
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) { showToast(msg, kind); return; }
    setLocalToast(msg);
    if (localTimer.current) window.clearTimeout(localTimer.current);
    localTimer.current = window.setTimeout(() => setLocalToast(null), 3500);
  };
  const canAnnul = ['admin', 'supervisor', 'vendedor'].includes(profile?.role || '');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'custom'>('today');
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [showCustomPopover, setShowCustomPopover] = useState(false);
  const [stats, setStats] = useState({
    totalProducts: 0,
    lowStockCount: 0,
    salesCount: 0,
    revenue: 0,
    profit: 0,
    prevRevenue: 0,
    avgTicket: 0,
    wholesaleCount: 0,
    retailCount: 0,
    cashTotal: 0,
    transferTotal: 0,
    cardTotal: 0,
    pickupCount: 0,
    deliveryCount: 0,
    salesByUser: {} as Record<string, number>,
  });
  const [lowStockProducts, setLowStockProducts] = useState<Product[]>([]);
  const [salesList, setSalesList] = useState<SaleWithItems[]>([]);
  const [bestSellers, setBestSellers] = useState<BestSeller[]>([]);
  const [hourlySales, setHourlySales] = useState<Record<string, { revenue: number; tickets: number }>>({});
  const [categoryProfits, setCategoryProfits] = useState<CategoryProfit[]>([]);
  const [topCustomers, setTopCustomers] = useState<{ name: string; total: number; count: number }[]>([]);
  const [custRankBy, setCustRankBy] = useState<'total' | 'count'>('total');
  const [dailyGoal, setDailyGoal] = useState<number>(() => {
    const g = localStorage.getItem('dv-daily-goal');
    const n = g ? parseInt(g, 10) : 0;
    return !isNaN(n) && n > 0 ? n : 0;
  });
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [goalHistory, setGoalHistory] = useState<{ label: string; revenue: number; isToday: boolean }[]>([]);
  const dailyGoalRef = useRef(dailyGoal);
  useEffect(() => { dailyGoalRef.current = dailyGoal; }, [dailyGoal]);
  const lastGoalFetchRef = useRef(0);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('user_settings')
          .select('daily_goal')
          .eq('user_id', profile.id)
          .maybeSingle();
        if (data && Number(data.daily_goal) > 0) {
          setDailyGoal(Number(data.daily_goal));
        }
      } catch (e: any) {
        console.warn('[Meta] No se pudo cargar desde Supabase:', e?.message || e);
      }
    })();
  }, [profile?.id]);
  const [quickSearch, setQuickSearch] = useState('');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [expiringProducts, setExpiringProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [onboardingHidden, setOnboardingHidden] = useState(() => {
    try { return localStorage.getItem('dv-onboarding-hidden') === '1'; } catch { return false; }
  });

  // Modals state
  const [activeModal, setActiveModal] = useState<'sales' | 'revenue' | 'profit' | 'lastTicket' | 'bestSellers' | 'categories' | 'hourly' | 'stock' | null>(null);
  const [orders, setOrders] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('dv-orders') || '{}');
    } catch {
      return {};
    }
  });
  const [copiedOrder, setCopiedOrder] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stockSort, setStockSort] = useState<'urgency' | 'cost' | 'name'>('urgency');
  const [stockFilter, setStockFilter] = useState<'all' | 'pending' | 'ordered'>('all');

  const saveDailyGoal = async () => {
    const n = parseInt(goalInput.replace(/\D/g, ''), 10);
    if (isNaN(n) || n <= 0) {
      notify('Ingresá un monto mayor a 0.', 'warning');
      return;
    }
    if (n > 999999999) {
      notify('Monto demasiado alto (máx. 999.999.999).', 'warning');
      return;
    }
    setDailyGoal(n);
    setEditingGoal(false);
    try {
      localStorage.setItem('dv-daily-goal', n.toString());
    } catch { /* noop */ }
    if (!profile?.id) {
      notify(`Meta actualizada: $${n.toLocaleString('es-AR')} (solo en este equipo).`, 'success');
      return;
    }
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: profile.id, daily_goal: n }, { onConflict: 'user_id' });
      if (error) throw error;
      notify(`Meta actualizada: $${n.toLocaleString('es-AR')} por día.`, 'success');
    } catch (e: any) {
      notify(`Guardada en este equipo, pero falló la nube: ${e?.message || e}`, 'warning');
    }
  };

  const suggestQty = (p: Product) => {
    const min = Number(p.min_stock || 5);
    const stock = Number(p.stock_quantity);
    const target = min * 2;
    return Math.max(Math.round((target - stock) * 100) / 100, min > 0 ? 1 : 0);
  };

  const toggleOrdered = (productId: string) => {
    setOrders((prev) => {
      const next = { ...prev };
      if (next[productId]) delete next[productId];
      else next[productId] = new Date().toISOString();
      try {
        localStorage.setItem('dv-orders', JSON.stringify(next));
      } catch { /* noop */ }
      return next;
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('suppliers').select('id, name, phone').eq('is_active', true).order('name');
        setSuppliers((data || []) as Supplier[]);
      } catch { /* sin proveedores: se muestra "Sin proveedor" */ }
    })();
  }, []);

  const supplierName = (p: Product) =>
    suppliers.find((s) => s.id === (p as any).supplier_id)?.name || 'Sin proveedor';

  const groupBySupplier = (items: Product[]) => {
    const groups = new Map<string, Product[]>();
    items.forEach((p) => {
      const key = (p as any).supplier_id || 'sin-proveedor';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    });
    return Array.from(groups.entries()).map(([sid, prods]) => ({
      sid,
      name: suppliers.find((s) => s.id === sid)?.name || 'Sin proveedor',
      phone: suppliers.find((s) => s.id === sid)?.phone?.replace(/\D/g, '') || '',
      prods,
    }));
  };

  const handleCopyOrder = async () => {
    const pending = lowStockProducts.filter((p) => !orders[p.id]);
    if (pending.length === 0) return;
    const lines = ['*ORDEN DE COMPRA SUGERIDA - DIETÉTICA VISHAL*', `Fecha: ${new Date().toLocaleDateString('es-AR')}`, ''];
    let total = 0;
    groupBySupplier(pending).forEach((g) => {
      lines.push('', `*${g.name.toUpperCase()}*`);
      g.prods.forEach((p) => {
        const q = suggestQty(p);
        const cost = q * Number(p.cost_price);
        total += cost;
        lines.push(`- ${p.name}: ${q} ${p.unit_type} (costo est. $${cost.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`);
      });
    });
    lines.push('', `*Costo estimado total: $${total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*`);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedOrder(true);
      setTimeout(() => setCopiedOrder(false), 2500);
    } catch { /* noop */ }
  };

  const handleWhatsAppOrders = () => {
    const pending = lowStockProducts.filter((p) => !orders[p.id]);
    if (pending.length === 0) return;
    groupBySupplier(pending).forEach((g) => {
      const list = g.prods.map((p) => {
        const q = suggestQty(p);
        return `- ${p.name}: ${q} ${p.unit_type} (stock ${p.stock_quantity}, min ${p.min_stock || 5})`;
      }).join('\n');
      const msg = encodeURIComponent(`Hola ${g.name}, necesito reponer:\n${list}`);
      window.open(g.phone ? `https://wa.me/${g.phone}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
    });
  };

  const activeModalRef = useRef(activeModal);
  activeModalRef.current = activeModal;

  useEffect(() => {
    fetchDashboardData();
    const id = setInterval(() => {
      // No refrescar con un modal abierto: evita que la lista cambie bajo el usuario
      if (activeModalRef.current) return;
      fetchDashboardData(true);
    }, 30000);
    // Venta registrada en esta sesión (POS/anulación) → refetch silencioso
    const onSaleEvent = () => {
      const t = Date.now();
      if (t - lastGoalFetchRef.current < 3000) return;
      lastGoalFetchRef.current = t;
      fetchDashboardData(true);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !activeModalRef.current) fetchDashboardData(true);
    };
    window.addEventListener('dv:sale-completed', onSaleEvent);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('dv:sale-completed', onSaleEvent);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // customRange incluido: elegir fechas dispara la recarga del período
  }, [dateRange, customRange]);

  const fetchDashboardData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // 1. Fetch Products and compute Low Stock immediately
      const { data: products, error: prodError } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name');

      let prodList: Product[] = [];
      let lowStock: Product[] = [];

      if (prodError) {
        console.error('Error fetching products:', prodError);
      } else {
        prodList = products || [];
        try {
          const { data: aliases } = await supabase.from('product_barcodes').select('product_id, barcode');
          if (aliases && (aliases as any[]).length > 0) {
            const byPid = new Map<string, string[]>();
            (aliases as any[]).forEach((r) => {
              if (!byPid.has(r.product_id)) byPid.set(r.product_id, []);
              byPid.get(r.product_id)!.push(r.barcode);
            });
            prodList = prodList.map((p: any) => ({ ...p, aliasBarcodes: byPid.get(p.id) || [] }));
          }
        } catch { /* tabla puede no existir todavía */ }
        lowStock = prodList.filter((p) => Number(p.stock_quantity) <= Number(p.min_stock || 5));
        setLowStockProducts(lowStock);
        setAllProducts(prodList);
        // Cachear productos para uso offline
        try {
          const { cacheProducts } = await import('../lib/offlineDB');
          await cacheProducts(prodList);
        } catch (e) {
          console.warn('Cache products failed:', e);
        }

        const in30Days = Date.now() + 30 * 86400000;
        const expiring = prodList.filter((p) => {
          if (!p.expiry_date) return false;
          const t = new Date(p.expiry_date + (p.expiry_date.includes('T') ? '' : 'T00:00:00')).getTime();
          return t >= Date.now() && t <= in30Days;
        });
        setExpiringProducts(expiring);
      }

      // Límites de fechas (local): el fetch solo trae lo necesario.
      // El mínimo son 7 días hacia atrás por el historial de la meta.
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      let startOfPeriod = startOfToday;
      let endOfPeriod = Infinity;
      let prevPeriodStart = startOfToday - 86400000;
      let prevPeriodEnd = startOfToday;

      if (dateRange === 'week') {
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1);
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff);
        startOfPeriod = startOfWeek.getTime();
        prevPeriodStart = startOfPeriod - 7 * 86400000;
        prevPeriodEnd = startOfPeriod;
      } else if (dateRange === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfPeriod = startOfMonth.getTime();
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevPeriodStart = prevMonth.getTime();
        prevPeriodEnd = startOfPeriod;
      } else if (dateRange === 'custom' && customRange.start) {
        const s = new Date(customRange.start + 'T00:00:00').getTime();
        const e = customRange.end ? new Date(customRange.end + 'T00:00:00').getTime() + 86400000 - 1 : Infinity;
        startOfPeriod = s;
        endOfPeriod = e;
        const span = (e === Infinity ? 86400000 : e - s) || 86400000;
        prevPeriodStart = s - span;
        prevPeriodEnd = s;
      }
      const fetchFrom = new Date(Math.min(startOfPeriod, startOfToday - 6 * 86400000));

      // 2. Fetch Sales safely without SQL column constraints that might not exist
      const itemsWithDiscount = `
            quantity,
            unit_price,
            subtotal,
            product_id,
            cost_price_at_sale,
            discount_amount,
            products (name, category, cost_price)`;
      const itemsBase = `
            quantity,
            unit_price,
            subtotal,
            product_id,
            cost_price_at_sale,
            products (name, category, cost_price)`;
      const salesSelect = (itemsCols: string) => `
          *,
          profiles (full_name),
          sale_items (${itemsCols})
        `;
      let allSales: any[] | null = null;
      let salesError: any = null;
      ({ data: allSales, error: salesError } = await supabase
        .from('sales')
        .select(salesSelect(itemsWithDiscount))
        .gte('created_at', fetchFrom.toISOString())
        .order('created_at', { ascending: false }));
      if (salesError && salesError.message?.includes('discount_amount')) {
        // Esquema viejo (falta reportes_mejoras.sql): reintentar sin la columna
        ({ data: allSales, error: salesError } = await supabase
          .from('sales')
          .select(salesSelect(itemsBase))
          .gte('created_at', fetchFrom.toISOString())
          .order('created_at', { ascending: false }));
      }

      if (salesError) {
        console.error('Error fetching sales:', salesError);
        if (!silent) notify(`Error cargando ventas: ${salesError.message || salesError}`, 'error');
        setStats((prev) => ({
          ...prev,
          totalProducts: prodList.length,
          lowStockCount: lowStock.length,
        }));
        return;
      }

      const rawSales = (allSales || []) as SaleWithItems[];
      // Filter out cancelled sales safely in JS
      const validSales = rawSales.filter((s) => s.status !== 'cancelled');

      const periodSales = validSales.filter((s) => {
        const t = new Date(s.created_at).getTime();
        return t >= startOfPeriod && t <= endOfPeriod;
      });

      // Meta diaria: siempre contra las ventas de HOY, no del período
      const todayRevenue = validSales
        .filter((s) => new Date(s.created_at).getTime() >= startOfToday)
        .reduce((acc, s) => acc + Number(s.total_amount), 0);
      setTodayRevenue(todayRevenue);

      // Mini-historial de meta: últimos 7 días (hoy se actualiza en vivo)
      const history: { label: string; revenue: number; isToday: boolean }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dayStart = d.getTime();
        const dayEnd = dayStart + 86400000;
        const rev = validSales
          .filter((s) => {
            const t = new Date(s.created_at).getTime();
            return t >= dayStart && t < dayEnd;
          })
          .reduce((acc, s) => acc + Number(s.total_amount), 0);
        history.push({ label: DAY_LABELS[d.getDay()], revenue: rev, isToday: i === 0 });
      }
      setGoalHistory(history);

      // Celebración "¡Meta cumplida!": una sola vez por día
      try {
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (
          dailyGoalRef.current > 0 &&
          todayRevenue >= dailyGoalRef.current &&
          localStorage.getItem('dv-goal-celebrated') !== todayKey
        ) {
          localStorage.setItem('dv-goal-celebrated', todayKey);
          notify(`🎉 ¡Meta diaria cumplida! Llegaste a $${money0(todayRevenue)}.`, 'success');
        }
      } catch { /* noop */ }

      const prevPeriodSales = validSales.filter((s) => {
        const t = new Date(s.created_at).getTime();
        return t >= prevPeriodStart && t < prevPeriodEnd;
      });

      const revenue = periodSales.reduce((acc, s) => acc + Number(s.total_amount), 0);
      const profit = periodSales.reduce((acc, s) => acc + Number(s.profit_amount), 0);
      const prevRev = prevPeriodSales.reduce((acc, s) => acc + Number(s.total_amount), 0);
      const avg = periodSales.length > 0 ? revenue / periodSales.length : 0;

      const wholesale = periodSales.filter((s) => s.customer_name.toLowerCase().includes('mayor') || Number(s.total_amount) > 15000).length;
      const retail = periodSales.length - wholesale;

      let cashT = 0;
      let transferT = 0;
      let cardT = 0;
      let pickupC = 0;
      let deliveryC = 0;

      periodSales.forEach((s) => {
        const amt = Number(s.total_amount);
        if (s.payment_method === 'transfer') transferT += amt;
        else if (s.payment_method === 'card') cardT += amt;
        else cashT += amt;

        if (s.dispatch_type === 'delivery') deliveryC += 1;
        else pickupC += 1;
      });

      const byUser: Record<string, number> = {};
      periodSales.forEach((s) => {
        const name = s.profiles?.full_name || 'Vendedor';
        byUser[name] = (byUser[name] || 0) + 1;
      });

      const productStats: Record<string, { name: string; category: string; qty: number; rev: number }> = {};
      periodSales.forEach((s) => {
        s.sale_items?.forEach((item) => {
          const pName = item.products?.name || 'Producto';
          const pCat = item.products?.category || 'General';
          if (!productStats[pName]) {
            productStats[pName] = { name: pName, category: pCat, qty: 0, rev: 0 };
          }
          productStats[pName].qty += Number(item.quantity);
          productStats[pName].rev += Number(item.subtotal) - Number(item.discount_amount || 0);
        });
      });

      const best = Object.values(productStats)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10)
        .map((p) => ({ name: p.name, category: p.category, totalQty: p.qty, totalRevenue: p.rev }));

      const hourly: Record<string, { revenue: number; tickets: number }> = {};
      periodSales.forEach((s) => {
        const hour = new Date(s.created_at).getHours();
        const hourKey = `${hour}:00 - ${hour + 1}:00`;
        if (!hourly[hourKey]) hourly[hourKey] = { revenue: 0, tickets: 0 };
        hourly[hourKey].revenue += Number(s.total_amount);
        hourly[hourKey].tickets += 1;
      });

      const catStats: Record<string, { rev: number; prof: number; qty: number }> = {};
      periodSales.forEach((s) => {
        s.sale_items?.forEach((item) => {
          const cat = item.products?.category || 'General';
          if (!catStats[cat]) {
            catStats[cat] = { rev: 0, prof: 0, qty: 0 };
          }
          const sub = Number(item.subtotal) - Number(item.discount_amount || 0);
          const cost = Number(item.cost_price_at_sale ?? item.products?.cost_price ?? 0) * Number(item.quantity);
          const prof = sub - cost;
          catStats[cat].rev += sub;
          catStats[cat].prof += prof;
          catStats[cat].qty += Number(item.quantity);
        });
      });

      const catProfits: CategoryProfit[] = Object.entries(catStats).map(([cat, val]) => ({
        category: cat,
        revenue: val.rev,
        profit: val.prof,
        units: val.qty,
      }));

      setStats({
        totalProducts: prodList.length,
        lowStockCount: lowStock.length,
        salesCount: periodSales.length,
        revenue,
        profit,
        prevRevenue: prevRev,
        avgTicket: avg,
        wholesaleCount: wholesale,
        retailCount: retail,
        cashTotal: cashT,
        transferTotal: transferT,
        cardTotal: cardT,
        pickupCount: pickupC,
        deliveryCount: deliveryC,
        salesByUser: byUser,
      });

      const customerMap: Record<string, { total: number; count: number }> = {};
      periodSales.forEach((s) => {
        const c = s.customer_name || 'Sin nombre';
        if (!customerMap[c]) customerMap[c] = { total: 0, count: 0 };
        customerMap[c].total += Number(s.total_amount);
        customerMap[c].count += 1;
      });
      const topCust = Object.entries(customerMap)
        .map(([name, data]) => ({ name, total: data.total, count: data.count }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
      setTopCustomers(topCust);

      setSalesList(periodSales);
      setBestSellers(best);
      setHourlySales(hourly);
      setCategoryProfits(catProfits);
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRef = useRef(fetchDashboardData);
  useEffect(() => { fetchRef.current = fetchDashboardData; });

  // Tiempo real: ventas hechas desde OTRO dispositivo (celular) refrescan el panel
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel('dv-dashboard-sales')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
          const t = Date.now();
          if (t - lastGoalFetchRef.current < 3000) return;
          lastGoalFetchRef.current = t;
          fetchRef.current(true);
        })
        .subscribe();
    } catch { /* realtime no disponible: siguen el intervalo de 30s y visibility */ }
    return () => {
      try {
        if (channel) void supabase.removeChannel(channel);
      } catch { /* noop */ }
    };
  }, []);

  const handleCancelSale = async (sale: SaleWithItems) => {
    if (!confirm(`¿Estás seguro de anular la venta #${sale.id.slice(0, 8)}? Se devolverá el stock a los productos.`)) {
      return;
    }

    try {
      // V3: anulación transaccional (idempotente). Fallback a flujo directo.
      const { error: rpcError } = await supabase.rpc('cancel_sale', { p_sale_id: sale.id });
      if (rpcError) throw rpcError;
      console.log('[Sale] checkout-success (cancel)', sale.id);
      alert('Venta anulada y stock restituido correctamente.');
      fetchDashboardData();
      return;
    } catch (rpcErr: any) {
      console.warn('cancel_sale RPC no disponible, uso flujo directo:', rpcErr?.message || rpcErr);
    }

    try {
      // 1. Mark sale as cancelled
      const { error: updateError } = await supabase
        .from('sales')
        .update({ status: 'cancelled' })
        .eq('id', sale.id);

      if (updateError) throw updateError;

      // 2. Restore stock for each item
      if (sale.sale_items) {
        for (const item of sale.sale_items) {
          const { data: prodData } = await supabase
            .from('products')
            .select('stock_quantity')
            .eq('id', item.product_id)
            .single();

          if (prodData) {
            const restoredStock = Number(prodData.stock_quantity) + Number(item.quantity);
            await supabase
              .from('products')
              .update({ stock_quantity: restoredStock })
              .eq('id', item.product_id);
          }

          await supabase.from('stock_movements').insert({
            product_id: item.product_id,
            type: 'adjustment',
            quantity: item.quantity,
            notes: `Anulación Venta #${sale.id.slice(0, 8)}`,
          });
        }
      }

      alert('Venta anulada y stock restituido correctamente.');
      fetchDashboardData();
    } catch (err: any) {
      alert('Error al anular venta: ' + err.message);
    }
  };

  const handlePrintReport = () => {
    window.print();
  };

  const [exportOpen, setExportOpen] = useState(false);

  const handleExportSales = async () => {
    const { exportVentasXlsx, barsByDay } = await import('../lib/exportXlsx');
    const periodo = dateRange === 'today' ? 'Hoy' : dateRange === 'week' ? 'Semana' : dateRange === 'custom' ? (customRange.start ? `${customRange.start} a ${customRange.end || 'hoy'}` : 'Custom') : 'Mes';
    await exportVentasXlsx(
      `panel-ventas-${dateRange}`,
      periodo,
      salesList.map((s) => ({
        ticket: (s as any).receipt_number ? `N° ${(s as any).receipt_number}` : `#${s.id.slice(0, 8).toUpperCase()}`,
        fecha: new Date(s.created_at).toLocaleString('es-AR'),
        fechaISO: s.created_at,
        cliente: s.customer_name,
        vendedor: s.profiles?.full_name || 'Vendedor',
        pago: s.payment_method === 'transfer' ? 'Transferencia' : s.payment_method === 'card' ? 'Tarjeta' : s.payment_method === 'mercadopago' ? 'Mercado Pago' : 'Efectivo',
        despacho: s.dispatch_type === 'delivery' ? 'Envío' : 'Retira',
        tipo: s.sale_type === 'afip' ? 'ARCA' : 'Interno',
        cantItems: (s.sale_items || []).reduce((a: number, it: any) => a + Number(it.quantity), 0),
        total: Number(s.total_amount),
        ganancia: Number(s.profit_amount),
        anulada: s.status === 'cancelled',
      })),
      { revenue: stats.revenue, profit: stats.profit },
      { title: `Ventas por día — ${periodo}`, bars: barsByDay(salesList) }
    );
    setExportOpen(false);
  };

  const handleExportContador = async () => {
    const { exportContadorXlsx, barsByPayment } = await import('../lib/exportXlsx');
    const periodo = dateRange === 'today' ? 'Hoy' : dateRange === 'week' ? 'Semana' : dateRange === 'custom' ? (customRange.start ? `${customRange.start} a ${customRange.end || 'hoy'}` : 'Custom') : 'Mes';
    const rows = salesList.map((s) => {
      const total = Number(s.total_amount);
      return {
        ticket: (s as any).receipt_number ? `N° ${(s as any).receipt_number}` : `#${s.id.slice(0, 8).toUpperCase()}`,
        fecha: new Date(s.created_at).toLocaleString('es-AR'),
        cliente: s.customer_name,
        doc: (s as any).customer_doc || '',
        vendedor: s.profiles?.full_name || 'Vendedor',
        pago: s.payment_method === 'transfer' ? 'Transferencia' : s.payment_method === 'card' ? 'Tarjeta' : s.payment_method === 'mercadopago' ? 'Mercado Pago' : 'Efectivo',
        tipo: s.sale_type === 'afip' ? 'ARCA' : 'Interno',
        ivaCond: (s as any).customer_iva_cond || (s.sale_type === 'afip' ? 'CF' : ''),
        neto: (s as any).net_amount ?? round2(netoFromTotal(total)),
        iva: (s as any).iva_amount ?? round2(ivaFromTotal(total)),
        total,
        anulada: s.status === 'cancelled',
      };
    });
    await exportContadorXlsx(
      `contador-panel-${dateRange}`,
      periodo,
      rows,
      { title: 'Facturación por medio de pago', bars: barsByPayment(rows) }
    );
    setExportOpen(false);
  };

  const handleDownloadPdf = async () => {
    const periodo = dateRange === 'today' ? 'Hoy' : dateRange === 'week' ? 'Semana' : dateRange === 'custom' ? (customRange.start ? `${customRange.start} a ${customRange.end || 'hoy'}` : 'Custom') : 'Mes';
    const { downloadDashboardPdf } = await import('../lib/reportPdf');
    downloadDashboardPdf({
      periodo,
      salesCount: stats.salesCount,
      revenue: stats.revenue,
      profit: stats.profit,
      avgTicket: stats.avgTicket,
      cashTotal: stats.cashTotal,
      transferTotal: stats.transferTotal,
      cardTotal: stats.cardTotal,
      bestSellers,
      categoryProfits,
      sales: salesList,
      lowStock: lowStockProducts.map((p) => ({
        name: p.name,
        stock_quantity: Number(p.stock_quantity),
        min_stock: Number(p.min_stock || 5),
        suggested: suggestQty(p),
        cost: suggestQty(p) * Number(p.cost_price),
      })),
    });
    setExportOpen(false);
  };

  const revenueDiffPercent = stats.prevRevenue > 0
    ? (((stats.revenue - stats.prevRevenue) / stats.prevRevenue) * 100).toFixed(1)
    : stats.revenue > 0 ? '100' : '0';

  // Stats diarias para gráfico de tendencia (ANTES del early return: Rules of Hooks)
  const dailyStats: DayStat[] = useMemo(() => {
    const byDay = new Map<string, { time: number; revenue: number; profit: number }[]>();
    salesList.forEach((s) => {
      const t = new Date(s.created_at).getTime();
      const key = new Date(s.created_at).toLocaleDateString('es-AR');
      const arr = byDay.get(key) || [];
      arr.push({ time: t, revenue: Number(s.total_amount), profit: Number(s.profit_amount) });
      byDay.set(key, arr);
    });
    return Array.from(byDay.entries())
      .map(([date, sales]) => {
        const revenue = sales.reduce((a, s) => a + s.revenue, 0);
        const profit = sales.reduce((a, s) => a + s.profit, 0);
        const times = sales.map((s) => s.time);
        return {
          date,
          label: new Date(Math.min(...times)).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
          revenue,
          tickets: sales.length,
          profit,
          avgTicket: sales.length > 0 ? revenue / sales.length : 0,
          _t: Math.min(...times),
        } as DayStat & { _t: number };
      })
      .sort((a: any, b: any) => a._t - b._t)
      .map(({ _t, ...d }: any) => d);
  }, [salesList]);

  // Intradía por hora (cuando el rango es hoy, el gráfico diario sería 1 punto)
  const intradayStats: DayStat[] = useMemo(() => {
    const byHour = new Map<number, { revenue: number; profit: number; count: number }>();
    salesList.forEach((s) => {
      const h = new Date(s.created_at).getHours();
      const cur = byHour.get(h) || { revenue: 0, profit: 0, count: 0 };
      cur.revenue += Number(s.total_amount);
      cur.profit += Number(s.profit_amount);
      cur.count += 1;
      byHour.set(h, cur);
    });
    return Array.from(byHour.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([h, v]) => ({
        date: `${h}:00`,
        label: `${h}:00`,
        revenue: v.revenue,
        tickets: v.count,
        profit: v.profit,
        avgTicket: v.count > 0 ? v.revenue / v.count : 0,
      }));
  }, [salesList]);

  if (loading) {
    return (
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        <div className="flex justify-between items-center">
          <div className="h-8 w-56 bg-slate-200 dark:bg-[#2A2A2A] rounded-lg animate-pulse" />
          <div className="h-10 w-72 bg-slate-200 dark:bg-[#2A2A2A] rounded-xl animate-pulse" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl p-5 bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333] space-y-3">
              <div className="h-4 w-28 bg-slate-200 dark:bg-[#2A2A2A] rounded animate-pulse" />
              <div className="h-8 w-32 bg-slate-200 dark:bg-[#2A2A2A] rounded animate-pulse" />
              <div className="h-4 w-40 bg-slate-200 dark:bg-[#2A2A2A] rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-5 bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333]">
          <div className="h-5 w-48 bg-slate-200 dark:bg-[#2A2A2A] rounded animate-pulse mb-4" />
          <div className="h-28 bg-slate-200 dark:bg-[#2A2A2A] rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl p-6 bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333] space-y-3">
              <div className="h-4 w-40 bg-slate-200 dark:bg-[#2A2A2A] rounded animate-pulse" />
              <div className="h-5 w-52 bg-slate-200 dark:bg-[#2A2A2A] rounded animate-pulse" />
              <div className="h-5 w-44 bg-slate-200 dark:bg-[#2A2A2A] rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const latestSale = salesList.length > 0 ? salesList[0] : null;

  return (
    <div id="dashboard-print-area" className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {localToast && !showToast && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-white border border-slate-200 text-slate-800 px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold dark:bg-obsidian-800 dark:border-obsidian-600 dark:text-white animate-row">
          {localToast}
        </div>
      )}
      {!canAnnul && profile && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-3 flex items-start gap-3">
          <ShoppingBag size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            <b>Mostrando solo tus ventas.</b> Tu cuenta de vendedor ve únicamente las ventas que registraste.
            Las ventas hechas por el administrador u otros vendedores no aparecen en tu resumen.
          </p>
        </div>
      )}
      {!loading && salesList.length === 0 && (
        <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 rounded-xl p-4 flex items-start gap-3">
          <Calendar size={20} className="text-sky-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-sky-900 dark:text-sky-300">Sin ventas en el período seleccionado</p>
            <p className="text-xs text-sky-700 dark:text-sky-400 mt-0.5">
              {dateRange === 'custom'
                ? `Rango elegido: ${customRange.start || '—'} → ${customRange.end || 'hoy'} — no hay ventas registradas en esas fechas.`
                : 'No hay ventas registradas en este período.'}{' '}
              {canAnnul
                ? 'Probá con Hoy, Semana o Mes, o elegí otro rango de fechas.'
                : 'Si esperabas ver ventas de otros vendedores: con tu cuenta solo se muestran las tuyas.'}
            </p>
          </div>
        </div>
      )}
      {!alertDismissed && lowStockProducts.length > 0 && (
        <div className="bg-accent-orange/10 border border-accent-orange/30 rounded-xl p-4 flex items-start sm:items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-orange" />
          <div className="flex items-center gap-3">
            <div className="bg-accent-orange/20 p-2 rounded-lg shrink-0">
              <AlertTriangle size={20} className="text-accent-orange" />
            </div>
            <div>
              <h4 className="text-accent-orange font-bold text-sm">Alerta de Stock Crítico</h4>
              <p className="text-zinc-400 text-xs mt-0.5">
                {lowStockProducts.length} productos requieren reposición ({lowStockProducts.slice(0, 2).map((p) => `"${p.name}"`).join(', ')}{lowStockProducts.length > 2 ? '…' : ''}).
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('products')}
              className="bg-accent-orange hover:bg-orange-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Ver Stock
            </button>
            <button onClick={() => setAlertDismissed(true)} className="text-zinc-400 hover:text-white p-1.5 rounded-lg cursor-pointer" title="Cerrar">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#0f172a] dark:text-white">Resumen Operativo</h1>
          <p className="text-sm font-medium text-[#64748b] dark:text-[#9E9E9E]">Control en tiempo real de ventas y stock</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 print-hide">
           <div className="rounded-xl p-1 flex text-sm font-medium border bg-white shadow-sm border-[#e2e8f0] dark:bg-[#1F1F1F] dark:border-[#333333]">
             <button
               onClick={() => setDateRange('today')}
               className={`px-4 py-2 rounded-lg transition-all ${dateRange === 'today' ? 'bg-sky-600 text-white shadow-sm' : 'text-[#64748b] hover:bg-slate-50 hover:text-[#0f172a] dark:text-[#9E9E9E] dark:hover:text-white dark:hover:bg-white/5'}`}
             >
               Hoy
             </button>
             <button
               onClick={() => setDateRange('week')}
               className={`px-4 py-2 rounded-lg transition-all ${dateRange === 'week' ? 'bg-sky-600 text-white shadow-sm' : 'text-[#64748b] hover:bg-slate-50 hover:text-[#0f172a] dark:text-[#9E9E9E] dark:hover:text-white dark:hover:bg-white/5'}`}
             >
               Semana
             </button>
             <button
               onClick={() => setDateRange('month')}
               className={`px-4 py-2 rounded-lg transition-all ${dateRange === 'month' ? 'bg-sky-600 text-white shadow-sm' : 'text-[#64748b] hover:bg-slate-50 hover:text-[#0f172a] dark:text-[#9E9E9E] dark:hover:text-white dark:hover:bg-white/5'}`}
             >
               Mes
             </button>
<button
                onClick={() => { setDateRange('custom'); setShowCustomPopover(true); }}
                className={`px-4 py-2 rounded-lg transition-all ${dateRange === 'custom' ? 'bg-sky-600 text-white shadow-sm' : 'text-[#64748b] hover:bg-slate-50 hover:text-[#0f172a] dark:text-[#9E9E9E] dark:hover:text-white dark:hover:bg-white/5'}`}
              >
                Personalizado
              </button>
            </div>

<div className="relative">
              {dateRange === 'custom' && showCustomPopover && (
                <div className="absolute right-0 top-full mt-2 z-50 origin-top-right animate-in fade-in-0 zoom-in-95 duration-200"
                     role="dialog" aria-label="Rango de fechas personalizado">
                  <DatePicker
                    startDate={customRange.start}
                    endDate={customRange.end}
                    onChange={(start, end) => setCustomRange({ start, end })}
                    onClose={() => { setShowCustomPopover(false); if (!customRange.start) setDateRange('today'); }}
                    maxDate={new Date()}
                  />
                </div>
              )}
            </div>

            <div className="relative">
              <button
                onClick={() => setExportOpen((o) => !o)}
                title="Exportar reporte del período"
                className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl font-bold shadow-card transition-all flex items-center gap-2 card-hover cursor-pointer"
              >
                <Download size={18} />
                <span>Exportar</span>
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 w-64 origin-top-right bg-white dark:bg-[#1F1F1F] rounded-2xl shadow-xl border border-slate-200 dark:border-[#333333] p-2 space-y-1">
                    <button
                      onClick={handleExportSales}
                      title="Exportar ventas del período a Excel/CSV"
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                    >
                      <Download size={16} className="text-slate-500 shrink-0" />
                      <span>
                        <span className="block text-xs font-bold text-slate-800 dark:text-white">Ventas (CSV)</span>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400">Con ganancia e ítems</span>
                      </span>
                    </button>
                    <button
                      onClick={handleExportContador}
                      title="Versión para contador: sin ganancia, con resumen y columnas fiscales"
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                    >
                      <FileText size={16} className="text-blue-600 shrink-0" />
                      <span>
                        <span className="block text-xs font-bold text-slate-800 dark:text-white">Contador (CSV)</span>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400">Fiscal, sin ganancia</span>
                      </span>
                    </button>
                    <button
                      onClick={handleDownloadPdf}
                      title="Descargar reporte completo en PDF"
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left print:hidden"
                    >
                      <Printer size={16} className="text-purple-600 shrink-0" />
                      <span>
                        <span className="block text-xs font-bold text-slate-800 dark:text-white">Reporte (PDF)</span>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400">Descarga directa</span>
                      </span>
                    </button>
                    <button
                      onClick={() => { setExportOpen(false); window.print(); }}
                      title="Imprimir vista actual del dashboard"
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left print:hidden"
                    >
                      <Printer size={16} className="text-slate-500 shrink-0" />
                      <span>
                        <span className="block text-xs font-bold text-slate-800 dark:text-white">Imprimir vista</span>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400">Diálogo del navegador</span>
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          <button
            onClick={() => setActiveTab('pos')}
            className="bg-[#10b981] hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-card transition-all flex items-center gap-2 card-hover cursor-pointer print:hidden"
            title="Ir a Caja"
          >
            <ShoppingCartPh size={18} weight="bold" />
<span>Caja</span>
           </button>
         </div>
       </div>

      {/* Acciones Rápidas — glass grid (Campify Dark x Premium SaaS) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 print-hide">
        <button
          onClick={() => setActiveTab('pos')}
          className="glass-button h-24 rounded-xl flex flex-col items-center justify-center gap-2 group cursor-pointer"
        >
          <div className="bg-accent-emerald/10 p-2.5 rounded-lg group-hover:bg-accent-emerald group-hover:scale-110 transition-all duration-300">
            <ShoppingCartPh size={22} weight="fill" className="text-accent-emerald group-hover:text-white" />
          </div>
          <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 dark:text-zinc-300 dark:group-hover:text-white">Venta Rápida</span>
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className="glass-button h-24 rounded-xl flex flex-col items-center justify-center gap-2 group cursor-pointer"
        >
          <div className="bg-brand-500/10 p-2.5 rounded-lg group-hover:bg-brand-500 group-hover:scale-110 transition-all duration-300">
            <PackageCheck size={22} className="text-brand-400 group-hover:text-white" />
          </div>
          <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 dark:text-zinc-300 dark:group-hover:text-white">Productos</span>
        </button>
        <button
          onClick={() => setActiveModal('stock')}
          className="glass-button h-24 rounded-xl flex flex-col items-center justify-center gap-2 group cursor-pointer"
        >
          <div className="bg-accent-orange/10 p-2.5 rounded-lg group-hover:bg-accent-orange group-hover:scale-110 transition-all duration-300">
            <AlertTriangle size={22} className="text-accent-orange group-hover:text-white" />
          </div>
          <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 dark:text-zinc-300 dark:group-hover:text-white">Stock Crítico</span>
        </button>
        <button
          onClick={() => setActiveModal('sales')}
          className="glass-button h-24 rounded-xl flex flex-col items-center justify-center gap-2 group cursor-pointer"
        >
          <div className="bg-sky-500/10 p-2.5 rounded-lg group-hover:bg-sky-500 group-hover:scale-110 transition-all duration-300">
            <DollarSign size={22} className="text-sky-400 group-hover:text-white" />
          </div>
          <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 dark:text-zinc-300 dark:group-hover:text-white">Ventas</span>
        </button>
        <button
          onClick={() => setActiveModal('profit')}
          className="glass-button h-24 rounded-xl flex flex-col items-center justify-center gap-2 group cursor-pointer"
        >
          <div className="bg-teal-500/10 p-2.5 rounded-lg group-hover:bg-teal-500 group-hover:scale-110 transition-all duration-300">
            <TrendUp size={22} className="text-teal-400 group-hover:text-white" />
          </div>
          <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 dark:text-zinc-300 dark:group-hover:text-white">Rentabilidad</span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className="glass-button h-24 rounded-xl flex flex-col items-center justify-center gap-2 group cursor-pointer"
        >
          <div className="bg-purple-500/10 p-2.5 rounded-lg group-hover:bg-purple-500 group-hover:scale-110 transition-all duration-300">
            <Receipt size={22} className="text-purple-400 group-hover:text-white" />
          </div>
          <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 dark:text-zinc-300 dark:group-hover:text-white">Pedidos</span>
        </button>
      </div>

      {/* Buscador Rápido */}
      <div className="relative print-hide">
        <div className="flex items-center gap-2 bg-white rounded-2xl shadow-sm border border-slate-200/80 px-4 py-2.5 dark:bg-[#1F1F1F] dark:border-[#333333]">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={quickSearch}
            onChange={(e) => setQuickSearch(e.target.value)}
            placeholder="Buscar producto por nombre o código de barras…"
            className="flex-1 bg-transparent text-sm font-medium text-slate-800 dark:text-white focus:outline-none placeholder:text-slate-400"
          />
          {quickSearch && (
            <button onClick={() => setQuickSearch('')} className="text-slate-400 hover:text-slate-600 cursor-pointer">
              <X size={16} />
            </button>
          )}
        </div>
        {quickSearch.trim().length >= 2 && (() => {
          const q = quickSearch.trim().toLowerCase();
          const results = allProducts
            .filter((p: any) => p.name.toLowerCase().includes(q) || String(p.barcode || '').toLowerCase().includes(q) || (Array.isArray(p.aliasBarcodes) && p.aliasBarcodes.some((a: string) => a.toLowerCase().includes(q))))
            .slice(0, 6);
          if (results.length === 0) {
            return (
              <div className="absolute z-20 mt-2 w-full bg-white dark:bg-[#1F1F1F] rounded-2xl shadow-xl border border-slate-200 dark:border-[#333333] p-4 text-sm text-slate-400">
                Sin resultados para "{quickSearch}"
              </div>
            );
          }
          return (
            <div className="absolute z-20 mt-2 w-full bg-white dark:bg-[#1F1F1F] rounded-2xl shadow-xl border border-slate-200 dark:border-[#333333] p-2 space-y-1">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    try { localStorage.setItem('dv-product-search', p.name); } catch { /* noop */ }
                    setActiveTab('products');
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{p.name}</p>
                    <p className="text-[10px] text-slate-400 font-semibold">{p.category || 'General'}</p>
                  </div>
                  <div className={`text-xs font-extrabold tnum shrink-0 px-2 py-0.5 rounded-lg ${Number(p.stock_quantity) <= Number(p.min_stock || 5) ? 'text-red-600 bg-red-50 dark:bg-red-500/10' : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10'}`}>
                    {p.stock_quantity} {p.unit_type}
                  </div>
                </button>
              ))}
              <p className="text-[10px] text-slate-400 text-center pt-1 pb-0.5 font-medium">Click para ir a Productos</p>
            </div>
          );
        })()}
      </div>

      {/* Meta de Ventas Diaria */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 dark:bg-[#1F1F1F] dark:border-[#333333]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TrendUp className="text-[#FF6B00]" size={18} weight="bold" />
            Meta de Ventas Diaria
          </h3>
          {!editingGoal ? (
            <button
              onClick={() => { setEditingGoal(true); setGoalInput(dailyGoal ? dailyGoal.toLocaleString('es-AR') : ''); }}
              className="text-xs font-bold text-sky-600 hover:text-sky-700 cursor-pointer px-3 py-1.5 bg-sky-50 rounded-lg dark:bg-sky-500/10 dark:text-sky-400"
            >
              {dailyGoal > 0 ? `Meta: $${dailyGoal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Definir meta'} ⚙
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={goalInput}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
                  setGoalInput(digits ? Number(digits).toLocaleString('es-AR') : '');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') saveDailyGoal(); }}
                autoFocus
                className="w-40 px-3 py-1.5 border-2 border-sky-500 rounded-lg text-sm font-bold text-slate-800 focus:outline-none dark:bg-[#161616] dark:text-white dark:border-sky-600"
                placeholder="Monto diario"
              />
              <button onClick={saveDailyGoal} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold cursor-pointer">OK</button>
              <button onClick={() => setEditingGoal(false)} className="px-3 py-1.5 bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white rounded-lg text-xs font-bold cursor-pointer">X</button>
            </div>
          )}
        </div>
        {dailyGoal > 0 && (() => {
          const pct = Math.min((todayRevenue / dailyGoal) * 100, 100);
          const remaining = Math.max(dailyGoal - todayRevenue, 0);
          const nowD = new Date();
          const nowH = nowD.getHours() + nowD.getMinutes() / 60;
          const sched = loadMetaSchedule();
          const openH = hoursOf(sched.open);
          const closeH = hoursOf(sched.close);
          const span = Number.isNaN(openH) || Number.isNaN(closeH) || closeH <= openH ? 13 : closeH - openH;
          const elapsed = Math.min(Math.max((nowH - openH) / span, 0), 1);
          const projected = elapsed > 0 ? todayRevenue / elapsed : 0;
          const hoursLeft = Math.max(closeH - nowH, 0);
          const hoursTxt = `${hoursLeft % 1 === 0 ? hoursLeft : hoursLeft.toFixed(1).replace('.', ',')} h`;
          let pace = '';
          let paceCls = '';
          if (pct >= 100) {
            pace = '🎉 ¡Meta cumplida!';
            paceCls = 'text-[#00C853]';
          } else if (nowH >= closeH) {
            pace = `Día cerrado: alcanzaste el ${pct.toFixed(0)}% de la meta`;
            paceCls = 'text-slate-500 dark:text-slate-400';
          } else if (nowH < openH) {
            pace = `Abrimos a las ${Number.isNaN(openH) ? '8:00' : formatHour(openH)} · faltan $${money0(remaining)}`;
            paceCls = 'text-slate-500 dark:text-slate-400';
          } else if (projected >= dailyGoal) {
            pace = `Vas bien · cierre proyectado $${money0(projected)} (quedan ${hoursTxt})`;
            paceCls = 'text-[#00C853]';
          } else {
            pace = `Vas atrasado · al ritmo actual cerrás en $${money0(projected)} (quedan ${hoursTxt})`;
            paceCls = 'text-[#FF6B00]';
          }
          const metCount = goalHistory.filter((h) => h.revenue >= dailyGoal).length;
          return (
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                <span className="tnum">${todayRevenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="font-normal">de hoy</span></span>
                <span className={`font-extrabold tnum ${pct >= 100 ? 'text-[#00C853]' : pct >= 50 ? 'text-[#FF6B00]' : 'text-slate-600 dark:text-slate-300'}`}>{pct.toFixed(0)}%</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden dark:bg-white/10">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100 ? 'linear-gradient(90deg,#00C853,#059669)' : 'linear-gradient(90deg,#FF6B00,#f59e0b)',
                  }}
                />
              </div>
              <p className={`text-xs mt-1.5 font-bold ${paceCls}`}>{pace}</p>
              {pct < 100 && (
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                  {`Faltan $${remaining.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} para alcanzar la meta`}
                </p>
              )}
              {goalHistory.length === 7 && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                  <div className="flex items-center justify-between text-[10px] font-extrabold text-slate-400 dark:text-slate-500 tracking-wider mb-1.5">
                    <span>ÚLTIMOS 7 DÍAS</span>
                    <span className="tnum">{metCount}/7 cumplidos</span>
                  </div>
                  <div className="flex items-end gap-1.5 h-9">
                    {goalHistory.map((h, i) => {
                      const hp = Math.min(h.revenue / dailyGoal, 1);
                      const met = h.revenue >= dailyGoal;
                      return (
                        <div
                          key={i}
                          title={`${h.label} · $${money0(h.revenue)}`}
                          className={`flex-1 rounded-t transition-all duration-500 ${!met && !h.isToday ? 'bg-slate-200 dark:bg-white/15' : ''}`}
                          style={{
                            height: `${Math.max(Math.round(hp * 36), 4)}px`,
                            background: met ? 'linear-gradient(180deg,#00C853,#059669)' : h.isToday ? 'linear-gradient(180deg,#FF6B00,#f59e0b)' : undefined,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    {goalHistory.map((h, i) => (
                      <span key={i} className={`flex-1 text-center text-[9px] font-bold ${h.isToday ? 'text-[#FF6B00]' : 'text-slate-400 dark:text-slate-600'}`}>{h.label}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {/* Ventas - claro/oscuro global */}
        <div
          onClick={() => setActiveModal('sales')}
          className="rounded-2xl p-5 border flex flex-col justify-between card-hover transition-colors duration-200 cursor-pointer group relative overflow-hidden bg-white shadow-card border-[#e2e8f0] hover:border-emerald-500 dark:bg-obsidian-800/60 dark:border-obsidian-600/60 dark:backdrop-blur-xl dark:hover:border-brand-500/50"
        >
          <div className="absolute -right-10 -top-10 w-32 h-32 bg-brand-500/10 blur-3xl rounded-full pointer-events-none animate-blob" />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center shrink-0 transition-colors group-hover:bg-brand-500/20">
                <ShoppingBagPh size={18} weight="fill" className="text-brand-400" />
              </div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ventas (Tickets)</h3>
            </div>
          </div>
          <span className="text-2xl sm:text-3xl font-bold block mb-1 tnum text-[#0f172a] dark:text-white">{stats.salesCount}</span>
          <span className={`text-xs flex items-center gap-1 font-medium px-2 py-0.5 rounded w-max ${Number(revenueDiffPercent) >= 0 ? 'text-[#10b981] bg-[#d1fae5] dark:text-[#00C853] dark:bg-[#00C853]/10' : 'text-red-500 bg-red-100'}`}>
            <TrendUp size={13} weight="bold" /> {revenueDiffPercent}%                <span className="font-normal ml-1 text-slate-400 dark:text-slate-500">vs período ant.</span>
          </span>
          <div className="space-y-2 text-sm pt-3 mt-3 border-t border-slate-100 dark:border-[#333333]">
            <div className="flex justify-between items-center">
              <span className="font-medium text-[#64748b] dark:text-[#9E9E9E]">Ticket Promedio:</span>
              <span className="font-bold tnum text-[#0f172a] dark:text-white">${stats.avgTicket.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            {latestSale && (
              <button
                onClick={(e) => { e.stopPropagation(); setActiveModal('lastTicket'); }}
                className="text-xs font-bold hover:underline cursor-pointer text-left text-[#0ea5e9] dark:text-[#FF6B00]"
              >
                Ver Último Ticket →
              </button>
            )}
          </div>
        </div>

        {/* Recaudación */}
        <div
          onClick={() => setActiveModal('revenue')}
          className="rounded-2xl p-5 border flex flex-col justify-between card-hover transition-colors duration-200 cursor-pointer group relative overflow-hidden bg-white shadow-card border-[#e2e8f0] hover:border-emerald-500 dark:bg-obsidian-800/60 dark:border-obsidian-600/60 dark:backdrop-blur-xl dark:hover:border-brand-500/50"
        >
          <div className="absolute -right-10 -top-10 w-32 h-32 bg-accent-emerald/10 blur-3xl rounded-full pointer-events-none animate-blob" style={{ animationDelay: '1s' }} />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-emerald/10 flex items-center justify-center shrink-0 transition-colors group-hover:bg-accent-emerald/20">
                <CurrencyDollar size={18} weight="fill" className="text-accent-emerald" />
              </div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ingresos Totales</h3>
            </div>
          </div>
          <span className="text-2xl sm:text-3xl font-bold block mb-1 tnum text-[#0f172a] dark:text-white">${stats.revenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <div className="space-y-2 text-sm pt-3 mt-1 border-t border-slate-100 dark:border-[#333333]">
            <div className="flex justify-between items-center">
               <span className="font-medium text-[#64748b] dark:text-slate-400">Efectivo</span>
              <span className="font-bold tnum text-[#0f172a] dark:text-white">${stats.cashTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-medium text-[#64748b] dark:text-[#9E9E9E]">Digital</span>
              <span className="font-bold tnum text-[#0f172a] dark:text-white">${(stats.transferTotal + stats.cardTotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Ganancia */}
        <div
          onClick={() => setActiveModal('profit')}
          className="rounded-2xl p-5 border flex flex-col justify-between card-hover transition-colors duration-200 cursor-pointer group relative overflow-hidden bg-white shadow-card border-[#e2e8f0] hover:border-emerald-500 dark:bg-obsidian-800/60 dark:border-obsidian-600/60 dark:backdrop-blur-xl dark:hover:border-brand-500/50"
        >
          <div className="absolute -right-10 -top-10 w-32 h-32 bg-teal-500/10 blur-3xl rounded-full pointer-events-none animate-blob" style={{ animationDelay: '2s' }} />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center shrink-0 transition-colors group-hover:bg-teal-500/20">
                <ChartLineUp size={18} weight="fill" className="text-teal-400" />
              </div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ganancia Neta</h3>
            </div>
          </div>
          <span className="text-2xl sm:text-3xl font-bold block mb-1 tnum text-[#10b981] dark:text-[#00C853]">${stats.profit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <div className="space-y-2 text-sm pt-3 mt-1 border-t border-slate-100 dark:border-[#333333]">
            <div className="flex justify-between items-center">
               <span className="font-medium text-[#64748b] dark:text-slate-400">Margen Global:</span>
              <span className="font-bold px-2 py-0.5 rounded-md tnum bg-slate-100 text-[#0f172a] dark:bg-[#161616] dark:text-white dark:border dark:border-[#333333]">{stats.revenue > 0 ? ((stats.profit / stats.revenue) * 100).toFixed(1) : 0}%</span>
            </div>
            <div className="flex justify-between items-center">
               <span className="font-medium text-[#64748b] dark:text-slate-400">Retira / Envío:</span>
              <span className="font-bold tnum text-[#0f172a] dark:text-white">{stats.pickupCount} / {stats.deliveryCount}</span>
            </div>
          </div>
        </div>

        {/* Stock crítico */}
        <div
          onClick={() => setActiveModal('stock')}
          className="rounded-2xl p-5 border flex flex-col justify-between card-hover transition-colors duration-200 cursor-pointer relative overflow-hidden bg-white shadow-card border-red-500/30 bg-gradient-to-br from-white to-red-50/60 hover:border-red-400 dark:bg-none dark:bg-obsidian-800/60 dark:border-accent-orange/20 dark:backdrop-blur-xl group"
        >
          <div className="absolute -right-10 -top-10 w-32 h-32 bg-accent-orange/10 blur-3xl rounded-full pointer-events-none animate-blob" style={{ animationDelay: '3s' }} />
          <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B00]/5 to-transparent pointer-events-none hidden dark:block" />
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="flex items-center gap-2">
              <Warning size={18} weight="fill" className="text-red-500 dark:text-[#FF6B00]" />
              <h3 className="text-xs font-bold tracking-widest uppercase text-red-500 dark:text-white dark:text-sm dark:font-medium dark:tracking-normal dark:uppercase-none">Stock Crítico</h3>
            </div>
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm bg-red-500 dark:bg-[#FF6B00] dark:shadow-[0_0_15px_rgba(255,107,0,0.3)] ${stats.lowStockCount > 0 ? 'pulse-alert' : ''}`}>
              <Warning size={20} weight="bold" className="text-white" />
            </span>
          </div>
          <div className="mb-1 flex items-end gap-2 relative z-10">
            <span className="text-3xl sm:text-4xl font-extrabold tnum text-red-500 dark:text-[#FF6B00] dark:text-2xl sm:dark:text-3xl dark:font-bold">{stats.lowStockCount} <span className="text-sm font-medium text-red-500/80 dark:text-[#9E9E9E] dark:font-normal">ítems</span></span>
          </div>
          <div className="pt-4 border-t border-red-500/10">
            <span className={`text-xs font-bold ${stats.lowStockCount > 0 ? 'text-red-600 dark:text-[#FF6B00]' : 'text-emerald-600 dark:text-[#00C853]'}`}>
              {stats.lowStockCount > 0 ? 'Requiere Reposición' : 'Stock Normal'}
            </span>
          </div>
        </div>
      </div>

      {/* Onboarding Widget (Campify Dark) */}
      {!onboardingHidden && (() => {
        let visitedHistory = false;
        try { visitedHistory = localStorage.getItem('dv-visited-history') === '1'; } catch { /* noop */ }
        const steps = [
          { done: stats.totalProducts > 0, title: 'Cargar productos', sub: stats.totalProducts > 0 ? `${stats.totalProducts} productos cargados` : 'Agrega tu stock al sistema' },
          { done: stats.salesCount > 0, title: 'Registrar primera venta', sub: stats.salesCount > 0 ? `${stats.salesCount} ventas realizadas` : 'Opera desde el POS' },
          { done: visitedHistory, title: 'Revisar pedidos & historial', sub: visitedHistory ? 'Historial revisado ✓' : 'Controla trazabilidad y reportes' },
        ];
        const doneCount = steps.filter((s) => s.done).length;
        if (doneCount === steps.length) return null;
        return (
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 border border-brand-500/50 rounded-2xl p-6 shadow-glow-brand relative overflow-hidden transition-all duration-300">
          <Award className="absolute -right-6 -bottom-6 text-9xl text-white/5 transform -rotate-12" size={120} />
          <div className="flex justify-between items-start mb-5 relative z-10">
            <div>
              <h3 className="text-lg font-extrabold text-white">¡Bienvenido al sistema!</h3>
              <p className="text-brand-200 text-sm mt-1">Sigue estos pasos para configurar tu dietética.</p>
            </div>
            <button
              onClick={() => { setOnboardingHidden(true); try { localStorage.setItem('dv-onboarding-hidden', '1'); } catch {} }}
              className="text-brand-200 hover:text-white bg-black/20 p-1.5 rounded-lg cursor-pointer"
              title="Ocultar"
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3 relative z-10">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-4 bg-obsidian-900/40 p-4 rounded-xl border border-white/10 backdrop-blur-sm">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-lg ${step.done ? 'bg-accent-emerald shadow-emerald-500/30' : 'bg-white/10'}`}
                >
                  {step.done ? (
                    <Check size={20} className="text-white" />
                  ) : (
                    <span className="text-white text-sm font-black">{i + 1}</span>
                  )}
                </div>
                <div className="flex-1">
                  <h4 className="text-white font-bold text-sm">{step.title}</h4>
                  <p className="text-brand-200 text-xs mt-0.5">{step.sub}</p>
                </div>
                {step.title === 'Revisar pedidos & historial' && (
                  <button
                    onClick={() => setActiveTab('history')}
                    className="text-xs font-bold bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    Ir ahora
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-1.5 mt-4 relative z-10">
            {steps.map((s, i) => (
              <div key={i} className={`w-2.5 h-2.5 rounded-full ${s.done ? 'bg-accent-emerald' : 'bg-white/20'}`} />
            ))}
          </div>
          <p className="text-center text-brand-200 text-xs mt-2 relative z-10">{doneCount} de {steps.length} pasos completados</p>
        </div>
        );
      })()}

      {/* Gráfico de Tendencia de Ventas */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 dark:bg-[#1F1F1F] dark:border-[#333333]">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="text-sky-600" size={18} />
            {dateRange === 'today' ? 'Tendencia Intradía (por hora)' : 'Tendencia de Ventas Diaria'}
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">{dateRange === 'today' ? 'Hoy' : dateRange === 'week' ? 'Esta Semana' : dateRange === 'custom' ? `Custom: ${customRange.start} → ${customRange.end || 'hoy'}` : 'Este Mes'}</span>
        </div>
        <SalesTrendChart days={dateRange === 'today' ? intradayStats : dailyStats} height={260} />
      </div>

      {/* Desglose de Formas de Pago */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 dark:bg-[#1F1F1F] dark:border-[#333333]">
        <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
          <CurrencyDollar className="text-emerald-600" size={18} />
          Distribución de Pagos
        </h3>
        <PaymentDonut
          data={[
            { label: 'Efectivo', value: stats.cashTotal, color: '#10b981' },
            { label: 'Tarjeta', value: stats.cardTotal, color: '#3B82F6' },
            { label: 'Transferencia', value: stats.transferTotal, color: '#f59e0b' },
          ]}
          size={150}
        />
      </div>

      {/* Top Clientes */}
      {topCustomers.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 dark:bg-[#1F1F1F] dark:border-[#333333]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Receipt className="text-violet-600" size={18} />
              Top Clientes
            </h3>
            <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333]">
              {(['total', 'count'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setCustRankBy(m)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    custRankBy === m
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-violet-600 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {m === 'total' ? 'Por monto' : 'Por compras'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {[...topCustomers]
              .sort((a, b) => (custRankBy === 'total' ? b.total - a.total : b.count - a.count))
              .map((c, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 dark:bg-white/5 dark:border-[#333333]">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-extrabold ${idx === 0 ? 'bg-amber-100 text-amber-800' : idx === 1 ? 'bg-slate-200 text-slate-700' : idx === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>
                    {idx + 1}
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white text-xs truncate">{c.name}</span>
                </div>
                <p className="text-sm font-extrabold text-violet-700 dark:text-violet-400 tnum">
                  {custRankBy === 'total' ? `$${c.total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${c.count} compra${c.count !== 1 ? 's' : ''}`}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                  {custRankBy === 'total' ? `${c.count} compra${c.count !== 1 ? 's' : ''}` : `$${c.total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Productos por Vencer */}
      {expiringProducts.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-amber-200/80 p-5 dark:bg-[#1F1F1F] dark:border-amber-500/20">
          <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-3">
            <AlertTriangle className="text-amber-500" size={18} />
            Productos por Vencer (30 días)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-amber-50/70 dark:bg-white/5 text-amber-800 dark:text-amber-300 text-xs uppercase tracking-wider border-b border-amber-200 dark:border-[#333333]">
                  <th className="p-3 whitespace-nowrap">Producto</th>
                  <th className="p-3 whitespace-nowrap">Vence</th>
                  <th className="p-3 whitespace-nowrap text-right">Días</th>
                  <th className="p-3 whitespace-nowrap text-right">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#333333] text-sm text-slate-700 dark:text-slate-300">
                {expiringProducts.map((p) => {
                  const diff = Math.ceil((new Date(p.expiry_date! + (p.expiry_date!.includes('T') ? '' : 'T00:00:00')).getTime() - Date.now()) / 86400000);
                  return (
                    <tr key={p.id} className="hover:bg-amber-50/40 dark:hover:bg-white/5 transition">
                      <td className="p-3 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 dark:text-white">{p.name}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400 font-medium">{p.category || 'General'}</span>
                      </td>
                      <td className="p-3 whitespace-nowrap">{new Date(p.expiry_date! + (p.expiry_date!.includes('T') ? '' : 'T00:00:00')).toLocaleDateString('es-AR')}</td>
                      <td className={`p-3 whitespace-nowrap text-right font-extrabold tnum ${diff <= 7 ? 'text-red-600 dark:text-red-400' : diff <= 15 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`}>
                        {diff <= 0 ? '¡VENCIDO!' : `en ${diff} día${diff !== 1 ? 's' : ''}`}
                      </td>
                      <td className="p-3 whitespace-nowrap text-right font-bold tnum text-slate-800 dark:text-white">{p.stock_quantity} {p.unit_type}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          onClick={() => setActiveModal('bestSellers')}
          className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 space-y-4 hover:border-emerald-500 transition duration-200 cursor-pointer"
        >
          <div className="flex items-center justify-between border-b pb-3">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <Award className="text-amber-500" size={20} />
              <span>Top 10 Productos Estrella</span>
            </h3>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full font-bold uppercase dark:bg-amber-500/10 dark:text-amber-400">Más vendidos</span>
              <button
                onClick={(e) => { e.stopPropagation(); setActiveModal('bestSellers'); }}
                title="Ampliar"
                aria-label="Ampliar Top 10"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition cursor-pointer"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <TopSellers items={bestSellers} variant="card" />
          </div>
        </div>

        <div
          onClick={() => setActiveModal('categories')}
          className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 space-y-4 hover:border-emerald-500 transition duration-200 cursor-pointer"
        >
          <div className="flex items-center justify-between border-b pb-3">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="text-teal-600" size={20} />
              <span>Rentabilidad por Categoría</span>
            </h3>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] bg-teal-100 text-teal-800 px-2.5 py-0.5 rounded-full font-bold uppercase dark:bg-teal-500/10 dark:text-teal-400">Margen</span>
              <button
                onClick={(e) => { e.stopPropagation(); setActiveModal('categories'); }}
                title="Ampliar"
                aria-label="Ampliar rentabilidad"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition cursor-pointer"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <CategoryProfits items={categoryProfits} variant="card" />
          </div>
        </div>

        <div
          onClick={() => setActiveModal('hourly')}
          className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 space-y-4 hover:border-emerald-500 transition duration-200 cursor-pointer"
        >
          <div className="flex items-center justify-between border-b pb-3">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="text-blue-600" size={20} />
              <span>Horarios Pico (Franja Horaria)</span>
            </h3>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full font-bold uppercase dark:bg-blue-500/10 dark:text-blue-400">Demanda</span>
              <button
                onClick={(e) => { e.stopPropagation(); setActiveModal('hourly'); }}
                title="Ampliar"
                aria-label="Ampliar horarios"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10 transition cursor-pointer"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <HourlyDemand data={hourlySales} variant="card" />
          </div>
        </div>
      </div>

       <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden dark:bg-[#1F1F1F] dark:border-[#333333] border-t-2 border-slate-200 dark:border-[#333333] p-5 mt-2 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 mr-auto">
              <AlertTriangle className="text-amber-500 animate-pulse" size={20} />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Stock Crítico + Orden de Compra</h2>
            </div>
            <span className="text-xs bg-amber-100 text-amber-800 px-3 py-1 rounded-full font-bold dark:bg-amber-500/10 dark:text-amber-300">
              {lowStockProducts.length} productos
            </span>
            {Object.keys(orders).length > 0 && (
              <span className="text-xs bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full font-bold dark:bg-emerald-500/10 dark:text-emerald-300">
                {Object.keys(orders).length} pedidos ✓
              </span>
            )}
          </div>

          {lowStockProducts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333]">
                {(['urgency', 'cost', 'name'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setStockSort(m)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      stockSort === m
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-amber-600 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {m === 'urgency' ? 'Urgencia' : m === 'cost' ? 'Costo' : 'Nombre'}
                  </button>
                ))}
              </div>
              <div className="flex rounded-xl p-1 gap-1 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333]">
                {(['all', 'pending', 'ordered'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStockFilter(f)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      stockFilter === f
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendientes' : 'Pedidos'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={handleWhatsAppOrders}
                  title="Enviar pedido por WhatsApp (un chat por proveedor)"
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                >
                  <WhatsappLogo size={16} weight="fill" /> WhatsApp
                </button>
                <button
                  onClick={handleCopyOrder}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer dark:bg-[#FF6B00] dark:hover:bg-[#E66000]"
                >
                  {copiedOrder ? '¡Orden copiada!' : '📋 Copiar orden'}
                </button>
              </div>
            </div>
          )}

        {lowStockProducts.length === 0 ?
          <div className="p-10 text-center text-slate-500 flex flex-col items-center justify-center space-y-2">
            <PackageCheck size={44} className="text-emerald-500" />
            <p className="font-medium">¡Excelente! No hay productos con stock crítico en este momento.</p>
          </div>
          :
          (() => {
            const rows = lowStockProducts
              .filter((p) => stockFilter === 'all' ? true : stockFilter === 'ordered' ? !!orders[p.id] : !orders[p.id])
              .map((p) => {
                const sug = suggestQty(p);
                const ordered = !!orders[p.id];
                const empty = Number(p.stock_quantity) <= 0;
                const coverage = Number(p.stock_quantity) / Math.max(Number(p.min_stock || 5), 0.01);
                return { p, sug, ordered, empty, coverage, cost: sug * Number(p.cost_price) };
              })
              .sort((a, b) => {
                if (stockSort === 'cost') return b.cost - a.cost;
                if (stockSort === 'name') return a.p.name.localeCompare(b.p.name);
                if (a.empty !== b.empty) return a.empty ? -1 : 1;
                return a.coverage - b.coverage;
              });
            const totalCost = rows.reduce((a, r) => a + r.cost, 0);
            if (rows.length === 0) {
              return <p className="text-center text-slate-400 text-sm py-6">Sin productos en este filtro.</p>;
            }
            return (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-[#333333]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/70 text-slate-700 dark:text-slate-300 text-xs uppercase tracking-wider border-b border-slate-200 dark:bg-white/5 dark:border-[#333333]">
                        <th className="p-4 whitespace-nowrap">Producto</th>
                        <th className="p-4 whitespace-nowrap text-center">Stock</th>
                        <th className="p-4 whitespace-nowrap">Sugerido</th>
                        <th className="p-4 whitespace-nowrap">Costo est.</th>
                        <th className="p-4 whitespace-nowrap text-right">Pedido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#333333] text-sm text-slate-700 dark:text-slate-300">
                      {rows.map(({ p, sug, ordered, empty, cost }) => (
                        <tr key={p.id} className={`hover:bg-slate-50/50 dark:hover:bg-white/5 transition ${ordered ? 'opacity-60' : ''}`}>
                          <td className="p-4 whitespace-nowrap">
                            <span className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${empty ? 'bg-red-500' : 'bg-amber-500'}`} />
                              {p.name}
                              {empty && (
                                <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                  Sin stock
                                </span>
                              )}
                            </span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400 font-medium">
                              {p.category || 'General'} • mín {p.min_stock} {p.unit_type} • {supplierName(p)}
                            </span>
                          </td>
                          <td className={`p-4 font-bold tnum whitespace-nowrap text-center ${empty ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>{p.stock_quantity}</td>
                          <td className="p-4 font-extrabold text-emerald-700 dark:text-emerald-400 tnum whitespace-nowrap">+{sug} {p.unit_type}</td>
                          <td className="p-4 font-bold text-slate-800 dark:text-white tnum whitespace-nowrap">${cost.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-4 text-right whitespace-nowrap">
                            <button
                              onClick={() => toggleOrdered(p.id)}
                              title={ordered ? 'Quitar de pedidos' : 'Marcar como pedido al proveedor'}
                              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer ${ordered ? 'bg-emerald-600 text-white' : 'bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-700 dark:bg-white/10 dark:text-white'}`}
                            >
                              {ordered ? '✓ Pedido' : 'Marcar pedido'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 pt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span>{rows.length} productos <span className="tnum">· costo total <strong className="text-slate-800 dark:text-white">${Math.round(totalCost).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span></span>
                  <span className="ml-auto">{rows.filter((r) => r.empty).length} sin stock · {rows.filter((r) => r.ordered).length} pedidos</span>
                </div>
              </>
            );
          })()
        }
</div>

        {/* MODALS */}
       {activeModal === 'sales' && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<ShoppingBag className="text-blue-600" size={24} />}
          title="Detalle de Ventas & Cierre de Caja"
          maxWidth="max-w-2xl"
          headerActions={
            <button
              onClick={handlePrintReport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition cursor-pointer dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
            >
              <Printer size={16} /> Imprimir Cierre
            </button>
          }
        >
          {salesList.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No se registraron ventas en este período.</p>
          ) : (
            <div className="space-y-3">
              {salesList.map((s) => (
                <div key={s.id} className="p-5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-3 shadow-xs dark:bg-white/5 dark:border-[#333333]">
                  <div className="flex justify-between items-center text-base font-extrabold text-slate-900 dark:text-white">
                    <span>Cliente: {s.customer_name}</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-emerald-700 dark:text-emerald-400 text-lg tnum">${s.total_amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      {canAnnul && s.status !== 'cancelled' && (
                        <button
                          onClick={() => handleCancelSale(s)}
                          title="Anular venta"
                          className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition cursor-pointer"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300 flex justify-between font-bold pb-2 border-b border-slate-200 dark:border-[#333333]">
                    <span>
                      Vendedor: {s.profiles?.full_name || 'Vendedor'} | Pago: <span className="uppercase text-emerald-700 dark:text-emerald-400">{s.payment_method || 'efectivo'}</span> | Despacho: <span className="uppercase text-blue-700 dark:text-blue-400">{s.dispatch_type === 'delivery' ? 'envío' : 'retira'}</span>
                    </span>
                    <span>{new Date(s.created_at).toLocaleString('es-AR')}</span>
                  </div>
                  <div className="pt-1 space-y-1.5 text-sm">
                    <p className="font-extrabold text-slate-900 dark:text-white">Ítems vendidos:</p>
                    {s.sale_items?.map((item, idx) => (
                      <div key={idx} className="flex justify-between font-bold text-slate-800 dark:text-slate-200">
                        <span>• {item.products?.name || 'Producto'} (x{item.quantity})</span>
                        <span className="tnum">${item.subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModalShell>
      )}

      {activeModal === 'bestSellers' && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<Award className="text-amber-500" size={24} />}
          title="Top 10 Productos Más Vendidos"
        >
          <TopSellers items={bestSellers} variant="modal" />
        </ModalShell>
      )}

      {activeModal === 'categories' && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<TrendingUp className="text-teal-600" size={24} />}
          title="Rentabilidad Completa por Categoría"
        >
          <CategoryProfits items={categoryProfits} variant="modal" />
        </ModalShell>
      )}

      {activeModal === 'hourly' && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<Calendar className="text-blue-600" size={24} />}
          title="Horarios Pico y Demanda"
          maxWidth="max-w-lg"
        >
          <HourlyDemand data={hourlySales} variant="modal" />
        </ModalShell>
      )}

      {activeModal === 'lastTicket' && latestSale && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<Receipt className="text-blue-600" size={24} />}
          title="Último Ticket Emitido"
          maxWidth="max-w-md"
        >
          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 font-sans text-sm">
            <div className="text-center pb-3 border-b border-dashed border-slate-300">
              <p className="font-black text-slate-900 text-base">DIETÉTICA VISHAL</p>
              <p className="text-xs font-bold text-slate-600">Comprobante #{latestSale?.id?.slice(0, 8)}</p>
              <p className="text-xs font-semibold text-slate-500">{latestSale ? new Date(latestSale!.created_at).toLocaleString('es-AR') : ''}</p>
            </div>
            <div className="space-y-1 font-bold text-slate-800 text-xs">
              <p><strong>Cliente:</strong> {latestSale?.customer_name}</p>
              <p><strong>Vendedor:</strong> {latestSale?.profiles?.full_name || 'Vendedor'}</p>
              <p><strong>Tipo:</strong> {latestSale?.sale_type?.toUpperCase()}</p>
            </div>
            <div className="pt-3 border-t border-dashed border-slate-300 space-y-2">
              {latestSale?.sale_items?.map((item, idx) => (
                <div key={idx} className="flex justify-between font-extrabold text-slate-900 text-sm">
                  <span>{item.products?.name} x{item.quantity}</span>
                  <span className="tnum">${item.subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t-2 border-slate-900 flex justify-between font-black text-slate-900 text-base">
              <span>TOTAL:</span>
              <span className="text-emerald-600 tnum">${latestSale?.total_amount?.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </ModalShell>
      )}

      {activeModal === 'revenue' && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<DollarSign className="text-emerald-600" size={24} />}
          title="Desglose de Facturación & Pagos"
          maxWidth="max-w-lg"
        >
          <RevenueBreakdown
            revenue={stats.revenue}
            cashTotal={stats.cashTotal}
            transferTotal={stats.transferTotal}
            cardTotal={stats.cardTotal}
            pickupCount={stats.pickupCount}
            deliveryCount={stats.deliveryCount}
            sales={salesList}
            onCancelSale={handleCancelSale}
          />
        </ModalShell>
      )}

      {activeModal === 'stock' && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<Warning size={24} weight="fill" className="text-red-500" />}
          title="Desglose de Stock Crítico"
          maxWidth="max-w-lg"
        >
          <StockBreakdown
            products={lowStockProducts}
            orders={orders}
            onToggleOrdered={toggleOrdered}
            onCopyOrder={handleCopyOrder}
            copiedOrder={copiedOrder}
            suggestQty={suggestQty}
          />
        </ModalShell>
      )}

      {activeModal === 'profit' && (
        <ModalShell
          onClose={() => setActiveModal(null)}
          icon={<ChartLineUp className="text-teal-600" size={24} />}
          title="Balance de Ganancias y Rendimiento"
        >
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-br from-teal-600 to-teal-800 rounded-2xl flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold text-teal-100 uppercase tracking-wider">Ganancia Neta Estimada</p>
                <p className="text-3xl font-extrabold text-white mt-1 tnum">${stats.profit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <span className="text-xs bg-white/15 text-white font-bold px-3 py-1.5 rounded-full tnum">
                Margen Neto: {stats.revenue > 0 ? ((stats.profit / stats.revenue) * 100).toFixed(1) : 0}%
              </span>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 dark:bg-white/5 dark:border-[#333333]">
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase flex items-center gap-1">
                <Award size={16} className="text-amber-500" />
                <span>Ventas por Vendedor (Período)</span>
              </p>
              <div className="space-y-1.5 pt-1">
                {Object.keys(stats.salesByUser).length === 0 ? (
                  <p className="text-xs text-slate-400">Sin ventas registradas en este período.</p>
                ) : (
                  (() => {
                    const entries = Object.entries(stats.salesByUser);
                    const max = Math.max(...entries.map(([, c]) => c), 1);
                    return entries
                      .sort((a, b) => b[1] - a[1])
                      .map(([name, count]) => (
                        <div key={name}>
                          <div className="flex justify-between text-xs font-bold text-slate-800 dark:text-slate-200">
                            <span className="truncate">{name}</span>
                            <span className="text-emerald-600 dark:text-emerald-400 tnum ml-2 shrink-0">{count} ventas</span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden mt-1">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.max((count / max) * 100, 4)}%`, background: 'linear-gradient(90deg,#0d9488,#2dd4bf)' }}
                            />
                          </div>
                        </div>
                      ));
                  })()
                )}
              </div>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
