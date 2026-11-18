import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile, PurchaseOrder, PurchaseOrderItem, ReplenishmentRow, Supplier } from '../../types';
import { WhatsappLogo, Package, X, PencilSimple, MagnifyingGlass, Plus, Trash } from '@phosphor-icons/react';
import { Loader2 } from 'lucide-react';
import { RoundedSelect } from '../ui/RoundedSelect';
import { buildPurchaseOrderText } from '../../lib/purchaseOrderText';
import {
  buildUpdatePayload,
  costVariance,
  draftLineTotal,
  draftTotal,
  validateDraftLines,
  type DraftUnit,
} from '../../lib/purchaseOrderDraft';
import { lineShortage, shortageSummary } from '../../lib/purchaseReceive';
import { defaultMode, netSuggested, targetReplenish } from '../../lib/replenishment';

interface Props {
  profile?: Profile | null;
  showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
  setActiveTab?: (tab: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  sent: 'bg-sky-100 text-sky-700',
  received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

type RowSel = { checked: boolean; mode: 'replenish' | 'suggested' | 'manual'; manual: string };

const SORT_OPTIONS = [
  { value: 'urgency', label: 'Urgencia' },
  { value: 'cost', label: 'Costo est.' },
  { value: 'name', label: 'Nombre' },
];

const SORT_LABEL: Record<string, string> = {
  urgency: 'Urgencia',
  cost: 'Costo est.',
  name: 'Nombre',
};

// Números cortos y con coma decimal (0,23 en vez de 0.2333).
const numFmt = (n: number, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString('es-AR', { maximumFractionDigits: digits }) : '—';

type PoPrefs = {
  window?: number;
  review?: number;
  z?: number;
  sort?: 'urgency' | 'cost' | 'name';
  filter?: 'all' | 'critical' | 'reorder' | 'empty';
};

const loadPoPrefs = (): PoPrefs => {
  try { return JSON.parse(localStorage.getItem('dv-po-prefs') || '{}'); } catch { return {}; }
};

const savePoPrefs = (patch: PoPrefs) => {
  try { localStorage.setItem('dv-po-prefs', JSON.stringify({ ...loadPoPrefs(), ...patch })); } catch { /* noop */ }
};

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, min), max) : def;
};

// Redondeo según unidad: los productos por unidad no admiten fracciones.
const roundQtyForUnit = (unit: string, n: number) =>
  unit === 'kg' ? Math.round(n * 100) / 100 : Math.ceil(n);

const qtyFromSel = (r: ReplenishmentRow, sel?: RowSel) => {
  if (!sel) return 0;
  const raw =
    sel.mode === 'manual'
      ? Number(sel.manual)
      : sel.mode === 'replenish'
        ? r.replenish
        : targetReplenish(r);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

export function PurchaseOrdersView({ profile, showToast, setActiveTab }: Props) {
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) showToast(msg, kind);
  };

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'sent' | 'received' | 'cancelled'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<PurchaseOrderItem[]>([]);
  const [editAddId, setEditAddId] = useState('');
  // Catálogo mínimo para editar: nombre, unidad, costo sugerido y si está activo.
  type CatalogEntry = { name: string; unit: DraftUnit; cost: number; active: boolean };
  const [catalog, setCatalog] = useState<Record<string, CatalogEntry>>({});

  // Generar orden
  const [showGenerate, setShowGenerate] = useState(false);
  const [replenishment, setReplenishment] = useState<ReplenishmentRow[]>([]);
  const [loadingRepl, setLoadingRepl] = useState(false);
  // Parámetros recordados entre sesiones (ventana, revisión, nivel, orden y filtro)
  const prefs = useMemo(() => loadPoPrefs(), []);
  const [replWindow, setReplWindow] = useState(() => clampInt(prefs.window, 30, 1, 365));
  const [replReview, setReplReview] = useState(() => clampInt(prefs.review, 30, 1, 180));
  const [replZ, setReplZ] = useState(() => (prefs.z === 1.28 || prefs.z === 2.33 ? prefs.z : 1.65));
  // Texto editable de los días: deja borrar mientras se escribe y valida al salir del campo.
  const [replWindowText, setReplWindowText] = useState(() => String(clampInt(prefs.window, 30, 1, 365)));
  const [replReviewText, setReplReviewText] = useState(() => String(clampInt(prefs.review, 30, 1, 180)));
  const [selected, setSelected] = useState<Record<string, RowSel>>({});
  const [generating, setGenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [replSearch, setReplSearch] = useState('');
  const [replSort, setReplSort] = useState<'urgency' | 'cost' | 'name'>(() => (prefs.sort === 'cost' || prefs.sort === 'name' ? prefs.sort : 'urgency'));
  const [replFilter, setReplFilter] = useState<'all' | 'critical' | 'reorder' | 'empty'>(() => (prefs.filter && ['all', 'critical', 'reorder', 'empty'].includes(prefs.filter) ? prefs.filter : 'all'));

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [costMap, setCostMap] = useState<Record<string, number>>({});
  const [unitMap, setUnitMap] = useState<Record<string, string>>({});

  const canManage = profile?.role === 'admin' || profile?.role === 'supervisor';

  // Los días se editan como texto para poder borrar; se validan al salir del campo.
  const commitWindow = () => {
    const n = Math.min(Math.max(Math.round(Number(replWindowText) || 30), 1), 365);
    setReplWindow(n);
    setReplWindowText(String(n));
    savePoPrefs({ window: n });
  };
  const commitReview = () => {
    const n = Math.min(Math.max(Math.round(Number(replReviewText) || 30), 1), 180);
    setReplReview(n);
    setReplReviewText(String(n));
    savePoPrefs({ review: n });
  };
  const serviceHint =
    replZ >= 2.33
      ? 'Casi nunca te quedás sin stock. Guarda más stock de seguridad (más plata inmovilizada).'
      : replZ >= 1.65
        ? 'Equilibrio recomendado: cubre faltantes en 95 de cada 100 períodos.'
        : 'Menos stock guardado, pero más riesgo de quedarte sin stock.';

  const closeGenerate = () => {
    setShowGenerate(false);
    setShowConfirm(false);
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const mapped: PurchaseOrder[] = (data || []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        supplier_id: o.supplier_id,
        supplier_name: o.supplier_name,
        status: o.status,
        notes: o.notes,
        total_cost: Number(o.total_cost || 0),
        created_at: o.created_at,
        sent_at: o.sent_at,
        received_at: o.received_at,
        receipt_id: o.receipt_id,
        items_count: (o.purchase_order_items || []).length,
        total_qty: (o.purchase_order_items || []).reduce((a: number, it: any) => a + Number(it.quantity), 0),
        items: (o.purchase_order_items || []).map((it: any) => ({
          id: it.id,
          order_id: it.order_id,
          product_id: it.product_id,
          product_name: it.products?.name,
          quantity: Number(it.quantity),
          qty_replenish: Number(it.qty_replenish || 0),
          qty_suggested: Number(it.qty_suggested || 0),
          unit_cost: it.unit_cost != null ? Number(it.unit_cost) : null,
          received_quantity: Number(it.received_quantity || 0),
        })),
      }));
      // hydrate product names
      const productIds = Array.from(new Set(mapped.flatMap((o) => (o.items || []).map((i) => i.product_id))));
      if (productIds.length) {
        const { data: prods } = await supabase.from('products').select('id, name').in('id', productIds);
        const nameMap = new Map((prods || []).map((p: any) => [p.id, p.name]));
        mapped.forEach((o) => (o.items || []).forEach((i) => { if (!i.product_name) i.product_name = nameMap.get(i.product_id) || 'Producto'; }));
      }
      // Total real del ingreso vinculado, para comparar contra el estimado.
      const receiptIds = Array.from(new Set(mapped.map((o) => o.receipt_id).filter(Boolean))) as string[];
      if (receiptIds.length) {
        const { data: receipts } = await supabase
          .from('stock_receipts')
          .select('id, receipt_number, total_cost')
          .in('id', receiptIds);
        const receiptMap = new Map((receipts || []).map((r: any) => [r.id, r]));
        mapped.forEach((o) => {
          const r = o.receipt_id ? receiptMap.get(o.receipt_id) : null;
          o.receipt_number = r?.receipt_number ?? null;
          o.receipt_total = r && r.total_cost != null ? Number(r.total_cost) : null;
        });
      }
      setOrders(mapped);
    } catch (e: any) {
      notify('Error cargando órdenes: ' + (e?.message || e), 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const { data } = await supabase.from('suppliers').select('id, name, phone, notes, is_active').eq('is_active', true).order('name');
      setSuppliers((data || []) as Supplier[]);
    } catch { /* noop */ }
  };

  const fetchCatalog = async () => {
    try {
      const { data } = await supabase
        .from('products')
        .select('id, name, unit_type, cost_price, is_active')
        .order('name');
      const map: Record<string, CatalogEntry> = {};
      (data || []).forEach((p: any) => {
        map[p.id] = {
          name: p.name,
          unit: p.unit_type === 'kg' ? 'kg' : 'unit',
          cost: Number(p.cost_price || 0),
          active: p.is_active !== false,
        };
      });
      setCatalog(map);
    } catch { /* noop */ }
  };

  useEffect(() => {
    fetchOrders();
    fetchSuppliers();
    fetchCatalog();
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return orders;
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  // Cantidad ya pedida y todavía no recibida (borradores y enviadas).
  const pendingByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    orders.forEach((o) => {
      if (o.status !== 'draft' && o.status !== 'sent') return;
      (o.items || []).forEach((it) => {
        m[it.product_id] = (m[it.product_id] || 0) + Number(it.quantity || 0);
      });
    });
    return m;
  }, [orders]);

  // Sugerido neto: objetivo/demanda menos lo que ya está pedido.
  const suggestedNet = useCallback(
    (r: ReplenishmentRow) => netSuggested(r, pendingByProduct[r.product_id] || 0),
    [pendingByProduct],
  );

  // Cantidad efectiva de una fila: al sugerido se le descuenta lo ya pedido.
  const qtyNet = useCallback(
    (r: ReplenishmentRow, sel?: RowSel) => {
      const raw = qtyFromSel(r, sel);
      return Math.max(sel?.mode === 'suggested' ? raw - (pendingByProduct[r.product_id] || 0) : raw, 0);
    },
    [pendingByProduct],
  );

  const fetchReplenishment = async () => {
    setLoadingRepl(true);
    try {
      const { data, error } = await supabase.rpc('compute_replenishment', {
        p_window_days: replWindow,
        p_review_period: replReview,
        p_service_z: replZ,
      });
      if (error) throw error;
      const { data: costs } = await supabase.from('products').select('id, cost_price, unit_type');
      setCostMap(Object.fromEntries((costs || []).map((c: any) => [c.id, Number(c.cost_price || 0)])));
      setUnitMap(Object.fromEntries((costs || []).map((c: any) => [c.id, c.unit_type === 'kg' ? 'kg' : 'unit'])));
      const rows = (data || []) as any[];
      const mapped: ReplenishmentRow[] = rows.map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        supplier_id: r.supplier_id,
        stock: Number(r.stock),
        min_stock: Number(r.min_stock),
        avg_daily: Number(r.avg_daily),
        sigma_daily: Number(r.sigma_daily),
        lead_time_days: Number(r.lead_time_days),
        safety_stock: Number(r.safety_stock),
        rop: Number(r.rop),
        order_up_to: Number(r.order_up_to),
        suggested: Number(r.suggested),
        replenish: Number(r.replenish),
        has_history: !!r.has_history,
      }));
      setReplenishment(mapped);
      // Conserva lo ya elegido al cambiar parámetros; solo inicializa lo nuevo.
      setSelected((prev) => {
        const init: Record<string, RowSel> = {};
        mapped.forEach((r) => {
          const id = r.product_id;
          const target = targetReplenish(r);
          const old = prev[id];
          if (old) {
            init[id] = target > 0 || old.mode === 'manual' ? old : { ...old, checked: false };
          } else if (target > 0) {
            init[id] = { checked: true, mode: defaultMode(r), manual: String(target) };
          } else {
            init[id] = { checked: false, mode: 'replenish', manual: '' };
          }
        });
        return init;
      });
    } catch (e: any) {
      notify('Error calculando demanda: ' + (e?.message || e), 'error');
    } finally {
      setLoadingRepl(false);
    }
  };

  useEffect(() => {
    if (showGenerate) fetchReplenishment();
  }, [showGenerate, replWindow, replReview, replZ]);

  const selectedItems = useMemo(() => {
    return replenishment
      .filter((r) => selected[r.product_id]?.checked)
      .map((r) => ({
        row: r,
        qty: roundQtyForUnit(unitMap[r.product_id] || 'unit', qtyNet(r, selected[r.product_id])),
      }))
      .filter((x) => x.qty > 0);
  }, [replenishment, selected, unitMap, qtyNet]);

  const replFiltered = useMemo(() => {
    let list = replenishment;
    if (replSearch.trim()) {
      const q = replSearch.toLowerCase();
      list = list.filter((r) => r.product_name.toLowerCase().includes(q));
    }
    if (replFilter === 'critical') {
      list = list.filter((r) => r.stock <= r.min_stock);
    } else if (replFilter === 'reorder') {
      list = list.filter((r) => suggestedNet(r) > 0 || r.replenish > 0);
    } else if (replFilter === 'empty') {
      list = list.filter((r) => r.stock <= 0);
    }
    // Cobertura en días: cuánto dura el stock con la demanda actual.
    const coverage = (r: ReplenishmentRow) => (r.avg_daily > 0 ? r.stock / r.avg_daily : Number.POSITIVE_INFINITY);
    return [...list].sort((a, b) => {
      if (replSort === 'name') return a.product_name.localeCompare(b.product_name);
      if (replSort === 'cost') {
        const ca = suggestedNet(a) * (costMap[a.product_id] || 0);
        const cb = suggestedNet(b) * (costMap[b.product_id] || 0);
        return cb - ca;
      }
      // Urgencia: días de cobertura menos días de entrega (negativo = llega tarde).
      const ua = coverage(a) - a.lead_time_days;
      const ub = coverage(b) - b.lead_time_days;
      return ua - ub || a.product_name.localeCompare(b.product_name);
    });
  }, [replenishment, replSearch, replFilter, replSort, costMap, suggestedNet]);

  const summaryGroups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; items: number; total: number }>();
    selectedItems.forEach((x) => {
      const key = x.row.supplier_id || 'none';
      const found = m.get(key);
      const total = x.qty * (costMap[x.row.product_id] || 0);
      if (found) {
        found.items += 1;
        found.total += total;
      } else {
        m.set(key, {
          key,
          name: key === 'none' ? 'Sin proveedor' : suppliers.find((s) => s.id === key)?.name || 'Proveedor',
          items: 1,
          total,
        });
      }
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedItems, costMap, suppliers]);

  const handleGenerate = async () => {
    if (selectedItems.length === 0) { notify('Seleccioná al menos un producto.', 'warning'); return; }
    setGenerating(true);
    try {
      // group by supplier
      const groups = new Map<string, typeof selectedItems>();
      selectedItems.forEach((it) => {
        const key = it.row.supplier_id || 'sin-proveedor';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(it);
      });
      let created = 0;
      for (const [key, items] of groups) {
        const sup = suppliers.find((s) => s.id === key);
        const payload = items.map((it) => ({
          product_id: it.row.product_id,
          quantity: it.qty,
          qty_replenish: it.row.replenish,
          qty_suggested: targetReplenish(it.row),
          // Se congela el costo del momento: si el proveedor cambia el precio
          // después, la orden conserva lo que se acordó al generarla.
          unit_cost: costMap[it.row.product_id] ?? null,
        }));
        const { error } = await supabase.rpc('create_purchase_order', {
          p_supplier_id: key === 'sin-proveedor' ? null : key,
          p_supplier_name: sup?.name || 'Sin proveedor',
          p_notes: null,
          p_items: payload,
        });
        if (error) throw error;
        created++;
      }
      notify(`Se generaron ${created} orden(es) de compra.`, 'success');
      closeGenerate();
      fetchOrders();
    } catch (e: any) {
      notify('Error generando órdenes: ' + (e?.message || e), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async (order: PurchaseOrder) => {
    if (!order.items || order.items.length === 0) return;
    try {
      const { error } = await supabase.rpc('send_purchase_order', { p_order_id: order.id });
      if (error) throw error;
      const sup = suppliers.find((s) => s.id === order.supplier_id);
      const phone = sup?.phone?.replace(/\D/g, '') || '';
      const msg = encodeURIComponent(await buildOrderMessage(order));
      window.open(phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
      notify('Orden enviada.', 'success');
      fetchOrders();
    } catch (e: any) {
      notify('Error enviando: ' + (e?.message || e), 'error');
    }
  };

  /**
   * Arma el texto de la orden. El costo congelado (`unit_cost`) manda; si la
   * orden no lo tiene, se usa el costo actual del producto. Ver
   * `purchaseOrderText.ts` para el formato y la nota de "estimado".
   */
  const buildOrderMessage = async (order: PurchaseOrder) => {
    const items = order.items || [];
    const ids = Array.from(new Set(items.map((i) => i.product_id)));
    const prodMap: Record<string, { cost: number; unit: string }> = {};
    if (ids.length > 0) {
      const { data } = await supabase
        .from('products')
        .select('id, cost_price, unit_type')
        .in('id', ids);
      (data || []).forEach((p: any) => {
        prodMap[p.id] = {
          cost: Number(p.cost_price || 0),
          unit: p.unit_type === 'kg' ? 'kg' : 'un',
        };
      });
    }

    return buildPurchaseOrderText({
      id: order.id,
      orderNumber: order.order_number,
      supplierName: order.supplier_name,
      createdAt: order.created_at,
      notes: order.notes,
      items: items.map((it) => {
        const p = prodMap[it.product_id];
        return {
          name: it.product_name || 'Producto',
          quantity: Number(it.quantity) || 0,
          unit: p?.unit || 'un',
          unitCost: it.unit_cost,
          fallbackCost: p?.cost ?? 0,
        };
      }),
    });
  };

  const handleReceive = async (order: PurchaseOrder) => {
    try {
      const { error } = await supabase.rpc('convert_purchase_order_to_receipt', { p_order_id: order.id });
      if (error) throw error;
      notify('Ingreso creado. Andá a "Ingreso Mercadería" para confirmar.', 'success');
      if (setActiveTab) setActiveTab('intake');
    } catch (e: any) {
      notify('Error creando ingreso: ' + (e?.message || e), 'error');
    }
  };

  const handleCancel = async (order: PurchaseOrder) => {
    if (!confirm(`¿Cancelar la orden ${order.order_number}?`)) return;
    try {
      const { error } = await supabase.rpc('cancel_purchase_order', { p_order_id: order.id });
      if (error) throw error;
      notify('Orden cancelada.', 'success');
      fetchOrders();
    } catch (e: any) {
      notify('Error cancelando: ' + (e?.message || e), 'error');
    }
  };

  const unitOf = (productId: string): DraftUnit => catalog[productId]?.unit || 'unit';

  const startEdit = (order: PurchaseOrder) => {
    // Abre el detalle: sin esto el editor quedaba oculto al tocar "Editar".
    setExpandedId(order.id);
    setEditingId(order.id);
    setEditAddId('');
    setEditItems((order.items || []).map((i) => ({ ...i })));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAddId('');
    setEditItems([]);
  };

  const patchEditItem = (idx: number, patch: Partial<PurchaseOrderItem>) =>
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeEditItem = (idx: number) =>
    setEditItems((prev) => prev.filter((_, i) => i !== idx));

  const addEditItem = () => {
    const product = catalog[editAddId];
    if (!product) return;
    setEditItems((prev) => [
      ...prev,
      {
        id: `new-${editAddId}`,
        order_id: editingId || '',
        product_id: editAddId,
        product_name: product.name,
        quantity: 1,
        qty_replenish: 0,
        qty_suggested: 0,
        unit_cost: product.cost > 0 ? product.cost : null,
        received_quantity: 0,
      },
    ]);
    setEditAddId('');
  };

  const saveEdit = async (order: PurchaseOrder) => {
    const invalid = validateDraftLines(editItems, unitOf);
    if (invalid) { notify(invalid, 'warning'); return; }
    try {
      const { error } = await supabase.rpc('update_purchase_order', {
        p_order_id: order.id,
        p_items: buildUpdatePayload(editItems),
      });
      if (error) throw error;
      notify('Orden actualizada.', 'success');
      cancelEdit();
      fetchOrders();
    } catch (e: any) {
      notify('Error actualizando: ' + (e?.message || e), 'error');
    }
  };

  // Productos activos que todavía no están en el borrador (para "Agregar").
  const editProductOptions = useMemo(
    () => Object.entries(catalog)
      .filter(([id, p]) => p.active && !editItems.some((it) => it.product_id === id))
      .map(([id, p]) => ({ value: id, label: p.name })),
    [catalog, editItems],
  );

  const ACCENT: Record<string, string> = {
  draft: 'border-l-slate-400',
  sent: 'border-l-sky-500',
  received: 'border-l-emerald-500',
  cancelled: 'border-l-red-400',
};

const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Cantidades: sin decimales cuando son enteras (5, no 5,00).
const fmtQty = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

const relDate = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff <= 0) return 'hoy';
  if (diff === 1) return 'ayer';
  if (diff < 7) return `hace ${diff} dias`;
  return d.toLocaleDateString('es-AR');
};

const DemandBar = ({ stock, rop, target }: { stock: number; rop: number; target: number }) => {
  const max = Math.max(target, stock, 1);
  const pctStock = Math.min((stock / max) * 100, 100);
  const pctRop = Math.min((rop / max) * 100, 100);
  const pctTarget = Math.min((target / max) * 100, 100);
  return (
    <div className="relative h-1.5 w-full bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden mt-1.5" title={`Stock ${stock} | ROP ${rop} | Objetivo ${target}`}>
      <div className="absolute top-0 left-0 h-full bg-emerald-400/50 rounded-full" style={{ width: `${pctTarget}%` }} />
      <div className="absolute top-0 left-0 h-full bg-amber-400/70 rounded-full" style={{ width: `${pctRop}%` }} />
      <div className="absolute top-0 left-0 h-full bg-slate-700 dark:bg-slate-300 rounded-full" style={{ width: `${pctStock}%` }} />
    </div>
  );
};

  const setRow = (id: string, patch: Partial<RowSel>) =>
    setSelected((prev) => {
      const base: RowSel = prev[id] ?? { checked: false, mode: 'replenish', manual: '' };
      return { ...prev, [id]: { ...base, ...patch } };
    });

  const setGroupChecked = (rows: ReplenishmentRow[], checked: boolean) =>
    setSelected((prev) => {
      const next = { ...prev };
      rows.forEach((r) => {
        const base = prev[r.product_id] ?? { checked: false, mode: 'replenish', manual: '' };
        next[r.product_id] = { ...base, checked };
      });
      return next;
    });

  // Aplica el modo solo a lo que se ve (respeta búsqueda y filtro).
  const setModeAll = (mode: 'replenish' | 'suggested') =>
    setSelected((prev) => {
      const next = { ...prev };
      replFiltered.forEach((r) => {
        const base = prev[r.product_id] ?? { checked: false, mode: 'replenish', manual: '' };
        next[r.product_id] = { ...base, mode };
      });
      return next;
    });

  // Marca solo los que necesitan pedido y desmarca el resto.
  const selectNeeded = () =>
    setSelected((prev) => {
      const next = { ...prev };
      replenishment.forEach((r) => {
        const base = prev[r.product_id] ?? { checked: false, mode: 'replenish', manual: '' };
        next[r.product_id] = { ...base, checked: suggestedNet(r) > 0 || r.replenish > 0 };
      });
      return next;
    });

  const qtyOf = (r: ReplenishmentRow) => {
    const sel = selected[r.product_id];
    return roundQtyForUnit(unitMap[r.product_id] || 'unit', qtyNet(r, sel));
  };

  const groupedRows = useMemo(() => {
    const m = new Map<string, ReplenishmentRow[]>();
    replFiltered.forEach((r) => {
      const k = r.supplier_id || 'none';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    return Array.from(m.entries())
      .map(([key, rows]) => ({
        key,
        name: key === 'none' ? 'Sin proveedor' : suppliers.find((s) => s.id === key)?.name || 'Proveedor',
        rows,
      }))
      .sort((a, b) => Number(a.key === 'none') - Number(b.key === 'none') || a.name.localeCompare(b.name));
  }, [replFiltered, suppliers]);

  const selectedSupplierCount = new Set(selectedItems.map((x) => x.row.supplier_id || 'none')).size;
  const estCost = selectedItems.reduce((a, x) => a + x.qty * (costMap[x.row.product_id] || 0), 0);
  const noCostCount = selectedItems.filter((x) => !costMap[x.row.product_id]).length;

  const counts = {
    all: orders.length,
    draft: orders.filter((o) => o.status === 'draft').length,
    sent: orders.filter((o) => o.status === 'sent').length,
    received: orders.filter((o) => o.status === 'received').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
  };
  const pendingValue = orders
    .filter((o) => o.status === 'draft' || o.status === 'sent')
    .reduce((a, o) => a + o.total_cost, 0);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
      <div data-tour="purchaseorders-header" className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <Package className="text-emerald-600" size={22} /> Órdenes de compra
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            Pedidos a proveedores según el stock objetivo y la demanda de ventas. Se crea una orden por proveedor.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowGenerate(true)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition active:scale-95 cursor-pointer shadow-sm flex items-center gap-2"
          >
            <Plus size={16} weight="bold" /> Generar orden
          </button>
        )}
      </div>

      <div data-tour="purchaseorders-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Borradores', value: String(counts.draft), sub: 'sin enviar al proveedor', tone: 'text-slate-800 dark:text-slate-200' },
          { label: 'Enviadas', value: String(counts.sent), sub: 'pendientes de entrega', tone: 'text-sky-700 dark:text-sky-300' },
          { label: 'Recibidas', value: String(counts.received), sub: 'ingresadas al stock', tone: 'text-emerald-700 dark:text-emerald-300' },
          { label: 'Valor pendiente', value: `$${fmt(pendingValue)}`, sub: 'borradores + enviadas', tone: 'text-slate-900 dark:text-white' },
        ].map((k) => (
          <div key={k.label} className="p-3 rounded-2xl bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333] shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{k.label}</p>
            <p className={`text-lg font-extrabold tnum mt-0.5 ${k.tone}`}>{k.value}</p>
            <p className="text-[10px] text-slate-400 dark:text-zinc-500">{k.sub}</p>
          </div>
        ))}
      </div>

      <div data-tour="purchaseorders-filters" className="flex gap-1 overflow-x-auto p-1 rounded-xl bg-slate-100 dark:bg-white/5 w-fit max-w-full">
        {(['all', 'draft', 'sent', 'received', 'cancelled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
              statusFilter === f
                ? 'bg-white text-slate-900 shadow-sm dark:bg-emerald-600 dark:text-white'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {f === 'all' ? 'Todas' : STATUS_LABEL[f]}
            <span className="tnum text-[10px] opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin" size={24} /></div>
      ) : filtered.length === 0 ? (
        <div data-tour="purchaseorders-list" className="p-10 text-center rounded-2xl border border-dashed border-slate-300 dark:border-[#333333] bg-white dark:bg-[#1F1F1F] flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
            <Package size={28} className="text-emerald-600" />
          </div>
          <p className="font-bold text-slate-800 dark:text-slate-200">
            {statusFilter === 'all' ? 'Todavía no hay órdenes de compra' : `No hay órdenes con estado "${STATUS_LABEL[statusFilter]}"`}
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-sm">
            {statusFilter === 'all'
              ? 'Generá una orden desde el stock objetivo y la demanda de ventas. Se crea una por proveedor.'
              : 'Probá con otro filtro.'}
          </p>
          {canManage && statusFilter === 'all' && (
            <button onClick={() => setShowGenerate(true)} className="mt-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer">
              Generar primera orden
            </button>
          )}
        </div>
      ) : (
        <div data-tour="purchaseorders-list" className="space-y-3">
          {filtered.map((order) => {
            const expanded = expandedId === order.id;
            const editing = editingId === order.id;
            const variance = costVariance(order.total_cost, order.receipt_total);
            // Solo tiene sentido en OC recibidas: en borrador/enviada no hay recibido aún.
            const shortage = order.status === 'received'
              ? shortageSummary(order.items || [])
              : { quantity: 0, cost: 0, lines: 0 };
            return (
              <div key={order.id} className={`bg-white dark:bg-[#1F1F1F] rounded-2xl border border-slate-200 dark:border-[#333333] border-l-4 ${ACCENT[order.status]} overflow-hidden shadow-sm hover:shadow-md transition-shadow`}>
                <div className="p-4 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">{order.order_number || order.id.slice(0, 8)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[order.status]}`}>{STATUS_LABEL[order.status]}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {order.supplier_name || 'Sin proveedor'} · {order.items_count} productos ·{' '}
                      {order.receipt_total != null ? (
                        <>
                          est. ${fmt(order.total_cost)} →{' '}
                          <strong className="text-slate-700 dark:text-slate-200">${fmt(order.receipt_total)}</strong>
                          {variance != null && variance !== 0 && (
                            <span className={`ml-1 font-bold ${variance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                              ({variance > 0 ? '+' : '-'}${fmt(Math.abs(variance))})
                            </span>
                          )}
                        </>
                      ) : (
                        <>${fmt(order.total_cost)}</>
                      )}
                      {shortage.quantity > 0 && (
                        <span className="ml-1 font-bold text-amber-600">
                          · faltaron {fmtQty(shortage.quantity)}
                          {shortage.cost > 0 ? ` ($${fmt(shortage.cost)})` : ''}
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Creada {relDate(order.created_at)}
                      {order.sent_at && ` · Enviada ${relDate(order.sent_at)}`}
                      {order.received_at && ` · Recibida ${relDate(order.received_at)}`}
                      {order.receipt_number && ` · ${order.receipt_number}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setExpandedId(expanded ? null : order.id)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:text-white cursor-pointer">
                      {expanded ? 'Ocultar' : 'Detalle'}
                    </button>
                    {canManage && order.status === 'draft' && (
                      <button onClick={() => startEdit(order)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:text-white cursor-pointer flex items-center gap-1">
                        <PencilSimple size={12} /> Editar
                      </button>
                    )}
                    {canManage && !editing && (order.status === 'draft' || order.status === 'sent') && (
                      <>
                        {order.status === 'draft' && (
                          <button onClick={() => handleSend(order)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-sky-600 hover:bg-sky-700 text-white cursor-pointer flex items-center gap-1">
                            <WhatsappLogo size={12} weight="fill" /> Enviar
                          </button>
                        )}
                        {order.status === 'sent' && (
                          <button onClick={() => handleReceive(order)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer flex items-center gap-1">
                            <Package size={12} /> Recibir
                          </button>
                        )}
                        <button onClick={() => handleCancel(order)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-100 hover:bg-red-200 text-red-700 cursor-pointer flex items-center gap-1">
                          <X size={12} /> Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 dark:border-[#333333] p-4">
                    {editing && editingId === order.id ? (
                      <div className="space-y-2">
                        {editItems.map((it, idx) => (
                          <div
                            key={it.id || idx}
                            className="flex flex-wrap items-end gap-2 p-2 rounded-xl border border-slate-100 dark:border-[#333333] bg-slate-50/60 dark:bg-white/[0.02]"
                          >
                            <div className="flex-1 min-w-[130px]">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Producto</p>
                              <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                                {it.product_name || catalog[it.product_id]?.name || 'Producto'}
                              </p>
                            </div>
                            <label className="block">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Cantidad ({unitOf(it.product_id) === 'kg' ? 'kg' : 'un'})
                              </span>
                              <input
                                type="number"
                                min="0"
                                step={unitOf(it.product_id) === 'kg' ? '0.01' : '1'}
                                value={it.quantity}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const n = Number(raw);
                                  patchEditItem(idx, {
                                    quantity: raw === '' ? 0 : Number.isFinite(n) ? n : it.quantity,
                                  });
                                }}
                                className="w-24 px-2 py-1.5 border border-slate-300 dark:border-[#444] dark:bg-[#1F1F1F] dark:text-white rounded-lg text-center text-sm"
                              />
                            </label>
                            <label className="block">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Costo unit.</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="sin costo"
                                value={it.unit_cost ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const n = raw === '' ? null : Number(raw);
                                  patchEditItem(idx, {
                                    unit_cost: n != null && !Number.isFinite(n) ? it.unit_cost : n,
                                  });
                                }}
                                className="w-28 px-2 py-1.5 border border-slate-300 dark:border-[#444] dark:bg-[#1F1F1F] dark:text-white rounded-lg text-right text-sm"
                              />
                            </label>
                            <div className="text-right min-w-[76px]">
                              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Subtotal</span>
                              <p className="text-sm font-bold tnum text-slate-800 dark:text-white">${fmt(draftLineTotal(it))}</p>
                            </div>
                            <button
                              onClick={() => removeEditItem(idx)}
                              title="Quitar producto"
                              aria-label="Quitar producto"
                              className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition"
                            >
                              <Trash size={16} />
                            </button>
                          </div>
                        ))}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <div className="flex-1 min-w-[180px]">
                            <RoundedSelect
                              value={editAddId}
                              onChange={setEditAddId}
                              options={editProductOptions}
                              size="sm"
                              buttonLabel={editAddId ? undefined : 'Agregar producto…'}
                            />
                          </div>
                          <button
                            onClick={addEditItem}
                            disabled={!editAddId}
                            className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:text-white cursor-pointer disabled:opacity-50 flex items-center gap-1"
                          >
                            <Plus size={14} weight="bold" /> Agregar
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-[#333333]">
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {editItems.length} productos · total est.{' '}
                            <strong className="text-slate-800 dark:text-white">${fmt(draftTotal(editItems))}</strong>
                          </span>
                          <div className="flex gap-2">
                            <button onClick={cancelEdit} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 dark:bg-white/5 dark:text-white cursor-pointer">Cancelar</button>
                            <button onClick={() => saveEdit(order)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer">Guardar</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <table className="w-full text-sm hidden sm:table">
                        <thead>
                          <tr className="text-xs uppercase text-slate-500">
                            <th className="text-left p-2">Producto</th>
                            <th className="text-center p-2">Cantidad</th>
                            {order.status === 'received' ? (
                              <>
                                <th className="text-center p-2">Recibido</th>
                                <th className="text-center p-2">Faltante</th>
                              </>
                            ) : (
                              <>
                                <th className="text-center p-2">Reponer</th>
                                <th className="text-center p-2">Sugerido</th>
                              </>
                            )}
                            <th className="text-right p-2">Costo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.items || []).map((it) => (
                            <tr key={it.id} className="border-t border-slate-100 dark:border-[#333333]">
                              <td className="p-2 text-slate-900 dark:text-white">{it.product_name}</td>
                              <td className="p-2 text-center font-bold">{it.quantity}</td>
                              {order.status === 'received' ? (
                                <>
                                  <td className="p-2 text-center font-bold">{fmtQty(it.received_quantity)}</td>
                                  <td className="p-2 text-center">
                                    {lineShortage(it) > 0 ? (
                                      <span className="font-bold text-amber-600">{fmtQty(lineShortage(it))}</span>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="p-2 text-center text-slate-500">{it.qty_replenish}</td>
                                  <td className="p-2 text-center text-slate-500">{it.qty_suggested}</td>
                                </>
                              )}
                              <td className="p-2 text-right">{it.unit_cost != null ? `$${fmt(it.unit_cost * it.quantity)}` : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {!editing && (
                      <div className="sm:hidden space-y-2 mt-2">
                        {(order.items || []).map((it) => (
                          <div key={it.id} className="p-2 rounded-lg bg-white dark:bg-[#1F1F1F] border border-slate-100 dark:border-[#333333] text-xs">
                            <p className="font-bold text-slate-900 dark:text-white truncate">{it.product_name}</p>
                            <div className="flex justify-between mt-1 text-slate-500">
                              <span>Cant: <strong className="text-slate-800 dark:text-white">{it.quantity}</strong></span>
                              {order.status === 'received' ? (
                                <>
                                  <span>Recib.: <strong className="text-slate-800 dark:text-white">{fmtQty(it.received_quantity)}</strong></span>
                                  {lineShortage(it) > 0 ? (
                                    <span className="font-bold text-amber-600">Faltan: {fmtQty(lineShortage(it))}</span>
                                  ) : (
                                    <span className="text-emerald-600 font-bold">Completo</span>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span>Reponer: {it.qty_replenish}</span>
                                  <span>Sugerido: {it.qty_suggested}</span>
                                </>
                              )}
                              <span className="font-bold">{it.unit_cost != null ? `$${fmt(it.unit_cost * it.quantity)}` : '-'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 pt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                      <span>
                        {editing ? editItems.length : order.items?.length || 0} productos · costo{' '}
                        {editing ? (
                          <>est. <strong className="text-slate-800 dark:text-white">${fmt(draftTotal(editItems))}</strong></>
                        ) : order.receipt_total != null ? (
                          <>
                            est. <strong className="text-slate-800 dark:text-white">${fmt(order.total_cost)}</strong>
                            {' · '}real{' '}
                            <strong className={variance != null && variance > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                              ${fmt(order.receipt_total)}
                            </strong>
                            {variance != null && variance !== 0 && (
                              <span className={`ml-1 ${variance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                ({variance > 0 ? '+' : '-'}${fmt(Math.abs(variance))})
                              </span>
                            )}
                          </>
                        ) : (
                          <>total <strong className="text-slate-800 dark:text-white">${fmt(order.total_cost)}</strong></>
                        )}
                      </span>
                    </div>
                    {order.notes && <p className="text-xs text-slate-500 mt-2">Notas: {order.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Nueva orden de compra */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={closeGenerate}>
          <div className="relative bg-white dark:bg-[#1F1F1F] rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 dark:border-[#333333] flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Nueva orden de compra</h3>
                <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">Elegí qué pedir. Se crea una orden por proveedor.</p>
              </div>
              <button onClick={closeGenerate} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"><X size={16} /></button>
            </div>

            <div className="px-5 py-3 space-y-3 overflow-y-auto flex-1">
              <details className="rounded-xl border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-white/[0.03]">
                <summary className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                  Parámetros de cálculo
                  <span className="ml-2 font-semibold text-slate-500 dark:text-slate-400">
                    {replWindow}d de ventas · revisión {replReview}d · {Math.round((replZ >= 2.33 ? 0.99 : replZ >= 1.65 ? 0.95 : 0.9) * 100)}% servicio
                  </span>
                </summary>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1">Ventana de ventas (días)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={replWindowText}
                      onChange={(e) => setReplWindowText(e.target.value.replace(/\D/g, ''))}
                      onBlur={commitWindow}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitWindow(); }}
                      className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 bg-white dark:bg-[#1F1F1F] dark:border-[#333333] dark:text-white"
                    />
                    <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400 mt-1">Días de historial que se usan para medir la demanda (1 a 365).</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1">Período de revisión (días)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={3}
                      value={replReviewText}
                      onChange={(e) => setReplReviewText(e.target.value.replace(/\D/g, ''))}
                      onBlur={commitReview}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitReview(); }}
                      className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 bg-white dark:bg-[#1F1F1F] dark:border-[#333333] dark:text-white"
                    />
                    <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400 mt-1">Días que debe cubrir el pedido hasta la próxima revisión (1 a 180).</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1">Nivel de servicio</label>
                    <RoundedSelect
                      size="sm"
                      flip={false}
                      value={String(replZ)}
                      onChange={(v) => { const z = Number(v); setReplZ(z); savePoPrefs({ z }); }}
                      options={[
                        { value: '1.28', label: '90% (riesgo alto)' },
                        { value: '1.65', label: '95% (recomendado)' },
                        { value: '2.33', label: '99% (riesgo bajo)' },
                      ]}
                    />
                    <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400 mt-1">{serviceHint}</p>
                  </div>
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[160px]">
                  <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={replSearch}
                    onChange={(e) => setReplSearch(e.target.value)}
                    placeholder="Buscar producto..."
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white dark:bg-[#1F1F1F] dark:border-[#333333] dark:text-white"
                  />
                </div>
                <div className="flex rounded-lg p-0.5 gap-0.5 bg-slate-100 dark:bg-white/5">
                  {(['all', 'reorder', 'critical', 'empty'] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => { setReplFilter(f); savePoPrefs({ filter: f }); }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${replFilter === f ? 'bg-white text-slate-900 shadow-sm dark:bg-emerald-600 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}
                    >
                      {f === 'all' ? 'Todos' : f === 'reorder' ? 'A pedir' : f === 'critical' ? 'Bajo objetivo' : 'Sin stock'}
                    </button>
                  ))}
                </div>
                <div className="w-[190px] shrink-0">
                  <RoundedSelect
                    size="sm"
                    flip={false}
                    buttonLabel={`Orden: ${SORT_LABEL[replSort] ?? 'Urgencia'}`}
                    value={replSort}
                    onChange={(v) => { const sort = v as 'urgency' | 'cost' | 'name'; setReplSort(sort); savePoPrefs({ sort }); }}
                    options={SORT_OPTIONS}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <button
                  onClick={selectNeeded}
                  className="px-2.5 py-1 font-bold rounded bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer transition active:scale-95"
                >
                  Solo críticos
                </button>
                <span className="mx-1 text-slate-300">|</span>
                <span className="font-semibold text-slate-600 dark:text-slate-400 mr-1">A los visibles:</span>
                <button onClick={() => setModeAll('replenish')} className="px-2 py-1 font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-slate-200 cursor-pointer">Faltan</button>
                <button onClick={() => setModeAll('suggested')} className="px-2 py-1 font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-slate-200 cursor-pointer">Sugerido</button>
                <span className="mx-1 text-slate-300">|</span>
                <button onClick={() => setGroupChecked(replFiltered, true)} className="px-2 py-1 font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-slate-200 cursor-pointer">Seleccionar</button>
                <button onClick={() => setGroupChecked(replFiltered, false)} className="px-2 py-1 font-bold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:text-slate-200 cursor-pointer">Quitar</button>
              </div>
              <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-[#333333] rounded-lg px-3 py-2 -mt-1">
                <b className="font-bold text-slate-700 dark:text-slate-200">Faltan</b> = objetivo − stock ·{' '}
                <b className="font-bold text-slate-700 dark:text-slate-200">Sugerido</b> = demanda (o el faltante si es mayor) − ya pedido ·{' '}
                <b className="font-bold text-slate-700 dark:text-slate-200">Punto de pedido</b> = nivel de stock con el que conviene volver a pedir.
              </p>

              {loadingRepl ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-emerald-600" size={20} /></div>
              ) : replenishment.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No hay productos activos.</p>
              ) : groupedRows.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-slate-500">Ningún producto coincide con el filtro.</p>
                  <button onClick={() => { setReplSearch(''); setReplFilter('all'); }} className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer">Ver todos los productos</button>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedRows.map((g) => {
                    const chosen = g.rows.filter((r) => selected[r.product_id]?.checked && qtyOf(r) > 0).length;
                    const checkedAny = g.rows.some((r) => selected[r.product_id]?.checked);
                    const allChecked = g.rows.every((r) => selected[r.product_id]?.checked);
                    const groupTotal = g.rows.reduce(
                      (acc, r) => acc + (selected[r.product_id]?.checked ? qtyOf(r) * (costMap[r.product_id] || 0) : 0),
                      0,
                    );
                    return (
                      <section key={g.key} className="rounded-xl border border-slate-200 dark:border-[#333333] overflow-hidden">
                        <header className="px-3 py-2 bg-slate-50 dark:bg-white/5 flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(el) => { if (el) el.indeterminate = checkedAny && !allChecked; }}
                            onChange={(e) => setGroupChecked(g.rows, e.target.checked)}
                            className="w-4 h-4 cursor-pointer"
                            title="Seleccionar todo el proveedor"
                          />
                          <p className="text-sm font-extrabold text-slate-900 dark:text-white flex-1 truncate">{g.name}</p>
                          <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {chosen} de {g.rows.length} para pedir
                            {groupTotal > 0 && <> · ${fmt(groupTotal)}</>}
                          </span>
                        </header>
                        {g.key === 'none' && (
                          <p className="px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-500/5">
                            Estos productos no tienen proveedor asignado. Asignalo en Productos para agruparlos.
                          </p>
                        )}
                        <div className="divide-y divide-slate-100 dark:divide-[#333333]">
                          {g.rows.map((r) => {
                            const sel: RowSel = selected[r.product_id] || { checked: false, mode: 'suggested', manual: '' };
                            const qty = qtyOf(r);
                            const unit = unitMap[r.product_id] || 'unit';
                            const critical = r.stock <= r.min_stock;
                            const cover = r.avg_daily > 0 ? Math.max(Math.floor(r.stock / r.avg_daily), 0) : null;
                            const late = cover !== null && cover < r.lead_time_days;
                            const already = pendingByProduct[r.product_id] || 0;
                            return (
                              <div key={r.product_id} className={`p-3 space-y-2 ${sel.checked ? '' : 'opacity-70'} ${critical ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''}`}>
                                <div className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    checked={sel.checked}
                                    onChange={(e) => setRow(r.product_id, { checked: e.target.checked })}
                                    className="mt-1 w-4 h-4 cursor-pointer"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{r.product_name}</p>
                                    <p className="text-[11px] flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-600 dark:text-zinc-400">
                                      <span>Stock <b className={r.stock <= 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}>{numFmt(r.stock)}</b></span>
                                      <span className="text-slate-300 dark:text-slate-600">·</span>
                                      <span>Objetivo <b className="text-slate-900 dark:text-white">{numFmt(r.min_stock)}</b></span>
                                      {cover !== null && (
                                        <>
                                          <span className="text-slate-300 dark:text-slate-600">·</span>
                                          <span>se agota en <b className={late ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'}>{cover} días</b></span>
                                        </>
                                      )}
                                      <span className="text-slate-300 dark:text-slate-600">·</span>
                                      <span>llega en <b className="text-slate-900 dark:text-white">{r.lead_time_days} días</b></span>
                                      {already > 0 && (
                                        <>
                                          <span className="text-slate-300 dark:text-slate-600">·</span>
                                          <b className="text-amber-600 dark:text-amber-400">ya pedido: {numFmt(already)}</b>
                                        </>
                                      )}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-[9px] font-bold uppercase text-slate-600 dark:text-slate-400">Pedir</p>
                                    <p className="text-base font-extrabold text-emerald-700 dark:text-emerald-400 tnum">
                                      {qty} <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{unit === 'kg' ? 'kg' : 'un'}</span>
                                    </p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 pl-7">
                                  <div className="flex rounded-lg p-0.5 gap-0.5 bg-slate-100 dark:bg-white/5">
                                    {([
                                      { k: 'replenish', label: `Faltan ${r.replenish}` },
                                      { k: 'suggested', label: `Sugerido ${suggestedNet(r)}` },
                                      { k: 'manual', label: 'Manual' },
                                    ] as const).map((o) => (
                                      <button
                                        key={o.k}
                                        onClick={() => setRow(
                                          r.product_id,
                                          o.k === 'manual' && !sel.manual
                                            ? { mode: o.k, checked: true, manual: String(qty) }
                                            : { mode: o.k, checked: true },
                                        )}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition cursor-pointer ${sel.mode === o.k ? 'bg-white text-slate-900 shadow-sm dark:bg-emerald-600 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}
                                      >
                                        {o.label}
                                      </button>
                                    ))}
                                  </div>
                                  {sel.mode === 'manual' && (
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={sel.manual}
                                      onChange={(e) => setRow(r.product_id, { manual: e.target.value.replace(/[^\d.,]/g, '').replace(/,/g, '.') })}
                                      placeholder="Cantidad"
                                      className="w-24 px-2 py-1 border border-slate-300 rounded-lg text-xs text-slate-900 bg-white dark:bg-[#1F1F1F] dark:border-[#333333] dark:text-white"
                                    />
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 pl-7">
                                  {r.has_history ? (
                                    <>
                                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-white/5 dark:text-slate-300">
                                        Demanda <b className="text-slate-900 dark:text-white">{numFmt(r.avg_daily)}</b>/día
                                      </span>
                                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-white/5 dark:text-slate-300">
                                        Punto de pedido <b className="text-slate-900 dark:text-white">{numFmt(r.rop)}</b>
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                                      Sin ventas recientes: se usa el stock objetivo
                                    </span>
                                  )}
                                </div>
                                <div className="pl-7">
                                  <DemandBar stock={r.stock} rop={r.rop} target={r.order_up_to} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-[#333333] flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#1F1F1F]">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                <p>
                  <b>{selectedItems.length}</b> productos · <b>{selectedSupplierCount}</b> {selectedSupplierCount === 1 ? 'proveedor' : 'proveedores'} · costo est. <b>${fmt(estCost)}</b>
                </p>
                {noCostCount > 0 && (
                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                    {noCostCount} {noCostCount === 1 ? 'producto sin costo cargado' : 'productos sin costo cargado'} (no se suma al total)
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={closeGenerate} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer transition">Cancelar</button>
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={generating || selectedItems.length === 0}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition"
                >
                  {generating && <Loader2 className="animate-spin" size={12} />}
                  {selectedSupplierCount <= 1 ? 'Crear orden' : `Crear ${selectedSupplierCount} órdenes`}
                </button>
              </div>
            </div>

            {showConfirm && (
              <div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-[#1F1F1F]">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-[#333333] flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Confirmar orden de compra</h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">Revisá el resumen antes de crear.</p>
                  </div>
                  <button onClick={() => setShowConfirm(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"><X size={16} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  {summaryGroups.map((g) => (
                    <div key={g.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-[#333333] p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900 dark:text-white truncate">{g.name}</p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400">{g.items} {g.items === 1 ? 'producto' : 'productos'}</p>
                      </div>
                      <p className="text-sm font-extrabold text-slate-900 dark:text-white tnum shrink-0">${fmt(g.total)}</p>
                    </div>
                  ))}

                  <div className="rounded-xl bg-slate-50 dark:bg-white/5 p-3 space-y-1">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 flex justify-between gap-3">
                      <span>Total estimado</span>
                      <span className="tnum">${fmt(estCost)}</span>
                    </p>
                    {noCostCount > 0 && (
                      <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        {noCostCount} {noCostCount === 1 ? 'producto sin costo cargado' : 'productos sin costo cargado'}: no se suman al total.
                      </p>
                    )}
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-slate-200 dark:border-[#333333] flex items-center justify-between gap-3">
                  <button onClick={() => setShowConfirm(false)} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer transition">Volver</button>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition"
                  >
                    {generating && <Loader2 className="animate-spin" size={12} />}
                    {selectedSupplierCount <= 1 ? 'Confirmar y crear' : `Confirmar y crear ${selectedSupplierCount} órdenes`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
