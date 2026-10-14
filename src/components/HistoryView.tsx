import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  MagnifyingGlass,
  Funnel,
  Receipt,
  CaretDown,
  ArrowsClockwise,
  Prohibit,
  WhatsappLogo,
  Printer,
  Copy,
} from '@phosphor-icons/react';
import { RoundedSelect } from './RoundedSelect';
// Exportaciones: xlsx dinámico (ver botones Exportar / Para contador)
import { netoFromTotal, ivaFromTotal, round2 } from '../lib/tax';
import { loadBusiness } from '../lib/businessSettings';

interface SaleItem {
  quantity: number;
  unit_price: number;
  subtotal: number;
  product_id: string;
  products?: { name: string };
}

interface SaleRecord {
  id: string;
  receipt_number?: string | null;
  customer_name: string;
  sale_type: string;
  total_amount: number;
  profit_amount: number;
  payment_method?: string;
  dispatch_type?: string;
  status?: string;
  user_id?: string;
  created_at: string;
  profiles?: { full_name: string };
  sale_items?: SaleItem[];
}

const docOf = (s: SaleRecord) => s.receipt_number || `#${s.id.slice(0, 8).toUpperCase()}`;

type DateRange = 'today' | 'week' | 'month' | 'all';

const PAGE_SIZE = 15;

const paymentLabel = (m?: string) =>
  m === 'transfer' ? 'Transf.' : m === 'card' ? 'Tarjeta' : m === 'mercadopago' ? 'Mercado Pago' : 'Efectivo';
const dispatchLabel = (d?: string) => (d === 'delivery' ? 'Envío' : 'Retira');
const statusOf = (s: SaleRecord) => s.status ?? 'completed';

export function HistoryView() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Filtros
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [search, setSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dispatchFilter, setDispatchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [historyPhone, setHistoryPhone] = useState('');
  const [waError, setWaError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchSalesHistory();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [dateRange, search, sellerFilter, paymentFilter, typeFilter, dispatchFilter, statusFilter]);

  const fetchSalesHistory = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sales')
        .select(`
          *,
          profiles (full_name),
          sale_items (
            quantity,
            unit_price,
            subtotal,
            product_id,
            products (name)
          )
        `)
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) throw error;
      setSales((data || []) as SaleRecord[]);
    } catch (err) {
      console.error('Error fetching sales history:', err);
    } finally {
      setLoading(false);
    }
  };

  const sellers = useMemo(() => {
    const map = new Map<string, string>();
    sales.forEach((s) => {
      const name = s.profiles?.full_name || 'Vendedor';
      if (!map.has(name)) map.set(name, name);
    });
    return Array.from(map.keys()).sort();
  }, [sales]);

  const filtered = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let start = 0;
    if (dateRange === 'today') start = startOfToday;
    else if (dateRange === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      start = new Date(now.getFullYear(), now.getMonth(), diff).getTime();
    } else if (dateRange === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    }

    const q = search.trim().toLowerCase();

    return sales.filter((s) => {
      if (dateRange !== 'all' && new Date(s.created_at).getTime() < start) return false;
      if (q) {
        const matchTicket = s.id.toLowerCase().includes(q) || s.id.slice(0, 8).toLowerCase().includes(q);
        const matchClient = (s.customer_name || '').toLowerCase().includes(q);
        if (!matchTicket && !matchClient) return false;
      }
      if (sellerFilter !== 'all' && (s.profiles?.full_name || 'Vendedor') !== sellerFilter) return false;
      if (paymentFilter !== 'all' && (s.payment_method || 'cash') !== paymentFilter) return false;
      if (typeFilter !== 'all' && s.sale_type !== typeFilter) return false;
      if (dispatchFilter !== 'all' && (s.dispatch_type || 'pickup') !== dispatchFilter) return false;
      if (statusFilter !== 'all' && statusOf(s) !== statusFilter) return false;
      return true;
    });
  }, [sales, dateRange, search, sellerFilter, paymentFilter, typeFilter, dispatchFilter, statusFilter]);

  const kpis = useMemo(() => {
    const valid = filtered.filter((s) => statusOf(s) !== 'cancelled');
    return {
      count: valid.length,
      revenue: valid.reduce((a, s) => a + Number(s.total_amount), 0),
      profit: valid.reduce((a, s) => a + Number(s.profit_amount), 0),
    };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const buildHistoryTicketText = (sale: SaleRecord) => {
    const lines: string[] = [];
    const biz = loadBusiness();
    lines.push(`${biz.name} - ${sale.receipt_number ? `N° ${sale.receipt_number}` : `Ticket #${sale.id.slice(0, 8).toUpperCase()}`}`);
    if (biz.address) lines.push(biz.address);
    if (biz.phone) lines.push(`Tel: ${biz.phone}`);
    lines.push(`Cliente: ${sale.customer_name}`);
    if (sale.sale_type === 'afip') {
      if ((sale as any).customer_doc) lines.push(`CUIT/DNI: ${(sale as any).customer_doc}`);
      lines.push(`Cond. IVA: ${(sale as any).customer_iva_cond || 'CF'}`);
    }
    lines.push(`Fecha: ${new Date(sale.created_at).toLocaleString('es-AR')}`);
    lines.push(`Pago: ${paymentLabel(sale.payment_method)} | Despacho: ${dispatchLabel(sale.dispatch_type)}`);
    lines.push(``);
    const items = sale.sale_items || [];
    if (items.length === 0) {
      lines.push(`(Detalle de items no registrado - venta antigua)`);
    } else {
      items.forEach((it) => {
        lines.push(`- ${it.products?.name || 'Producto'} x${it.quantity} - $${Number(it.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      });
    }
    lines.push(``);
    if (sale.sale_type === 'afip') {
      lines.push(`Neto: $${Number((sale as any).net_amount ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      lines.push(`IVA 21%: $${Number((sale as any).iva_amount ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    }
    lines.push(`TOTAL: $${Number(sale.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    lines.push(``);
    lines.push(`¡Gracias por elegir saludable! 🌱`);
    if (biz.footer) lines.push(biz.footer);
    return lines.join('\n');
  };

  const handleHistoryWhatsApp = (sale: SaleRecord) => {
    const cleanPhone = (historyPhone || '').replace(/\D/g, '');
    if (!cleanPhone) {
      setWaError('Ingresá el número de WhatsApp (Ej: 5491123456789).');
      return;
    }
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      setWaError('Número incompleto. Usá 549 + área + número, sin 0, sin 15, sin +.');
      return;
    }
    setWaError('');
    const encoded = encodeURIComponent(buildHistoryTicketText(sale));
    window.open(`https://wa.me/${cleanPhone}?text=${encoded}`, '_blank', 'noopener,noreferrer');
  };

  const handleHistoryCopy = async (sale: SaleRecord) => {
    try {
      await navigator.clipboard.writeText(buildHistoryTicketText(sale));
      setCopiedId(sale.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      setWaError('No se pudo copiar. Seleccioná el texto manualmente.');
    }
  };

  const handleHistoryPrint = (sale: SaleRecord) => {
    const items = sale.sale_items || [];
    const rows = items.length === 0
      ? `<p class="muted" style="text-align:center;padding:12px 0">(Detalle de items no registrado)</p>`
      : items.map((it) => `
        <div class="item">
          <div class="item-left">
            <div class="item-name">${it.products?.name || 'Producto'}</div>
            <div class="item-detail">x${it.quantity} · $${Number(it.unit_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div class="item-total">$${Number(it.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>`).join('');
    const win = window.open('', '_blank', 'width=360,height=640');
    if (!win) {
      alert('Permití ventanas emergentes para imprimir.');
      return;
    }
    win.document.write(`
      <html><head><title>${sale.receipt_number ? `Comprobante ${sale.receipt_number}` : `Ticket #${sale.id.slice(0, 8).toUpperCase()}`}</title>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
      <style>
        @page { size: 80mm auto; margin: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Plus Jakarta Sans', Arial, sans-serif; width: 72mm; margin: 0 auto; padding: 4mm 2mm 6mm; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .logo { text-align: center; margin-bottom: 2px; }
        .store { text-align: center; font-weight: 800; font-size: 17px; letter-spacing: 3px; }
        .receipt-label { text-align: center; font-weight: 700; font-size: 12px; letter-spacing: 6px; color: #333; margin-top: 2px; }
        .info { font-size: 12px; font-weight: 500; margin-top: 6px; }
        .info .row { display: flex; justify-content: space-between; padding: 1px 0; }
        .info .row span:first-child { color: #333; font-weight: 700; }
        .sep { border: none; border-top: 1px dashed #555; margin: 7px 0; }
        .item { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 4px 0; }
        .item-left { min-width: 0; }
        .item-name { font-weight: 500; font-size: 13px; line-height: 1.3; }
        .item-detail { color: #333; font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .item-total { font-weight: 500; font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .total { display: flex; justify-content: space-between; align-items: center; font-weight: 800; font-size: 16px; padding: 2px 0; }
        .total span:last-child { font-size: 19px; font-variant-numeric: tabular-nums; }
        .payline { font-size: 12.5px; font-weight: 500; padding: 2px 0; }
        .foot { text-align: center; font-weight: 500; font-size: 13px; margin-top: 8px; }
        .code { text-align: center; font-size: 10px; letter-spacing: 3px; color: #333; margin-top: 3px; }
      </style>
      </head><body>
        <div class="logo">
          <svg width="44" height="44" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="44" height="44" rx="11" fill="#10b981"/>
            <path d="M24 9C15 15 12 22 13 30c6 1.5 14-1 18-9-3 8-9 13-16 13-2-8 1-17 9-25z" fill="#fff" opacity="0.95"/>
            <path d="M17 31c4-6 9-11 15-14" stroke="#10b981" stroke-width="2" stroke-linecap="round" fill="none"/>
          </svg>
        </div>
        <div class="store">DIETÉTICA VISHAL</div>
        <div class="receipt-label">TICKET</div>
        <hr class="sep">
        <div class="info">
          <div class="row"><span>${sale.receipt_number ? 'COMPROBANTE:' : 'TICKET:'}</span><span>${sale.receipt_number ? sale.receipt_number : `#${sale.id.slice(0, 8).toUpperCase()}`}</span></div>
          <div class="row"><span>FECHA:</span><span>${new Date(sale.created_at).toLocaleString('es-AR')}</span></div>
          <div class="row"><span>CLIENTE:</span><span>${sale.customer_name}</span></div>
          ${sale.sale_type === 'afip' ? `<div class="row"><span>CUIT/DNI:</span><span>${(sale as any).customer_doc || '-'}</span></div><div class="row"><span>COND. IVA:</span><span>${(sale as any).customer_iva_cond || 'CF'}</span></div>` : ''}
          <div class="row"><span>VENDEDOR:</span><span>${sale.profiles?.full_name || 'Vendedor'}</span></div>
        </div>
        <hr class="sep">
        ${rows}
        <hr class="sep">
        ${sale.sale_type === 'afip' ? `<div class="row"><span>NETO:</span><span>$${((sale as any).net_amount ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div><div class="row"><span>IVA 21%:</span><span>$${((sale as any).iva_amount ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>` : ''}
        <div class="total"><span>TOTAL:</span><span>$${Number(sale.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
        <hr class="sep">
        <div class="payline">Pago: ${paymentLabel(sale.payment_method)} • ${dispatchLabel(sale.dispatch_type)}</div>
        <hr class="sep">
        <div class="foot">¡GRACIAS POR SU COMPRA!</div>
        <div class="code">*#${sale.id.slice(0, 8).toUpperCase()}*</div>
        <script>window.onload=function(){window.focus();window.print();}</script>
      </body></html>`);
    win.document.close();
  };

  const handleCancelSale = async (sale: SaleRecord) => {
    if (statusOf(sale) === 'cancelled') return;
    if (!confirm(`¿Anular la venta #${sale.id.slice(0, 8)} de $${Number(sale.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}? Se devuelve el stock.`)) return;
    setCancellingId(sale.id);
    try {
      const { error: updateError } = await supabase
        .from('sales')
        .update({ status: 'cancelled' })
        .eq('id', sale.id);
      if (updateError) throw updateError;

      if (sale.sale_items) {
        for (const item of sale.sale_items) {
          const { data: prodData } = await supabase
            .from('products')
            .select('stock_quantity')
            .eq('id', item.product_id)
            .single();
          if (prodData) {
            await supabase
              .from('products')
              .update({ stock_quantity: Number(prodData.stock_quantity) + Number(item.quantity) })
              .eq('id', item.product_id);
          }
          await supabase.from('stock_movements').insert({
            product_id: item.product_id,
            type: 'adjustment',
            quantity: item.quantity,
            notes: `Anulación Venta #${sale.id.slice(0, 8)} (Historial)`,
          });
        }
      }
      setSales((prev) => prev.map((s) => (s.id === sale.id ? { ...s, status: 'cancelled' } : s)));
    window.dispatchEvent(new Event('dv:sale-completed'));
    } catch (err: any) {
      alert('Error al anular venta: ' + err.message);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Historial y Trazabilidad</h1>
          <p className="text-[#64748b] dark:text-slate-400 text-sm font-medium">Comprobantes internos y facturas ARCA • clic en una fila para ver el detalle</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-white dark:bg-white/5 rounded-xl shadow-sm border border-[#e2e8f0] dark:border-white/10 p-1 flex text-sm font-medium">
            {(['today', 'week', 'month', 'all'] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-4 py-2 rounded-lg transition-all ${dateRange === r ? 'bg-slate-900 dark:bg-brand-500 text-white shadow-sm' : 'text-[#64748b] dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'}`}
              >
                {r === 'today' ? 'Hoy' : r === 'week' ? 'Semana' : r === 'month' ? 'Mes' : 'Todo'}
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              const { exportVentasXlsx, barsByDay } = await import('../lib/exportXlsx');
              const periodo = dateRange === 'today' ? 'Hoy' : dateRange === 'week' ? 'Semana' : dateRange === 'month' ? 'Mes' : 'Todo el historial';
              await exportVentasXlsx(
                'historial-ventas',
                periodo,
                filtered.map((s) => ({
                  ticket: docOf(s),
                  fecha: new Date(s.created_at).toLocaleString('es-AR'),
                  fechaISO: s.created_at,
                  cliente: s.customer_name,
                  vendedor: s.profiles?.full_name || 'Vendedor',
                  pago: paymentLabel(s.payment_method),
                  despacho: dispatchLabel(s.dispatch_type),
                  tipo: s.sale_type === 'afip' ? 'ARCA' : 'Interno',
                  cantItems: (s.sale_items || []).reduce((a, it) => a + Number(it.quantity), 0),
                  detalle: (s.sale_items || []).map((it) => `${it.products?.name || 'Producto'} x${it.quantity}`).join(' | '),
                  total: Number(s.total_amount),
                  ganancia: Number(s.profit_amount),
                  anulada: statusOf(s) === 'cancelled',
                })),
                { revenue: kpis.revenue, profit: kpis.profit },
                { title: `Ventas por día — ${periodo}`, bars: barsByDay(filtered) }
              );
            }}
            title="Exportar el filtro actual a Excel (.xlsx) — anuladas en rojo + gráfico"
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-card transition card-hover cursor-pointer"
          >
            ⬇ Exportar
          </button>
          <button
            onClick={async () => {
              const { exportContadorXlsx, barsByPayment } = await import('../lib/exportXlsx');
              const periodo = dateRange === 'today' ? 'Hoy' : dateRange === 'week' ? 'Semana' : dateRange === 'month' ? 'Mes' : 'Todo el historial';
              const rows = filtered.map((s) => {
                const total = Number(s.total_amount);
                return {
                  ticket: docOf(s),
                  fecha: new Date(s.created_at).toLocaleString('es-AR'),
                  cliente: s.customer_name,
                  doc: (s as any).customer_doc || '',
                  vendedor: s.profiles?.full_name || 'Vendedor',
                  pago: paymentLabel(s.payment_method),
                  tipo: s.sale_type === 'afip' ? 'ARCA' : 'Interno',
                  ivaCond: (s as any).customer_iva_cond || (s.sale_type === 'afip' ? 'CF' : ''),
                  neto: (s as any).net_amount ?? round2(netoFromTotal(total)),
                  iva: (s as any).iva_amount ?? round2(ivaFromTotal(total)),
                  total,
                  anulada: statusOf(s) === 'cancelled',
                };
              });
              await exportContadorXlsx(
                'contador-ventas',
                periodo,
                rows,
                { title: 'Facturación por medio de pago', bars: barsByPayment(rows) }
              );
            }}
            title="Versión para contador (.xlsx): sin ganancia, con resumen y columnas fiscales — anuladas en rojo"
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-card transition card-hover cursor-pointer"
          >
            🧾 Para contador
          </button>
          <button
            onClick={fetchSalesHistory}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#10b981] hover:bg-emerald-600 text-white rounded-xl text-sm font-bold shadow-card transition card-hover cursor-pointer"
          >
            <ArrowsClockwise size={16} weight="bold" /> Actualizar
          </button>
        </div>
      </div>

      {/* KPIs del filtro */}
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Ventas (filtro)</p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-white tnum">{kpis.count}</p>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Facturación</p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-white tnum">${kpis.revenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Ganancia</p>
          <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tnum">${kpis.profit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
            <Funnel size={15} weight="bold" /> Filtros
            {(search || sellerFilter !== 'all' || paymentFilter !== 'all' || typeFilter !== 'all' || dispatchFilter !== 'all' || statusFilter !== 'all') && (
              <span className="bg-slate-900 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                {[search, sellerFilter, paymentFilter, typeFilter, dispatchFilter, statusFilter].filter((v) => v && v !== 'all').length} activos
              </span>
            )}
          </div>
          {(search || sellerFilter !== 'all' || paymentFilter !== 'all' || typeFilter !== 'all' || dispatchFilter !== 'all' || statusFilter !== 'all' || dateRange !== 'today') && (
            <button
              onClick={() => { setSearch(''); setSellerFilter('all'); setPaymentFilter('all'); setTypeFilter('all'); setDispatchFilter('all'); setStatusFilter('all'); setDateRange('today'); }}
              className="text-xs font-bold text-slate-400 hover:text-slate-700 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition active:scale-95 cursor-pointer"
            >
              Limpiar todo ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative group flex-[2_1_240px] min-w-[200px]">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#0ea5e9] transition-colors" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar #ticket o cliente..."
              className="w-full pl-9 pr-9 py-2.5 border-2 border-[#e2e8f0] dark:border-white/10 rounded-2xl text-sm font-semibold focus:outline-none focus:border-[#0ea5e9] focus:ring-4 focus:ring-[#0ea5e9]/10 transition bg-white dark:bg-white/5 dark:text-white dark:placeholder:text-slate-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs font-bold transition active:scale-90 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex-[1_1_170px] min-w-[160px]">
            <RoundedSelect value={sellerFilter} onChange={setSellerFilter} options={[{ value: 'all', label: 'Todos los vendedores' }, ...sellers.map((s) => ({ value: s, label: s }))]} />
          </div>
          <div className="flex-[1_1_150px] min-w-[140px]">
            <RoundedSelect value={paymentFilter} onChange={setPaymentFilter} options={[{ value: 'all', label: 'Todos los pagos' }, { value: 'cash', label: 'Efectivo' }, { value: 'transfer', label: 'Transferencia' }, { value: 'card', label: 'Tarjeta' }]} />
          </div>
          <div className="flex-[1_1_150px] min-w-[140px]">
            <RoundedSelect value={typeFilter} onChange={setTypeFilter} options={[{ value: 'all', label: 'Interno + ARCA' }, { value: 'internal', label: 'Interno' }, { value: 'afip', label: 'Factura ARCA' }]} />
          </div>
          <div className="flex-[1_1_150px] min-w-[140px]">
            <RoundedSelect value={dispatchFilter} onChange={setDispatchFilter} options={[{ value: 'all', label: 'Retira + Envío' }, { value: 'pickup', label: 'Retira' }, { value: 'delivery', label: 'Envío' }]} />
          </div>
          <div className="flex-[1_1_140px] min-w-[130px]">
            <RoundedSelect value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'Todas' }, { value: 'completed', label: 'Completadas' }, { value: 'cancelled', label: 'Anuladas' }]} />
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div id="history-table" className="glass-card rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/5 text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center justify-between">
          <span className="tnum">{loading ? 'Buscando...' : `${filtered.length} resultado${filtered.length === 1 ? '' : 's'}`}</span>
          {!loading && filtered.length > 0 && <span className="hidden sm:inline">Clic en una fila para expandir ⤵</span>}
        </div>
        {loading ? (
          <div className="p-4 space-y-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="skeleton h-10 w-24 rounded-xl" />
                <div className="skeleton h-10 flex-1 rounded-xl" />
                <div className="skeleton h-10 w-20 rounded-xl hidden sm:block" />
                <div className="skeleton h-10 w-24 rounded-xl" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="inline-flex p-4 bg-slate-100 dark:bg-white/5 rounded-full">
              <MagnifyingGlass size={28} className="text-slate-400" />
            </div>
            <p className="font-bold text-slate-700 dark:text-white">Sin ventas para este filtro</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 font-medium">Probá ampliar el rango de fecha o limpiar los filtros.</p>
            <button
              onClick={() => { setSearch(''); setSellerFilter('all'); setPaymentFilter('all'); setTypeFilter('all'); setDispatchFilter('all'); setStatusFilter('all'); setDateRange('all'); }}
              className="px-5 py-2.5 bg-slate-900 dark:bg-brand-500 text-white rounded-xl text-xs font-bold hover:bg-slate-800 dark:hover:bg-brand-600 transition active:scale-95 cursor-pointer"
            >
              Ver todo el historial
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-widest border-b border-slate-200 dark:border-white/5">
                    <th className="p-4">ID / Fecha</th>
                    <th className="p-4">Cliente</th>
                    <th className="p-4">Vendedor</th>
                    <th className="p-4">Pago / Despacho</th>
                    <th className="p-4">Tipo / Estado</th>
                    <th className="p-4 text-right">Total</th>
                    <th className="p-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
                  {pageItems.map((s, rowIdx) => {
                    const st = statusOf(s);
                    const expanded = expandedId === s.id;
                    return (
                      <Fragment key={s.id}>
                        <tr
                          onClick={() => setExpandedId(expanded ? null : s.id)}
                          style={{ animationDelay: `${Math.min(rowIdx, 10) * 30}ms` }}
                          className={`animate-row hover:bg-sky-50 dark:hover:bg-sky-500/10 hover:shadow-[inset_3px_0_0_#0ea5e9] transition-all cursor-pointer ${st === 'cancelled' ? 'opacity-60' : ''} ${expanded ? 'bg-sky-50 dark:bg-sky-500/10' : ''}`}
                        >
                          <td className="p-4">
                            <span className="font-bold text-slate-800 tnum">{s.receipt_number ? `N° ${s.receipt_number}` : `#${s.id.slice(0, 8).toUpperCase()}`}</span>
                            <span className="block text-xs text-slate-400 font-medium tnum">{new Date(s.created_at).toLocaleString('es-AR')}</span>
                          </td>
                          <td className="p-4 font-bold text-slate-900">{s.customer_name}</td>
                          <td className="p-4 text-slate-600 font-medium">{s.profiles?.full_name || 'Vendedor'}</td>
                          <td className="p-4">
                            <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 uppercase mr-1">{paymentLabel(s.payment_method)}</span>
                            <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full uppercase ${(s.dispatch_type || 'pickup') === 'delivery' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{dispatchLabel(s.dispatch_type)}</span>
                          </td>
                          <td className="p-4">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold uppercase mr-1 ${s.sale_type === 'afip' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                              {s.sale_type === 'afip' ? 'ARCA' : 'Interno'}
                            </span>
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${st === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {st === 'cancelled' ? 'Anulada' : 'OK'}
                            </span>
                          </td>
                          <td className="p-4 text-right font-extrabold text-emerald-700 tnum">${Number(s.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="p-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setExpandedId(expanded ? null : s.id)}
                              title="Ver detalle"
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold mr-2 cursor-pointer transition-all active:scale-90 ${expanded ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                            >
                              <Receipt size={14} /> <CaretDown size={13} weight="bold" className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                            {st !== 'cancelled' && (
                              <button
                                onClick={() => handleCancelSale(s)}
                                disabled={cancellingId === s.id}
                                title="Anular venta y devolver stock"
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-500 hover:text-white text-red-600 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 transition-all active:scale-90"
                              >
                                <Prohibit size={14} /> {cancellingId === s.id ? '...' : 'Anular'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr key={s.id + '-detail'} className="bg-slate-50/70">
                            <td colSpan={7} className="p-0">
                              <div className="detail-grid open">
                                <div className="detail-inner">
                              <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 space-y-3 m-4">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Trazabilidad • {s.receipt_number ? `Comprobante N° ${s.receipt_number}` : `Ticket #${s.id.slice(0, 8).toUpperCase()}`}</p>
                                {!s.sale_items || s.sale_items.length === 0 ? (
                                  <p className="text-sm text-slate-400">Sin ítems registrados (venta antigua).</p>
                                ) : (
                                  <div className="divide-y divide-slate-100 border-y border-slate-100">
                                    {s.sale_items.map((it, idx) => (
                                      <div key={idx} className="py-2 flex justify-between text-sm">
                                        <span className="font-bold text-slate-900">{it.products?.name || 'Producto'} <span className="font-medium text-slate-500 tnum">× {it.quantity} @ ${Number(it.unit_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                                        <span className="font-extrabold text-slate-900 tnum">${Number(it.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-semibold text-slate-600">
                                  <span>Vendedor: <strong className="text-slate-900">{s.profiles?.full_name || 'Vendedor'}</strong></span>
                                  <span>Pago: <strong className="text-slate-900">{paymentLabel(s.payment_method)}</strong></span>
                                  <span>Despacho: <strong className="text-slate-900">{dispatchLabel(s.dispatch_type)}</strong></span>
                                  <span>Ganancia est.: <strong className="text-teal-700 tnum">${Number(s.profit_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                                </div>
                                <div className="p-3 bg-emerald-50/60 dark:bg-white/5 rounded-2xl border border-emerald-100 dark:border-[#333333] space-y-2">
                                  <p className="text-xs font-extrabold text-slate-800 dark:text-white flex items-center gap-1.5">
                                    <WhatsappLogo size={16} weight="fill" className="text-emerald-600" /> Reenviar comprobante
                                  </p>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                      type="tel"
                                      value={historyPhone}
                                      onChange={(e) => { setHistoryPhone(e.target.value); setWaError(''); }}
                                      placeholder="5491123456789"
                                      className="flex-1 px-3 py-2 border-2 border-[#e2e8f0] rounded-xl text-sm font-bold bg-white tnum focus:outline-none focus:border-emerald-500 transition"
                                    />
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => handleHistoryWhatsApp(s)}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-md transition active:scale-95 whitespace-nowrap"
                                      >
                                        <WhatsappLogo size={15} weight="bold" /> WhatsApp
                                      </button>
                                      <button
                                        onClick={() => handleHistoryCopy(s)}
                                        className="px-4 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition active:scale-95 whitespace-nowrap"
                                      >
                                        <Copy size={14} weight="bold" /> {copiedId === s.id ? '¡Copiado!' : 'Copiar'}
                                      </button>
                                      <button
                                        onClick={() => handleHistoryPrint(s)}
                                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition active:scale-95 whitespace-nowrap"
                                      >
                                        <Printer size={14} weight="bold" /> Imprimir
                                      </button>
                                    </div>
                                  </div>
                                  {waError
                                    ? <p className="text-[11px] font-bold text-red-600">{waError}</p>
                                    : <p className="text-[11px] text-slate-500 font-medium">Se abre WhatsApp con el ticket listo para enviar. Imprimir abre el comprobante en una ventana nueva.</p>}
                                </div>
                                <p className="text-[11px] text-slate-400">El stock se descontó al cobrar y se restituye automáticamente al anular. Descuento/Envío de tickets viejos no quedaban guardados; desde ahora el total ya los incluye.</p>
                              </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between p-4 border-t border-slate-100 text-sm font-semibold text-slate-600">
              <span className="tnum">{filtered.length} ventas • pág. {page + 1}/{totalPages}</span>
              <div className="flex gap-2">
                <button disabled={page === 0} onClick={() => { setPage((p) => Math.max(0, p - 1)); document.getElementById('history-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold disabled:opacity-40 cursor-pointer transition active:scale-95">← Anterior</button>
                <button disabled={page + 1 >= totalPages} onClick={() => { setPage((p) => p + 1); document.getElementById('history-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold disabled:opacity-40 cursor-pointer transition active:scale-95">Siguiente →</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
