import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../types';
import { canAnnulSales } from '../../lib/permissions';
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
  FilePdf,
  FileCsv,
  FileXls,
  FileText,
  Download,
  SpinnerGap,
  Desktop,
  SignIn,
} from '@phosphor-icons/react';
import { RoundedSelect } from '../ui/RoundedSelect';
// Exportaciones: xlsx dinámico (ver menú Exportar) + CSV y PDF del listado
import { netoFromTotal, ivaFromTotal, round2 } from '../../lib/tax';
import { loadBusiness, loadCopyToMe, saveCopyToMe } from '../../lib/businessSettings';
import { isValidPhone, normalizeArgPhone, formatPhoneForDisplay, sendTicketWhatsApp, isMobileDevice, openWhatsAppWebLogin } from '../../lib/whatsapp';
import { buildTicketText, type TicketData } from '../../lib/ticketText';
import { ticketPdfFile, downloadTicketPdf } from '../../lib/ticketPdf';
import { shareFile } from '../../lib/share';
import { EmptyState } from '../../features/onboarding';
import { ContextualTooltip } from '../../features/onboarding';

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
  customer_phone?: string | null;
  sale_type: string;
  total_amount: number;
  profit_amount: number;
  payment_method?: string;
  dispatch_type?: string;
  status?: string;
  user_id?: string;
  created_at: string;
  cancelled_at?: string | null;
  cancelled_by?: string | null;
  cancel_reason?: string | null;
  profiles?: { full_name: string };
  sale_items?: SaleItem[];
}

interface MovementRow {
  id: string;
  type: string;
  quantity: number;
  previous_quantity: number | null;
  new_quantity: number | null;
  reference_type: string | null;
  created_at: string;
  user_id: string | null;
}

const docOf = (s: SaleRecord) => s.receipt_number || `#${s.id.slice(0, 8).toUpperCase()}`;

type DateRange = 'today' | 'week' | 'month' | 'all' | 'custom';

const PAGE_SIZE = 15;

/**
 * `sales` tiene dos FKs a `profiles` (`user_id` y `cancelled_by`), así que el
 * embed necesita el nombre del FK. Sin `!sales_user_id_fkey` PostgREST responde
 * PGRST201: "more than one relationship was found for 'sales' and 'profiles'".
 */
const SALES_SELECT = `
  *,
  profiles!sales_user_id_fkey (full_name),
  sale_items (
    quantity,
    unit_price,
    subtotal,
    product_id,
    products (name)
  )
`;

const paymentLabel = (m?: string) =>
  m === 'transfer' ? 'Transf.' : m === 'card' ? 'Tarjeta' : m === 'mercadopago' ? 'Mercado Pago' : 'Efectivo';
const dispatchLabel = (d?: string) => (d === 'delivery' ? 'Envío' : 'Retira');
const statusOf = (s: SaleRecord) => s.status ?? 'completed';

/** Limpia caracteres que rompen el filtro `or` de PostgREST. */
const sanitizeTerm = (raw: string) =>
  raw.trim().replace(/[,()%*:"\\]/g, ' ').replace(/\s+/g, ' ').trim();

const movementLabel = (m: MovementRow) =>
  m.reference_type === 'sale_cancel'
    ? 'Devolución por anulación'
    : m.type === 'sale'
      ? 'Salida por venta'
      : m.type === 'return'
        ? 'Devolución'
        : m.type;

export function HistoryView({ profile }: { profile: Profile | null }) {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState({ count: 0, revenue: 0, profit: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [movements, setMovements] = useState<Record<string, MovementRow[]>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  // Filtros
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sellerFilter, setSellerFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dispatchFilter, setDispatchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [historyPhone, setHistoryPhone] = useState('');
  const [waError, setWaError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [sellers, setSellers] = useState<{ id: string; name: string }[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  // Copia de cada comprobante reenviado al WhatsApp del dueño del negocio.
  const myWhatsapp = useMemo(() => normalizeArgPhone(loadBusiness().myWhatsapp), []);
  const [copyToMe, setCopyToMe] = useState(() => loadCopyToMe());

  const canAnnul = canAnnulSales(profile?.role);
  // Evita que una respuesta vieja pise a la del filtro actual.
  const requestRef = useRef(0);

  useEffect(() => {
    fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Búsqueda con debounce: no consulta en cada tecla.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  // Cualquier cambio de filtro vuelve a la primera página.
  useEffect(() => {
    setPage(0);
  }, [dateRange, customFrom, customTo, debouncedSearch, sellerFilter, paymentFilter, typeFilter, dispatchFilter, statusFilter]);

  useEffect(() => {
    fetchSalesHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customFrom, customTo, debouncedSearch, sellerFilter, paymentFilter, typeFilter, dispatchFilter, statusFilter, page]);

  const fetchProfiles = async () => {
    // RLS: admin/supervisor ven todos; el vendedor solo el propio.
    const { data } = await supabase.from('profiles').select('id, full_name').order('full_name');
    const rows = (data || []) as { id: string; full_name: string | null }[];
    setSellers(rows.map((p) => ({ id: p.id, name: p.full_name || 'Sin nombre' })));
    setProfileNames(Object.fromEntries(rows.map((p) => [p.id, p.full_name || 'Sin nombre'])));
  };

  const rangeBounds = () => {
    const now = new Date();
    if (dateRange === 'today') {
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: null as Date | null };
    }
    if (dateRange === 'week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      return { from: new Date(now.getFullYear(), now.getMonth(), diff), to: null as Date | null };
    }
    if (dateRange === 'month') {
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null as Date | null };
    }
    if (dateRange === 'custom') {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
      const to = customTo ? new Date(`${customTo}T23:59:59.999`) : null;
      return { from, to };
    }
    return { from: null, to: null };
  };

  const applyFilters = (
    query: any,
    f: { from: Date | null; to: Date | null; term: string; saleIds: string[] },
  ) => {
    let q = query;
    if (f.from) q = q.gte('created_at', f.from.toISOString());
    if (f.to) q = q.lte('created_at', f.to.toISOString());
    if (sellerFilter !== 'all') q = q.eq('user_id', sellerFilter);
    if (paymentFilter !== 'all') {
      // `not.isdistinct` equivale a (col = valor OR col IS NULL), sin usar `or`.
      q = paymentFilter === 'cash'
        ? q.not('payment_method', 'isdistinct', 'cash')
        : q.eq('payment_method', paymentFilter);
    }
    if (typeFilter !== 'all') q = q.eq('sale_type', typeFilter);
    if (dispatchFilter !== 'all') {
      q = dispatchFilter === 'pickup'
        ? q.not('dispatch_type', 'isdistinct', 'pickup')
        : q.eq('dispatch_type', dispatchFilter);
    }
    if (statusFilter !== 'all') {
      q = statusFilter === 'completed'
        ? q.not('status', 'isdistinct', 'completed')
        : q.eq('status', statusFilter);
    }
    if (f.term) {
      const parts = [
        `receipt_number.ilike.%${f.term}%`,
        `customer_name.ilike.%${f.term}%`,
        `customer_doc.ilike.%${f.term}%`,
      ];
      if (/^\d+([.,]\d{1,2})?$/.test(f.term)) {
        parts.push(`total_amount.eq.${f.term.replace(',', '.')}`);
      }
      if (f.saleIds.length > 0) parts.push(`id.in.(${f.saleIds.join(',')})`);
      q = q.or(parts.join(','));
    }
    return q;
  };

  // Productos: primero buscamos las ventas que contienen ese producto.
  const findSalesByProduct = async (term: string): Promise<string[]> => {
    if (!term) return [];
    const { data, error } = await supabase
      .from('sale_items')
      .select('sale_id, products!inner(name)')
      .ilike('products.name', `%${term}%`)
      .limit(100);
    if (error || !data) return [];
    return Array.from(new Set((data as any[]).map((r) => r.sale_id).filter(Boolean)));
  };

  const fetchSummary = async (f: { from: Date | null; to: Date | null; term: string; saleIds: string[] }, requestId: number) => {
    const { data, error } = await supabase.rpc('sales_history_summary', {
      p_from: f.from ? f.from.toISOString() : null,
      p_to: f.to ? f.to.toISOString() : null,
      p_user_id: sellerFilter === 'all' ? null : sellerFilter,
      p_payment: paymentFilter === 'all' ? null : paymentFilter,
      p_type: typeFilter === 'all' ? null : typeFilter,
      p_dispatch: dispatchFilter === 'all' ? null : dispatchFilter,
      p_status: statusFilter === 'all' ? null : statusFilter,
      p_search: f.term || null,
      p_sale_ids: f.saleIds.length > 0 ? f.saleIds : null,
    });

    if (!error && data && data.length > 0) {
      if (requestId !== requestRef.current) return;
      const row = data[0] as { ventas: number; facturacion: number; ganancia: number };
      setSummary({
        count: Number(row.ventas) || 0,
        revenue: Number(row.facturacion) || 0,
        profit: Number(row.ganancia) || 0,
      });
      return;
    }

    // Sin el SQL del historial: sumamos en el navegador (hasta el tope de la API).
    const { data: rows } = await applyFilters(
      supabase.from('sales').select('total_amount, profit_amount, status'),
      f,
    ).limit(1000);
    const valid = ((rows || []) as SaleRecord[]).filter((s) => statusOf(s) !== 'cancelled');
    if (requestId !== requestRef.current) return;
    setSummary({
      count: valid.length,
      revenue: valid.reduce((a, s) => a + Number(s.total_amount), 0),
      profit: valid.reduce((a, s) => a + Number(s.profit_amount), 0),
    });
  };

  const fetchSalesHistory = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError('');
    try {
      const { from, to } = rangeBounds();
      const term = sanitizeTerm(debouncedSearch);
      const saleIds = await findSalesByProduct(term);
      if (requestId !== requestRef.current) return;
      const filters = { from, to, term, saleIds };

      const { data, error, count } = await applyFilters(
        supabase.from('sales').select(SALES_SELECT, { count: 'exact' }),
        filters,
      )
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (error) throw error;
      if (requestId !== requestRef.current) return;
      setSales((data || []) as SaleRecord[]);
      setTotalCount(count || 0);
      await fetchSummary(filters, requestId);
    } catch (err: any) {
      if (requestId !== requestRef.current) return;
      console.error('Error fetching sales history:', err);
      setLoadError(err?.message || 'No se pudo cargar el historial.');
      setSales([]);
      setTotalCount(0);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  /** Trae todas las filas del filtro actual (para exportar sin el tope de la página). */
  const fetchAllFiltered = async (): Promise<SaleRecord[]> => {
    const { from, to } = rangeBounds();
    const term = sanitizeTerm(debouncedSearch);
    const saleIds = await findSalesByProduct(term);
    const filters = { from, to, term, saleIds };
    const all: SaleRecord[] = [];
    const chunk = 1000;
    for (let start = 0; start < 20000; start += chunk) {
      const { data, error } = await applyFilters(
        supabase.from('sales').select(SALES_SELECT),
        filters,
      )
        .order('created_at', { ascending: false })
        .range(start, start + chunk - 1);
      if (error) throw error;
      const rows = (data || []) as SaleRecord[];
      all.push(...rows);
      if (rows.length < chunk) break;
    }
    return all;
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const periodoLabel = () => {
    if (dateRange === 'today') return 'Hoy';
    if (dateRange === 'week') return 'Semana';
    if (dateRange === 'month') return 'Mes';
    if (dateRange === 'custom') return `${customFrom || 'inicio'} a ${customTo || 'hoy'}`;
    return 'Todo el historial';
  };

  /* ------------------------------ exportaciones ------------------------------ */

  /**
   * Evita bajar archivos vacíos: si el filtro no trae ventas, avisa y corta.
   * Es fácil exportar con el filtro en "Hoy" y creer que la app falló.
   */
  const hasRowsOrWarn = (rows: unknown[]) => {
    if (rows.length > 0) {
      setActionError('');
      return true;
    }
    setActionError('No hay ventas en el período elegido. Cambiá el filtro de fecha (por ejemplo a "Mes") y volvé a exportar.');
    return false;
  };

  const handleExportExcel = async () => {
    setExportOpen(false);
    try {
      const { exportVentasXlsx, barsByDay } = await import('../../lib/exportXlsx');
      const rows = await fetchAllFiltered();
      if (!hasRowsOrWarn(rows)) return;
      const periodo = periodoLabel();
      await exportVentasXlsx(
        'historial-ventas',
        periodo,
        rows.map((s) => ({
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
        { revenue: summary.revenue, profit: summary.profit },
        { title: `Ventas por día — ${periodo}`, bars: barsByDay(rows) }
      );
    } catch (err: any) {
      setActionError('No se pudo exportar: ' + (err?.message || err));
    }
  };

  const handleExportCsv = async () => {
    setExportOpen(false);
    try {
      const { downloadCsv, stampName, fmtMoney } = await import('../../lib/exportCsv');
      const rows = await fetchAllFiltered();
      if (!hasRowsOrWarn(rows)) return;
      const headers = ['Ticket', 'Fecha', 'Cliente', 'Vendedor', 'Pago', 'Despacho', 'Tipo', 'Estado', 'Cant. items', 'Total', 'Ganancia'];
      const body = rows.map((s) => [
        docOf(s),
        new Date(s.created_at).toLocaleString('es-AR'),
        s.customer_name || 'Consumidor final',
        s.profiles?.full_name || 'Vendedor',
        paymentLabel(s.payment_method),
        dispatchLabel(s.dispatch_type),
        s.sale_type === 'afip' ? 'ARCA' : 'Interno',
        statusOf(s) === 'cancelled' ? 'Anulada' : 'Completada',
        (s.sale_items || []).reduce((a, it) => a + Number(it.quantity), 0),
        fmtMoney(Number(s.total_amount)),
        fmtMoney(Number(s.profit_amount)),
      ]);
      downloadCsv(stampName('historial-ventas'), headers, body);
    } catch (err: any) {
      setActionError('No se pudo exportar el CSV: ' + (err?.message || err));
    }
  };

  const handleExportContador = async () => {
    setExportOpen(false);
    try {
      const { exportContadorXlsx, barsByPayment } = await import('../../lib/exportXlsx');
      const all = await fetchAllFiltered();
      if (!hasRowsOrWarn(all)) return;
      const periodo = periodoLabel();
      const rows = all.map((s) => {
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
    } catch (err: any) {
      setActionError('No se pudo exportar para el contador: ' + (err?.message || err));
    }
  };

  /** Arma los datos del listado en PDF (compartido por descarga e impresión). */
  const buildPdfPayload = async () => {
    const rows = await fetchAllFiltered();
    if (!hasRowsOrWarn(rows)) return null;
    const valid = rows.filter((s) => statusOf(s) !== 'cancelled');
    const annulled = rows.filter((s) => statusOf(s) === 'cancelled');
    const sum = (list: SaleRecord[], field: 'total_amount' | 'profit_amount') =>
      list.reduce((a, s) => a + Number(s[field] || 0), 0);
    return {
      periodo: periodoLabel(),
      rows: rows.map((s) => ({
        ticket: docOf(s),
        fecha: new Date(s.created_at).toLocaleString('es-AR'),
        cliente: s.customer_name,
        vendedor: s.profiles?.full_name || 'Vendedor',
        pago: paymentLabel(s.payment_method),
        estado: statusOf(s) === 'cancelled' ? 'Anulada' : 'Completada',
        total: Number(s.total_amount),
        ganancia: Number(s.profit_amount),
        anulada: statusOf(s) === 'cancelled',
      })),
      totals: {
        revenue: sum(valid, 'total_amount'),
        profit: sum(valid, 'profit_amount'),
        count: valid.length,
        cancelled: annulled.length,
        cancelledAmount: sum(annulled, 'total_amount'),
      },
    };
  };

  const handleExportPdf = async () => {
    setExportOpen(false);
    try {
      const { exportHistorialPdf } = await import('../../lib/historyPdf');
      const payload = await buildPdfPayload();
      if (!payload) return;
      exportHistorialPdf(payload.periodo, payload.rows, payload.totals);
    } catch (err: any) {
      setActionError('No se pudo generar el PDF: ' + (err?.message || err));
    }
  };

  const handlePrintPdf = async () => {
    setExportOpen(false);
    try {
      const { printHistorialPdf } = await import('../../lib/historyPdf');
      const payload = await buildPdfPayload();
      if (!payload) return;
      printHistorialPdf(payload.periodo, payload.rows, payload.totals);
    } catch (err: any) {
      setActionError('No se pudo preparar la impresión: ' + (err?.message || err));
    }
  };

  /** Arma el modelo de ticket (compartido por WhatsApp, impresión y PDF). */
  const toTicketData = (sale: SaleRecord): TicketData => {
    const raw = sale as any;
    const items = (sale.sale_items || []).map((it) => ({
      name: it.products?.name || 'Producto',
      quantity: Number(it.quantity) || 0,
      unitPrice: Number(it.unit_price) || 0,
      subtotal: Number(it.subtotal) || 0,
    }));

    const paymentDetails: string[] = [];
    if (sale.payment_method === 'transfer') {
      if (raw.transfer_bank) paymentDetails.push(`Banco origen: ${raw.transfer_bank}`);
      if (raw.transfer_account) paymentDetails.push(`Cuenta destino: ${raw.transfer_account}`);
      if (raw.transfer_ref) paymentDetails.push(`Comprobante: ${raw.transfer_ref}`);
    }
    if (sale.payment_method === 'card') {
      const det = [
        raw.card_type === 'credit' ? 'Crédito' : raw.card_type === 'debit' ? 'Débito' : null,
        raw.card_brand,
        raw.card_last4 ? `****${raw.card_last4}` : null,
      ].filter(Boolean).join(' · ');
      if (det) paymentDetails.push(`Tarjeta: ${det}`);
      if (raw.card_auth) paymentDetails.push(`Autorización: ${raw.card_auth}`);
      if (raw.card_type === 'credit' && raw.card_installments) paymentDetails.push(`Cuotas: ${raw.card_installments}`);
    }

    const discountAmount = Number(raw.discount_amount) || 0;

    return {
      saleId: sale.id,
      receiptNumber: sale.receipt_number || null,
      dateLabel: new Date(sale.created_at).toLocaleString('es-AR'),
      customerName: sale.customer_name || 'Cliente General',
      customerDoc: raw.customer_doc || null,
      customerIvaCond: raw.customer_iva_cond || null,
      saleType: sale.sale_type,
      paymentMethod: sale.payment_method || 'cash',
      dispatchType: sale.dispatch_type || 'pickup',
      paymentDetails,
      notes: raw.notes || null,
      items,
      subtotal: items.reduce((a, i) => a + i.subtotal, 0),
      discountLabel: discountAmount > 0 ? '' : null,
      discountAmount,
      deliveryFee: 0,
      deliveryFeeFree: sale.dispatch_type !== 'delivery',
      netAmount: Number(raw.net_amount) || 0,
      ivaAmount: Number(raw.iva_amount) || 0,
      totalAmount: Number(sale.total_amount) || 0,
      sellerName: sale.profiles?.full_name || 'Vendedor',
    };
  };

  const buildHistoryTicketText = (sale: SaleRecord) => buildTicketText(toTicketData(sale));

  /** Teléfono del envío: el que escribió el usuario o el guardado en la venta. */
  const phoneFor = (sale: SaleRecord) =>
    normalizeArgPhone(historyPhone.trim() ? historyPhone : (sale.customer_phone || ''));

  const handleHistoryWhatsApp = (sale: SaleRecord, mode: 'auto' | 'web' | 'universal' = 'auto') => {
    if (statusOf(sale) === 'cancelled') {
      setWaError('La venta está anulada: no se puede reenviar el comprobante.');
      return;
    }
    const cleanPhone = phoneFor(sale);
    if (!cleanPhone) {
      setWaError('Ingresá el número de WhatsApp (Ej: 5491123456789).');
      return;
    }
    if (!isValidPhone(cleanPhone)) {
      setWaError('Número incompleto. Usá 549 + área + número, sin 0, sin 15, sin +.');
      return;
    }

    const myPhone = normalizeArgPhone(loadBusiness().myWhatsapp);
    const copyPhone = copyToMe && isValidPhone(myPhone) ? myPhone : '';

    setWaError('');
    const result = sendTicketWhatsApp({
      toPhone: cleanPhone,
      text: buildHistoryTicketText(sale),
      copyPhone,
      mode,
    });

    if (!result.customerOpened) {
      setWaError('No se pudo abrir WhatsApp. Permití las ventanas emergentes o usá "Copiar".');
      return;
    }
    if (copyPhone && !result.copyOpened) {
      setWaError('Se abrió el chat del cliente, pero la copia a tu WhatsApp fue bloqueada. Permití las ventanas emergentes.');
    }
  };

  /**
   * Ticket en PDF. En el móvil abre la hoja de compartir del sistema (se elige
   * WhatsApp y el PDF viaja como documento). En escritorio se descarga.
   */
  const handleHistoryPdf = async (sale: SaleRecord) => {
    if (statusOf(sale) === 'cancelled') {
      setWaError('La venta está anulada: no se puede generar el comprobante para enviar.');
      return;
    }
    if (pdfBusyId) return;
    setPdfBusyId(sale.id);
    setWaError('');
    try {
      const data = toTicketData(sale);
      const file = ticketPdfFile(data);
      const outcome = await shareFile(file, {
        title: `Ticket ${sale.receipt_number || sale.id.slice(0, 8).toUpperCase()}`,
        text: `Comprobante ${sale.receipt_number || ''} - ${sale.customer_name}`,
      });

      if (outcome === 'downloaded') {
        setWaError('PDF descargado. Abrí WhatsApp y adjuntá el archivo.');
        const cleanPhone = phoneFor(sale);
        if (isValidPhone(cleanPhone)) {
          sendTicketWhatsApp({ toPhone: cleanPhone, text: buildHistoryTicketText(sale) });
        }
      } else if (outcome === 'unsupported') {
        downloadTicketPdf(data);
        setWaError('PDF descargado.');
      }
    } catch (e: any) {
      setWaError(`No se pudo generar el PDF: ${e?.message || e}`);
    } finally {
      setPdfBusyId(null);
    }
  };

  const handleHistoryCopy = async (sale: SaleRecord) => {
    if (statusOf(sale) === 'cancelled') {
      setWaError('La venta está anulada: no se puede copiar el comprobante.');
      return;
    }
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
        <div class="receipt-label"${statusOf(sale) === 'cancelled' ? ' style="color:#b91c1c"' : ''}>${statusOf(sale) === 'cancelled' ? 'ANULADA' : 'TICKET'}</div>
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

  const toggleDetail = async (sale: SaleRecord) => {
    if (expandedId === sale.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sale.id);
    setCancelTarget(null);
    if (movements[sale.id]) return;
    setDetailLoading(true);
    try {
      const { data } = await supabase
        .from('inventory_movements')
        .select('id, type, quantity, previous_quantity, new_quantity, reference_type, created_at, user_id')
        .in('reference_type', ['sale', 'sale_cancel'])
        .eq('reference_id', sale.id)
        .order('created_at', { ascending: true });
      setMovements((prev) => ({ ...prev, [sale.id]: (data || []) as MovementRow[] }));
    } catch {
      setMovements((prev) => ({ ...prev, [sale.id]: [] }));
    } finally {
      setDetailLoading(false);
    }
  };

  const openCancel = (sale: SaleRecord) => {
    setCancelTarget(sale.id);
    setCancelReason('');
    setActionError('');
    setExpandedId(null);
  };

  const handleCancelSale = async (sale: SaleRecord) => {
    if (statusOf(sale) === 'cancelled') return;
    const reason = cancelReason.trim();
    if (reason.length < 3) {
      setActionError('Escribí el motivo de la anulación (mínimo 3 caracteres).');
      return;
    }
    setCancellingId(sale.id);
    setActionError('');
    try {
      // Anulación transaccional: el RPC marca la venta y devuelve el stock
      // con movimientos en inventory_movements. Es el único mecanismo soportado
      // (evita el update manual + stock_movements legacy).
      let { error: rpcError } = await supabase.rpc('cancel_sale', {
        p_sale_id: sale.id,
        p_reason: reason,
      });
      let reasonSaved = true;

      // Si todavía no corrió supabase/historial_trazabilidad.sql, la RPC de
      // dos argumentos no existe: anulamos igual y avisamos que no se guardó.
      if (rpcError && /could not find the function|does not exist|schema cache/i.test(rpcError.message)) {
        const retry = await supabase.rpc('cancel_sale', { p_sale_id: sale.id });
        rpcError = retry.error;
        reasonSaved = false;
      }
      if (rpcError) throw rpcError;

      setSales((prev) => prev.map((s) => (s.id === sale.id
        ? {
            ...s,
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancelled_by: profile?.id ?? null,
            cancel_reason: reasonSaved ? reason : null,
          }
        : s)));
      setMovements((prev) => {
        const next = { ...prev };
        delete next[sale.id];
        return next;
      });
      setCancelTarget(null);
      setCancelReason('');
      window.dispatchEvent(new Event('dv:sale-completed'));
      await fetchSalesHistory();
      if (!reasonSaved) {
        setActionError('Venta anulada. El motivo no se guardó: falta correr supabase/historial_trazabilidad.sql en Supabase.');
      }
    } catch (err: any) {
      setActionError('Error al anular la venta: ' + (err?.message || err));
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5">
            Historial y Trazabilidad
            <ContextualTooltip tipKey="history-export" title="Exportar y filtrar">
              Usá los filtros para acotar por fecha, vendedor o pago. <strong>Exportar</strong> abre Excel, CSV, la versión para contador y el listado en PDF.
            </ContextualTooltip>
          </h1>
          <p className="text-[#64748b] dark:text-slate-400 text-sm font-medium">Comprobantes internos y facturas ARCA • clic en una fila para ver el detalle</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="bg-white dark:bg-white/5 rounded-xl shadow-sm border border-[#e2e8f0] dark:border-white/10 p-1 flex text-sm font-medium overflow-x-auto no-scrollbar max-w-full">
            {(['today', 'week', 'month', 'all', 'custom'] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                aria-pressed={dateRange === r}
                className={`px-3 md:px-4 py-2 rounded-lg transition-all text-xs md:text-sm whitespace-nowrap font-semibold ${dateRange === r ? 'bg-brand-500 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5'}`}
              >
                {r === 'today' ? 'Hoy' : r === 'week' ? 'Semana' : r === 'month' ? 'Mes' : r === 'all' ? 'Todo' : 'Fechas'}
              </button>
            ))}
          </div>
          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              title="Exportar el filtro actual"
              className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-bold shadow-card transition card-hover cursor-pointer"
            >
              <Download size={16} weight="bold" />
              Exportar
              <CaretDown size={14} weight="bold" className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 z-50 w-72 max-w-[calc(100vw-1.5rem)] origin-top-right bg-white dark:bg-[#1F1F1F] rounded-2xl shadow-xl border border-slate-200 dark:border-[#333333] p-2 space-y-1"
                >
                  <button
                    role="menuitem"
                    onClick={handleExportExcel}
                    title="Detalle completo en Excel, con resumen, anuladas en rojo y gráfico"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                  >
                    <FileXls size={16} className="text-emerald-600 shrink-0" />
                    <span>
                      <span className="block text-xs font-bold text-slate-800 dark:text-white">Excel (.xlsx)</span>
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400">Detalle + resumen + gráfico</span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={handleExportCsv}
                    title="Detalle plano en CSV, compatibles con Excel y Google Sheets"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                  >
                    <FileCsv size={16} className="text-teal-600 shrink-0" />
                    <span>
                      <span className="block text-xs font-bold text-slate-800 dark:text-white">CSV</span>
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400">Para Excel o Sheets</span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={handleExportContador}
                    title="Versión para contador: sin ganancia, con resumen y columnas fiscales"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                  >
                    <FileText size={16} className="text-blue-600 shrink-0" />
                    <span>
                      <span className="block text-xs font-bold text-slate-800 dark:text-white">Para contador (Excel)</span>
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400">Fiscal, sin ganancia</span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={handleExportPdf}
                    title="Listado de ventas en PDF para archivar o enviar"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                  >
                    <FilePdf size={16} className="text-red-600 shrink-0" />
                    <span>
                      <span className="block text-xs font-bold text-slate-800 dark:text-white">Listado (PDF)</span>
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400">Descarga directa</span>
                    </span>
                  </button>
                  <button
                    role="menuitem"
                    onClick={handlePrintPdf}
                    title="Abrir el listado y mandarlo a la impresora"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer text-left"
                  >
                    <Printer size={16} className="text-slate-500 shrink-0" />
                    <span>
                      <span className="block text-xs font-bold text-slate-800 dark:text-white">Imprimir</span>
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400">Abre el diálogo del navegador</span>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={fetchSalesHistory}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-[#10b981] hover:bg-emerald-600 text-white rounded-xl text-sm font-bold shadow-card transition card-hover cursor-pointer"
          >
            <ArrowsClockwise size={16} weight="bold" /> Actualizar
          </button>
        </div>
      </div>

      {/* Rango de fechas personalizado */}
      {dateRange === 'custom' && (
        <div className="glass-card rounded-2xl p-4 flex flex-wrap items-end gap-3">
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            Desde
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="mt-1 block px-3 py-2 border-2 border-[#e2e8f0] dark:border-white/10 rounded-xl text-sm font-semibold bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:border-[#0ea5e9]"
            />
          </label>
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            Hasta
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="mt-1 block px-3 py-2 border-2 border-[#e2e8f0] dark:border-white/10 rounded-xl text-sm font-semibold bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:border-[#0ea5e9]"
            />
          </label>
          <button
            onClick={() => { setCustomFrom(''); setCustomTo(''); }}
            className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
          >
            Borrar fechas
          </button>
        </div>
      )}

      {actionError && (
        <div className="rounded-2xl border-2 border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-4 py-3 flex items-start justify-between gap-3">
          <p className="text-sm font-bold text-red-700 dark:text-red-300">{actionError}</p>
          <button onClick={() => setActionError('')} className="text-red-500 hover:text-red-700 font-bold text-sm cursor-pointer shrink-0">
            Cerrar
          </button>
        </div>
      )}

      {/* KPIs del filtro */}
      <div data-tour="history-kpis" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Ventas (filtro)</p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-white tnum">{summary.count}</p>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Facturación</p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-white tnum">${summary.revenue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="glass-card rounded-2xl p-4">
          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Ganancia</p>
          <p className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 tnum">${summary.profit.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Filtros */}
      <div data-tour="history-filters" className="glass-card rounded-2xl p-4 space-y-3">
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
              onClick={() => { setSearch(''); setSellerFilter('all'); setPaymentFilter('all'); setTypeFilter('all'); setDispatchFilter('all'); setStatusFilter('all'); setDateRange('today'); setCustomFrom(''); setCustomTo(''); }}
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
              placeholder="Buscar #ticket, cliente, producto, DNI o monto…"
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
            <RoundedSelect value={sellerFilter} onChange={setSellerFilter} options={[{ value: 'all', label: 'Todos los vendedores' }, ...sellers.map((s) => ({ value: s.id, label: s.name }))]} />
          </div>
          <div className="flex-[1_1_150px] min-w-[140px]">
            <RoundedSelect value={paymentFilter} onChange={setPaymentFilter} options={[{ value: 'all', label: 'Todos los pagos' }, { value: 'cash', label: 'Efectivo' }, { value: 'transfer', label: 'Transferencia' }, { value: 'card', label: 'Tarjeta' }, { value: 'mercadopago', label: 'Mercado Pago' }]} />
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
      <div data-tour="history-table" id="history-table" className="glass-card rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/5 text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center justify-between">
          <span className="tnum">{loading ? 'Buscando...' : `${totalCount} resultado${totalCount === 1 ? '' : 's'}`}</span>
          {!loading && totalCount > 0 && <span className="hidden sm:inline">Clic en una fila para expandir ⤵</span>}
        </div>
        {loadError && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/30 text-xs font-bold text-red-700 dark:text-red-300">
            {loadError}
          </div>
        )}
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
        ) : totalCount === 0 ? (
          <div className="p-4 sm:p-8">
            <EmptyState
              icon={<MagnifyingGlass size={28} />}
              title="Sin ventas para este filtro"
              description="Probá ampliar el rango de fecha o limpiar los filtros."
              actionLabel="Ver todo el historial"
              onAction={() => { setSearch(''); setSellerFilter('all'); setPaymentFilter('all'); setTypeFilter('all'); setDispatchFilter('all'); setStatusFilter('all'); setDateRange('all'); setCustomFrom(''); setCustomTo(''); }}
            />
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
                    <th className="p-4 text-right sticky right-0 z-10 bg-slate-50 dark:bg-[#1A1A1A] shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)] dark:shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.5)]">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
                  {sales.map((s, rowIdx) => {
                    const st = statusOf(s);
                    const expanded = expandedId === s.id;
                    return (
                      <Fragment key={s.id}>
                        <tr
                          onClick={() => toggleDetail(s)}
                          style={{ animationDelay: `${Math.min(rowIdx, 10) * 30}ms` }}
                          className={`group animate-row hover:bg-sky-50 dark:hover:bg-sky-500/10 hover:shadow-[inset_3px_0_0_#0ea5e9] transition-all cursor-pointer ${st === 'cancelled' ? 'opacity-60' : ''} ${expanded ? 'bg-sky-50 dark:bg-sky-500/10' : ''}`}
                        >
                          <td className="p-4">
                            <span className="font-bold text-slate-800 tnum">{s.receipt_number ? `N° ${s.receipt_number}` : `#${s.id.slice(0, 8).toUpperCase()}`}</span>
                            <span className="block text-xs text-slate-400 font-medium tnum">{new Date(s.created_at).toLocaleString('es-AR')}</span>
                          </td>
                          <td className="p-4 font-bold text-slate-900 max-w-[220px] truncate">{s.customer_name}</td>
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
                          <td className="p-4 text-right whitespace-nowrap sticky right-0 z-10 bg-white dark:bg-[#18181B] shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.12)] dark:shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.5)] group-hover:bg-sky-50 dark:group-hover:bg-sky-500/10" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => toggleDetail(s)}
                              title="Ver detalle"
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold mr-2 cursor-pointer transition-all active:scale-90 ${expanded ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                            >
                              <Receipt size={14} /> <CaretDown size={13} weight="bold" className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                            {st !== 'cancelled' && canAnnul && (
                              <button
                                onClick={() => openCancel(s)}
                                disabled={cancellingId === s.id}
                                title="Anular venta y devolver stock"
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-500 hover:text-white text-red-600 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 transition-all active:scale-90"
                              >
                                <Prohibit size={14} /> Anular
                              </button>
                            )}
                          </td>
                        </tr>
                        {cancelTarget === s.id && (
                          <tr className="bg-red-50/80 dark:bg-red-500/10">
                            <td colSpan={7} className="p-0">
                              <div className="m-3 rounded-xl border-2 border-red-200 dark:border-red-500/30 bg-white dark:bg-[#1F1F1F] p-3 space-y-2">
                                <p className="text-xs font-extrabold text-red-700 dark:text-red-300">
                                  Anular {docOf(s)} · ${Number(s.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-[11px] font-semibold text-slate-500">
                                  Se devuelve el stock y la venta queda como anulada. El motivo queda registrado en la trazabilidad.
                                </p>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    value={cancelReason}
                                    onChange={(e) => setCancelReason(e.target.value)}
                                    placeholder="Motivo (ej: cliente devolvió, error de cobro)"
                                    autoFocus
                                    className="flex-1 px-3 py-2 border-2 border-red-200 dark:border-red-500/30 rounded-xl text-sm font-semibold bg-white dark:bg-white/5 dark:text-white focus:outline-none focus:border-red-400"
                                  />
                                  <div className="flex gap-2 shrink-0">
                                    <button
                                      onClick={() => { setCancelTarget(null); setCancelReason(''); }}
                                      className="px-3 py-2 rounded-xl bg-white dark:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white text-xs font-bold cursor-pointer"
                                    >
                                      Volver
                                    </button>
                                    <button
                                      onClick={() => handleCancelSale(s)}
                                      disabled={cancellingId === s.id || cancelReason.trim().length < 3}
                                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                                    >
                                      {cancellingId === s.id ? 'Anulando…' : 'Confirmar anulación'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        {expanded && (
                          <tr key={s.id + '-detail'} className="bg-slate-50/70">
                            <td colSpan={7} className="p-0">
                              <div className="detail-grid open">
                                <div className="detail-inner">
                              <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 space-y-3 m-4">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Trazabilidad • {s.receipt_number ? `Comprobante N° ${s.receipt_number}` : `Ticket #${s.id.slice(0, 8).toUpperCase()}`}</p>
                                {st === 'cancelled' && (
                                  <div className="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2">
                                    <p className="text-xs font-extrabold text-red-700 dark:text-red-300">Venta anulada</p>
                                    <p className="text-[11px] font-semibold text-red-700/80 dark:text-red-300/80">
                                      {s.cancelled_at ? new Date(s.cancelled_at).toLocaleString('es-AR') : 'Fecha no registrada'}
                                      {s.cancelled_by ? ` · ${profileNames[s.cancelled_by] || 'Usuario'}` : ''}
                                      {s.cancel_reason ? ` · Motivo: ${s.cancel_reason}` : ' · Sin motivo registrado'}
                                    </p>
                                  </div>
                                )}
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
                                  {s.customer_phone && (
                                    <span>Teléfono: <strong className="text-slate-900">{formatPhoneForDisplay(s.customer_phone)}</strong></span>
                                  )}
                                  <span>Ganancia est.: <strong className="text-teal-700 tnum">${Number(s.profit_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>
                                </div>
                                <div className="rounded-xl border border-slate-200 dark:border-[#333333] p-3 space-y-1.5">
                                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500">Movimientos de stock</p>
                                  {detailLoading && !movements[s.id] ? (
                                    <p className="text-xs text-slate-400">Cargando…</p>
                                  ) : (movements[s.id] || []).length === 0 ? (
                                    <p className="text-xs text-slate-400">Sin movimientos vinculados (venta anterior al registro de movimientos).</p>
                                  ) : (
                                    (movements[s.id] || []).map((m) => (
                                      <div key={m.id} className="flex justify-between items-start gap-2 text-[11px] font-semibold">
                                        <div className="min-w-0">
                                          <p className="text-slate-800 dark:text-slate-200">{movementLabel(m)}</p>
                                          <p className="text-slate-400">
                                            {new Date(m.created_at).toLocaleString('es-AR')}
                                            {m.user_id ? ` · ${profileNames[m.user_id] || 'Usuario'}` : ''}
                                            {m.previous_quantity != null && m.new_quantity != null
                                              ? ` · ${Number(m.previous_quantity)} → ${Number(m.new_quantity)}`
                                              : ''}
                                          </p>
                                        </div>
                                        <span className={`shrink-0 font-extrabold tnum ${Number(m.quantity) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                          {Number(m.quantity) > 0 ? `+${Number(m.quantity)}` : Number(m.quantity)}
                                        </span>
                                      </div>
                                    ))
                                  )}
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
                                      placeholder={s.customer_phone ? formatPhoneForDisplay(s.customer_phone) : '5491123456789'}
                                      className="flex-1 px-3 py-2 border-2 border-[#e2e8f0] rounded-xl text-sm font-bold bg-white tnum focus:outline-none focus:border-emerald-500 transition"
                                    />
                                    <div className="flex gap-2 flex-wrap">
                                      <button
                                        onClick={() => handleHistoryWhatsApp(s)}
                                        disabled={st === 'cancelled'}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-md transition active:scale-95 whitespace-nowrap"
                                      >
                                        <WhatsappLogo size={15} weight="bold" /> WhatsApp
                                      </button>
                                      <button
                                        onClick={() => handleHistoryPdf(s)}
                                        disabled={!!pdfBusyId || st === 'cancelled'}
                                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition active:scale-95 whitespace-nowrap"
                                      >
                                        {pdfBusyId === s.id ? <SpinnerGap size={14} className="animate-spin" /> : <FilePdf size={14} weight="bold" />}
                                        PDF
                                      </button>
                                      <button
                                        onClick={() => handleHistoryCopy(s)}
                                        disabled={st === 'cancelled'}
                                        className="px-4 py-2 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed border border-slate-300 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition active:scale-95 whitespace-nowrap"
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
                                  {/* Número destino real (normalizado) */}
                                  {phoneFor(s) && isValidPhone(phoneFor(s)) && (
                                    <p className="text-[11px] font-semibold text-slate-600">
                                      Se va a enviar a <span className="font-mono font-bold text-emerald-700">{formatPhoneForDisplay(phoneFor(s))}</span>
                                      {!historyPhone.trim() && s.customer_phone && (
                                        <span className="text-slate-500"> (teléfono guardado en la venta)</span>
                                      )}
                                    </p>
                                  )}
                                  {!isMobileDevice() && (
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                      <button
                                        onClick={() => handleHistoryWhatsApp(s, 'universal')}
                                        className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer text-left flex items-center gap-1"
                                      >
                                        <Desktop size={12} /> ¿Tenés WhatsApp Desktop? Abrir la app
                                      </button>
                                      <button
                                        onClick={openWhatsAppWebLogin}
                                        className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer text-left flex items-center gap-1"
                                      >
                                        <SignIn size={12} /> Iniciar sesión en WhatsApp Web
                                      </button>
                                    </div>
                                  )}
                                  <label className={`flex items-center gap-2 ${myWhatsapp ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                                    <input
                                      type="checkbox"
                                      checked={copyToMe && !!myWhatsapp}
                                      disabled={!myWhatsapp}
                                      onChange={(e) => { setCopyToMe(e.target.checked); saveCopyToMe(e.target.checked); }}
                                      className="w-3.5 h-3.5 accent-emerald-600 shrink-0"
                                    />
                                    <span className="text-[11px] font-bold text-slate-700">
                                      Recibir copia en mi WhatsApp
                                      {myWhatsapp
                                        ? <span className="font-mono font-semibold text-slate-500"> ({myWhatsapp})</span>
                                        : <span className="text-amber-600"> — configurá tu número en Configuración</span>}
                                    </span>
                                  </label>
                                  {waError
                                    ? <p className="text-[11px] font-bold text-red-600">{waError}</p>
                                    : (
                                      <p className="text-[11px] text-slate-500 font-medium">
                                        {isMobileDevice()
                                          ? 'Se abre WhatsApp con el ticket listo para enviar.'
                                          : 'En la PC se abre WhatsApp Web: la primera vez tenés que iniciar sesión (web.whatsapp.com). Podés pegar el ticket con "Copiar" si preferís.'}
                                      </p>
                                    )}
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
              <span className="tnum">{totalCount} ventas • pág. {page + 1}/{totalPages}</span>
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
