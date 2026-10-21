import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Product, Profile, Supplier } from '../../types';
import { matchLocalProduct } from '../../lib/productLookup';
import { useBarcodeResolution } from '../../features/scanner/hooks/useBarcodeResolution';
import { ContextualTooltip } from '../../features/onboarding';
import { ScannerModal } from '../../features/scanner/components/ScannerModal';
import { useScanner } from '../../features/scanner/hooks/useScanner';
import { SelectMenu } from '../ui/SelectMenu';
import { Plus, Search, Trash2, Camera, Check, X, PackagePlus, Loader2, CalendarDays, Tag, ArrowLeftRight } from 'lucide-react';

interface LocationRow {
  id: string;
  name: string;
}

interface ReceiptRow {
  id: string;
  receipt_number: string | null;
  status: 'draft' | 'confirmed' | 'cancelled';
  supplier_name: string | null;
  notes: string | null;
  total_cost: number | null;
  created_at: string;
  confirmed_at: string | null;
}

interface IntakeLine {
  key: string;
  product: Product;
  quantity: string;
  cost: string;
  lot: string;
  expiry: string;
}

interface ReceiptItemDetail {
  product_id: string;
  quantity: number;
  cost_price: number | null;
  lot_number: string | null;
  expiration_date: string | null;
  products: { name: string } | null;
}

export function StockIntakeView({ showToast, profile }: { showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void; profile?: Profile | null }) {
  const canCancel = ['admin', 'supervisor', 'vendedor'].includes(profile?.role || '');
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) showToast(msg, kind);
  };

  const [products, setProducts] = useState<Product[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // Ingreso activo (draft en edición)
  const [activeReceipt, setActiveReceipt] = useState<ReceiptRow | null>(null);
  const [activeKey, setActiveKey] = useState<string>('');
  const [lines, setLines] = useState<IntakeLine[]>([]);
  const [search, setSearch] = useState('');
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Transferencia entre ubicaciones (admin/supervisor)
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [showTransfer, setShowTransfer] = useState(false);
  const [txFrom, setTxFrom] = useState('');
  const [txTo, setTxTo] = useState('');
  const [txSearch, setTxSearch] = useState('');
  const [txProduct, setTxProduct] = useState<Product | null>(null);
  const [txQty, setTxQty] = useState('1');
  const [txNotes, setTxNotes] = useState('');
  const [txBusy, setTxBusy] = useState(false);

  // Detalle expandible de un ingreso del historial
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailItems, setDetailItems] = useState<ReceiptItemDetail[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Alta rápida de producto desde el escáner (#6)
  const [quickAdd, setQuickAdd] = useState<{ code: string } | null>(null);
  const [qaName, setQaName] = useState('');
  const [qaCost, setQaCost] = useState('');
  const [qaSaving, setQaSaving] = useState(false);

  // Autocomplete de proveedor (#7)
  const [supplierOpen, setSupplierOpen] = useState(false);

  // Ubicación de destino del ingreso (#5) — null = "Local principal" (default del RPC)
  const [destLocation, setDestLocation] = useState<string>('');

  // Botón central móvil: abre el escáner al navegar desde el sheet
  // (solo si hay un ingreso activo; si no, se ignora)
  const activeReceiptRef = useRef<ReceiptRow | null>(null);
  useEffect(() => {
    activeReceiptRef.current = activeReceipt;
  }, [activeReceipt]);
  useEffect(() => {
    const open = () => { if (activeReceiptRef.current) setScannerOpen(true); };
    window.addEventListener('dv:open-scanner', open);
    return () => window.removeEventListener('dv:open-scanner', open);
  }, []);

  const scannerApi = useScanner();

  // Resolver único centralizado (barcode_normalized + match local)
  const { resolve: resolveBarcodeCode } = useBarcodeResolution(products);
  useEffect(() => {
    scannerApi.setOnDetected(resolveBarcodeCode);
    return () => { scannerApi.setOnDetected(null); };
  }, [resolveBarcodeCode]);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: prods } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name');
      setProducts((prods || []) as Product[]);
      const { data: recs } = await supabase
        .from('stock_receipts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      setReceipts((recs || []) as ReceiptRow[]);
      const { data: locs } = await supabase
        .from('locations')
        .select('id, name')
        .order('name');
      const locList = (locs || []) as LocationRow[];
      setLocations(locList);
      if (locList.length >= 2 && !txFrom) {
        setTxFrom(locList[0].id);
        setTxTo(locList[1].id);
      }
      // Ubicación por defecto para ingresos: "Local principal" si existe, si no la primera
      if (!destLocation && locList.length > 0) {
        const principal = locList.find((l) => l.name === 'Local principal') || locList[0];
        setDestLocation(principal.id);
      }
      const { data: sups } = await supabase
        .from('suppliers')
        .select('id, name, phone, notes, is_active')
        .eq('is_active', true)
        .order('name');
      setSuppliers((sups || []) as Supplier[]);
    } catch (e: any) {
      notify(`Error cargando: ${e?.message || e}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const startNewReceipt = async () => {
    try {
      const { data: numData } = await supabase.rpc('next_stock_receipt_number');
      const receipt_number = (numData as unknown as string) || `ING-${Date.now().toString().slice(-6)}`;
      const { data, error } = await supabase
        .from('stock_receipts')
        .insert({ receipt_number, status: 'draft', created_by: profile?.id ?? null })
        .select()
        .single();
      if (error) throw error;
      setActiveReceipt(data as ReceiptRow);
      // Idempotencia V3 §18: misma key = mismo ingreso aunque se reintente
      setActiveKey((typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `ing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      setLines([]);
      setSupplier('');
      setNotes('');
      notify(`Ingreso ${receipt_number} creado. Escaneá productos.`, 'success');
    } catch (e: any) {
      notify(`No se pudo crear el ingreso: ${e?.message || e}`, 'error');
    }
  };

  const addProductLine = (p: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === p.id && !l.lot && !l.expiry);
      if (existing) {
        return prev.map((l) =>
          l.key === existing.key
            ? { ...l, quantity: String((parseFloat(l.quantity) || 0) + 1) }
            : l
        );
      }
      return [...prev, {
        key: `${p.id}-${Date.now()}`,
        product: p,
        quantity: '1',
        cost: p.cost_price ? String(p.cost_price) : '',
        lot: '',
        expiry: '',
      }];
    });
  };

  const updateLine = (key: string, patch: Partial<IntakeLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const totalCost = lines.reduce((a, l) => a + (parseFloat(l.quantity) || 0) * (parseFloat(l.cost) || 0), 0);

  const saveDraftMeta = async (): Promise<boolean> => {
    if (!activeReceipt) return false;
    const { error } = await supabase.from('stock_receipts').update({
      supplier_name: supplier || null,
      notes: notes || null,
      total_cost: totalCost,
    }).eq('id', activeReceipt.id);
    if (error) {
      notify(`No se pudieron guardar los datos del ingreso: ${error.message}`, 'warning');
      return false;
    }
    return true;
  };

  // Autosave (debounce) de proveedor/notas/total mientras se edita el borrador,
  // para que no se pierdan si el usuario navega o se cuelga antes de confirmar.
  const saveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!activeReceipt) return;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { saveDraftMeta(); }, 800);
    return () => window.clearTimeout(saveTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier, notes, totalCost, activeReceipt?.id]);

  const handleConfirm = async () => {
    if (!activeReceipt || lines.length === 0) {
      notify('Agregá al menos un producto.', 'warning');
      return;
    }
    // Validar líneas
    for (const l of lines) {
      const q = parseFloat(l.quantity);
      if (!q || q <= 0) {
        notify(`Cantidad inválida en "${l.product.name}".`, 'error');
        return;
      }
    }
    setConfirming(true);
    try {
      const metaOk = await saveDraftMeta();
      if (!metaOk) throw new Error('No se pudieron guardar los datos del ingreso.');

      // Idempotente al reintentar: limpiar ítems previos de este borrador
      // antes de reinsertar, así un reintento no duplica líneas.
      const { error: cleanupError } = await supabase
        .from('stock_receipt_items')
        .delete()
        .eq('receipt_id', activeReceipt.id);
      if (cleanupError) throw cleanupError;

      // Persistir items
      const items = lines.map((l) => ({
        receipt_id: activeReceipt.id,
        product_id: l.product.id,
        quantity: parseFloat(l.quantity),
        cost_price: l.cost ? parseFloat(l.cost) : null,
        lot_number: l.lot || null,
        expiration_date: l.expiry || null,
      }));
      const { error: itemsError } = await supabase.from('stock_receipt_items').insert(items);
      if (itemsError) throw itemsError;

      // Confirmar (transacción: stock + movimientos + costo)
      const { error: confirmError } = await supabase.rpc('confirm_stock_receipt', {
        p_receipt_id: activeReceipt.id,
        p_idempotency_key: activeKey || null,
        p_location_id: destLocation || null,
      });
      if (confirmError) throw confirmError;

      notify(`Ingreso ${activeReceipt.receipt_number} confirmado. Stock actualizado.`, 'success');
      setActiveReceipt(null);
      setLines([]);
      fetchAll();
    } catch (e: any) {
      notify(`Error al confirmar: ${e?.message || e}`, 'error');
    } finally {
      setConfirming(false);
    }
  };

  const handleCancelDraft = async () => {
    if (!activeReceipt) return;
    if (!confirm('¿Cancelar este ingreso borrador? Se pierden las líneas.')) return;
    try {
      await supabase.from('stock_receipts').update({ status: 'cancelled' }).eq('id', activeReceipt.id);
      setActiveReceipt(null);
      setLines([]);
      fetchAll();
      notify('Ingreso cancelado.', 'info');
    } catch (e: any) {
      notify(`Error: ${e?.message || e}`, 'error');
    }
  };

  const txFiltered = txSearch.trim()
    ? products.filter((p) => {
        const q = txSearch.toLowerCase();
        return p.name.toLowerCase().includes(q) || (p.barcode || '').includes(txSearch.trim());
      }).slice(0, 6)
    : [];

  const handleTransfer = async () => {
    if (!txProduct) return notify('Elegí el producto a transferir.', 'warning');
    if (!txFrom || !txTo || txFrom === txTo) return notify('Elegí origen y destino distintos.', 'error');
    const qty = parseFloat(txQty);
    if (!qty || qty <= 0) return notify('Cantidad inválida.', 'error');
    setTxBusy(true);
    try {
      const key = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { error } = await supabase.rpc('transfer_stock', {
        p_product_id: txProduct.id,
        p_from_location_id: txFrom,
        p_to_location_id: txTo,
        p_quantity: qty,
        p_notes: txNotes || null,
        p_idempotency_key: key,
      });
      if (error) throw error;
      const fromName = locations.find((l) => l.id === txFrom)?.name || '?';
      const toName = locations.find((l) => l.id === txTo)?.name || '?';
      notify(`${qty} × "${txProduct.name}": ${fromName} → ${toName}. Stock movido.`, 'success');
      setTxProduct(null);
      setTxSearch('');
      setTxQty('1');
      setTxNotes('');
      fetchAll();
    } catch (e: any) {
      notify(`Transferencia falló: ${e?.message || e}`, 'error');
    } finally {
      setTxBusy(false);
    }
  };

  const filtered = search.trim()
    ? products.filter((p) => {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || (p.barcode || '').includes(search.trim());
      }).slice(0, 8)
    : [];

  const supplierFiltered = supplierOpen && supplier.trim()
    ? suppliers.filter((s) => s.name.toLowerCase().includes(supplier.toLowerCase())).slice(0, 6)
    : [];

  const handleQuickAddProduct = async () => {
    if (!quickAdd) return;
    const name = qaName.trim();
    if (!name) return notify('Poné un nombre para el producto.', 'warning');
    setQaSaving(true);
    try {
      const payload: any = {
        barcode: quickAdd.code,
        name,
        unit_type: 'unit',
        cost_price: parseFloat(qaCost) || 0,
        wholesale_price: 0,
        retail_price: 0,
        stock_quantity: 0,
        min_stock: 5,
        is_active: true,
      };
      const { data, error } = await supabase.from('products').insert([payload]).select('*').single();
      if (error) throw error;
      const created = data as Product;
      setProducts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      addProductLine(created);
      notify(`"${created.name}" creado y agregado al lote.`, 'success');
      setQuickAdd(null);
      setQaName('');
      setQaCost('');
    } catch (e: any) {
      notify(`No se pudo crear el producto: ${e?.message || e}`, 'error');
    } finally {
      setQaSaving(false);
    }
  };

  const statusLabel = (s: string) => s === 'draft' ? 'Borrador' : s === 'confirmed' ? 'Confirmado' : 'Cancelado';
  const statusColor = (s: string) => s === 'draft'
    ? 'bg-amber-100 text-amber-700'
    : s === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500';
  const destLocationName = locations.find((l) => l.id === destLocation)?.name || '';

  const toggleDetail = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetailItems([]);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    setDetailItems([]);
    const { data, error } = await supabase
      .from('stock_receipt_items')
      .select('product_id, quantity, cost_price, lot_number, expiration_date, products(name)')
      .eq('receipt_id', id);
    if (error) {
      notify(`No se pudo cargar el detalle: ${error.message}`, 'error');
      setExpandedId(null);
    } else {
      setDetailItems((data || []) as unknown as ReceiptItemDetail[]);
    }
    setDetailLoading(false);
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Loader2 size={24} className="animate-spin mx-auto mb-2 text-emerald-600" />
        <p className="font-semibold">Cargando ingresos…</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <PackagePlus className="text-emerald-600" size={22} /> Ingreso de mercadería
            <ContextualTooltip tipKey="intake-draft" title="Borrador vs confirmado">
              Creás un ingreso como <strong>borrador</strong>, agregás productos y recién al <strong>confirmarlo</strong> se suma el stock y queda el movimiento registrado. Así podés revisar antes de impactar.
            </ContextualTooltip>
          </h1>
          <p className="text-xs text-slate-500 font-semibold mt-0.5">
            Cargá la mercadería recibida. El stock se suma recién al confirmar.
          </p>
        </div>
        {!activeReceipt && (
          <div className="flex gap-2 flex-wrap">
            {canCancel && locations.length >= 2 && (
              <button
                onClick={() => setShowTransfer((v) => !v)}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-white border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5"
              >
                <ArrowLeftRight size={15} /> Transferir
              </button>
            )}
            <button
              data-tour="intake-new"
              onClick={startNewReceipt}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5 shadow-sm"
            >
              <Plus size={16} /> Nuevo ingreso
            </button>
          </div>
        )}
      </div>

      {/* Transferencia entre ubicaciones */}
      {showTransfer && canCancel && locations.length >= 2 && !activeReceipt && (
        <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border-2 border-sky-200 dark:border-sky-500/30 p-4 sm:p-5 space-y-3">
          <p className="font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
            <ArrowLeftRight className="text-sky-600" size={18} /> Transferir stock entre ubicaciones
          </p>
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="text-[11px] font-bold text-slate-500">Desde
              <div className="mt-0.5">
                <SelectMenu
                  value={txFrom}
                  options={locations.map((l) => ({ value: l.id, label: l.name }))}
                  onChange={(v) => setTxFrom(String(v))}
                  ariaLabel="Ubicación origen"
                  width="w-44"
                  fullWidth
                />
              </div>
            </div>
            <div className="text-[11px] font-bold text-slate-500">Hacia
              <div className="mt-0.5">
                <SelectMenu
                  value={txTo}
                  options={locations.map((l) => ({ value: l.id, label: l.name }))}
                  onChange={(v) => setTxTo(String(v))}
                  ariaLabel="Ubicación destino"
                  width="w-44"
                  fullWidth
                />
              </div>
            </div>
            <label className="text-[11px] font-bold text-slate-500">Cantidad
              <input
                type="number" min="1" step="any" inputMode="decimal"
                value={txQty}
                onChange={(e) => setTxQty(e.target.value)}
                className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </label>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={txProduct ? `${txProduct.name} (stock ${txProduct.stock_quantity})` : txSearch}
              onChange={(e) => { setTxSearch(e.target.value); setTxProduct(null); }}
              placeholder="Buscar producto a transferir…"
              className="w-full pl-9 pr-3 py-2.5 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900 dark:text-white bg-white dark:bg-[#232323]"
            />
            {!txProduct && txFiltered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white dark:bg-[#232323] border-2 border-slate-200 dark:border-[#333333] rounded-xl shadow-xl overflow-hidden">
                {txFiltered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setTxProduct(p); setTxSearch(''); }}
                    className="w-full text-left px-3 py-2 hover:bg-sky-50 dark:hover:bg-white/5 transition cursor-pointer flex justify-between items-center"
                  >
                    <span className="text-sm font-bold text-slate-800 dark:text-white">{p.name}</span>
                    <span className="text-[11px] font-mono text-slate-500">stock {p.stock_quantity}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <input
              value={txNotes}
              onChange={(e) => setTxNotes(e.target.value)}
              placeholder="Nota (opcional)"
              className="flex-1 px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              onClick={handleTransfer}
              disabled={txBusy || !txProduct}
              className="px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-xl text-sm font-extrabold transition cursor-pointer flex items-center gap-1.5"
            >
              {txBusy ? <Loader2 size={15} className="animate-spin" /> : <ArrowLeftRight size={15} />}
              Transferir
            </button>
          </div>
        </div>
      )}

      {/* Ingreso activo */}
      {activeReceipt && (
        <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border-2 border-emerald-200 dark:border-emerald-500/30 p-4 sm:p-5 space-y-4">
          <div className="text-center pb-3 border-b border-slate-100 dark:border-white/5">
            <img src="/logo-512.jpg" alt="Vishal Dietética" className="h-12 mx-auto mb-1 object-contain" />
            <p className="font-extrabold text-slate-900 dark:text-white">DIETÉTICA VISHAL</p>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="font-extrabold text-slate-900 dark:text-white">
                Ingreso <span className="font-mono text-emerald-700">{activeReceipt.receipt_number}</span>
                <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full font-bold ${statusColor(activeReceipt.status)}`}>
                  {statusLabel(activeReceipt.status)}
                </span>
              </p>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                {lines.length === 0
                  ? 'Agregá productos escaneando o buscando abajo.'
                  : `${lines.length} ${lines.length === 1 ? 'producto' : 'productos'} en el lote · ${destLocationName || 'cargando ubicación…'}`}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setScannerOpen(true)}
                className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
              >
                <Camera size={15} /> Escanear
              </button>
              {canCancel && (
                <button
                  onClick={handleCancelDraft}
                  className="px-3 py-2 text-slate-400 hover:text-red-500 transition cursor-pointer"
                  title="Cancelar borrador"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Buscador */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered.length > 0) {
                  addProductLine(filtered[0]);
                  setSearch('');
                }
              }}
              placeholder="Buscar por nombre o código de barras…"
              className="w-full pl-9 pr-3 py-2.5 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white bg-white dark:bg-[#232323]"
            />
            {filtered.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white dark:bg-[#232323] border-2 border-slate-200 dark:border-[#333333] rounded-xl shadow-xl overflow-hidden">
                {filtered.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => { addProductLine(p); setSearch(''); }}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-50 dark:hover:bg-white/5 transition cursor-pointer flex justify-between items-center"
                  >
                    <span className="text-sm font-bold text-slate-800 dark:text-white">
                      {p.name}
                      {i === 0 && <span className="ml-2 text-[10px] text-slate-400 font-semibold">↵ Enter</span>}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">stock {p.stock_quantity}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Líneas */}
          {lines.length === 0 ? (
            <div className="text-center py-8">
              <PackagePlus size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm text-slate-400 font-semibold">
                Todavía no agregaste productos.
              </p>
              <p className="text-xs text-slate-400 font-semibold mt-1">
                Escaneá un código de barras o buscá por nombre para empezar.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map((l) => {
                const lineSubtotal = (parseFloat(l.quantity) || 0) * (parseFloat(l.cost) || 0);
                return (
                <div key={l.key} className="p-3 bg-slate-50 dark:bg-[#232323] rounded-2xl border border-slate-200 dark:border-[#333333] space-y-2">
                  <div className="flex justify-between items-center gap-2">
                    <p className="text-sm font-extrabold text-slate-900 dark:text-white leading-tight">{l.product.name}</p>
                    <button onClick={() => removeLine(l.key)} className="text-slate-400 hover:text-red-500 transition cursor-pointer shrink-0" title="Quitar del lote">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 font-semibold">
                    Stock actual: <span className="font-mono font-bold">{l.product.stock_quantity}</span>
                    {lineSubtotal > 0 && (
                      <span className="float-right font-mono font-bold text-slate-700 dark:text-slate-300">
                        Subt. ${lineSubtotal.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <label className="text-[11px] font-bold text-slate-500">
                      Cant.
                      <input
                        type="number" min="0" step="any" inputMode="decimal"
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                        className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 dark:border-[#444] rounded-lg text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#1F1F1F] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="text-[11px] font-bold text-slate-500">
                      Costo unit.
                      <input
                        type="number" min="0" step="any" inputMode="decimal"
                        value={l.cost}
                        onChange={(e) => updateLine(l.key, { cost: e.target.value })}
                        placeholder="0"
                        className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 dark:border-[#444] rounded-lg text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#1F1F1F] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="text-[11px] font-bold text-slate-500">
                      <span className="flex items-center gap-1"><Tag size={11} /> Lote</span>
                      <input
                        value={l.lot}
                        onChange={(e) => updateLine(l.key, { lot: e.target.value })}
                        placeholder="opcional"
                        className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 dark:border-[#444] rounded-lg text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#1F1F1F] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="text-[11px] font-bold text-slate-500">
                      <span className="flex items-center gap-1"><CalendarDays size={11} /> Vence</span>
                      <input
                        type="date"
                        value={l.expiry}
                        onChange={(e) => updateLine(l.key, { expiry: e.target.value })}
                        className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 dark:border-[#444] rounded-lg text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#1F1F1F] focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Aclaración sobre modelo de lote (#8) */}
          {lines.some((l) => l.lot || l.expiry) && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2">
              ℹ️ Cada producto guarda un solo lote/vencimiento en stock. Si cargás lote o vencimiento, se guarda el <b>último ingreso</b> de ese producto (reemplaza el anterior). Para seguimiento por lote real, usar la vista de Productos.
            </p>
          )}

          {/* Ubicación destino (#5) + Proveedor + notas */}
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="text-[11px] font-bold text-slate-500">
              Entrará a
              <div className="mt-0.5">
                <SelectMenu
                  value={destLocation}
                  options={locations.map((l) => ({ value: l.id, label: l.name }))}
                  onChange={(v) => setDestLocation(String(v))}
                  ariaLabel="Ubicación destino del ingreso"
                  width="w-44"
                  fullWidth
                />
              </div>
            </div>
            <div className="relative">
              <label className="text-[11px] font-bold text-slate-500 block">
                Proveedor (opcional)
              </label>
              <input
                value={supplier}
                onChange={(e) => { setSupplier(e.target.value); setSupplierOpen(true); }}
                onFocus={() => setSupplierOpen(true)}
                onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
                placeholder="Buscar o escribir proveedor…"
                className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {supplierFiltered.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-[#232323] border-2 border-slate-200 dark:border-[#333333] rounded-xl shadow-xl overflow-hidden">
                  {supplierFiltered.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={() => { setSupplier(s.name); setSupplierOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-emerald-50 dark:hover:bg-white/5 transition cursor-pointer"
                    >
                      <span className="text-sm font-bold text-slate-800 dark:text-white">{s.name}</span>
                      {s.phone && <span className="text-[11px] text-slate-500 ml-2">{s.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="text-[11px] font-bold text-slate-500">
              Notas (opcional)
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: remito 123, factura B…"
                className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </label>
          </div>

          {/* Resumen + acciones */}
          <div className="pt-1 space-y-2">
            {lines.length > 0 && (
              <div className="flex justify-between items-center text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#232323] rounded-xl px-3 py-2">
                <span>{lines.length} {lines.length === 1 ? 'producto' : 'productos'}</span>
                <span className="font-mono text-slate-900 dark:text-white">
                  Total ${totalCost.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setScannerOpen(true)}
                className="flex-1 py-3 bg-white hover:bg-slate-100 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-white border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-bold transition cursor-pointer"
              >
                Continuar escaneando
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming || lines.length === 0}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                {confirming ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {confirming
                  ? 'Confirmando…'
                  : `Confirmar ingreso${lines.length > 0 ? ` · $${totalCost.toLocaleString('es-AR', { maximumFractionDigits: 0 })}` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historial */}
      <div data-tour="intake-list" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 space-y-2">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center justify-between">
          <span>Últimos ingresos</span>
          {receipts.length > 0 && (
            <span className="text-[10px] font-bold text-slate-400 normal-case tracking-normal">
              {receipts.length} recientes · tocá para ver detalle
            </span>
          )}
        </p>
        {receipts.length === 0 ? (
          <div className="py-8 text-center">
            <PackagePlus size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">Todavía no hay ingresos</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 mb-3">Creá el primero para empezar a cargar stock.</p>
            <button
              onClick={startNewReceipt}
              className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-xs font-bold transition cursor-pointer"
            >
              + Nuevo ingreso
            </button>
          </div>
        ) : receipts.map((r) => (
          <div key={r.id} className="border-b last:border-0 border-slate-100 dark:border-[#2a2a2a]">
            <button
              onClick={() => toggleDetail(r.id)}
              className="w-full flex justify-between items-center py-2 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition rounded-lg px-1"
            >
              <div>
                <p className="text-sm font-extrabold font-mono text-slate-800 dark:text-white">{r.receipt_number || r.id.slice(0, 8)}</p>
                <p className="text-[11px] text-slate-500 font-semibold">
                  {new Date(r.created_at).toLocaleString('es-AR')}
                  {r.supplier_name ? ` · ${r.supplier_name}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.total_cost != null && r.total_cost > 0 && (
                  <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">
                    ${r.total_cost.toLocaleString('es-AR', { maximumFractionDigits: 0 })}
                  </span>
                )}
                <span className={`text-[11px] px-2.5 py-1 rounded-full font-bold ${statusColor(r.status)}`}>
                  {statusLabel(r.status)}
                </span>
              </div>
            </button>
            {expandedId === r.id && (
              <div className="pb-3 pt-1 space-y-1.5">
                {detailLoading ? (
                  <p className="text-xs text-slate-400 font-semibold animate-pulse">Cargando detalle…</p>
                ) : detailItems.length === 0 ? (
                  <p className="text-xs text-slate-400 font-semibold">Sin ítems registrados.</p>
                ) : detailItems.map((it, i) => (
                  <div key={`${it.product_id}-${i}`} className="flex justify-between items-center text-xs bg-slate-50 dark:bg-[#232323] rounded-lg px-2.5 py-1.5">
                    <span className="font-bold text-slate-800 dark:text-white">{it.products?.name || it.product_id.slice(0, 8)}</span>
                    <span className="font-mono text-slate-500 shrink-0 ml-2">
                      {it.quantity} × {it.cost_price != null ? `$${it.cost_price.toLocaleString('es-AR')}` : '—'}
                      {it.lot_number ? ` · Lote ${it.lot_number}` : ''}
                      {it.expiration_date ? ` · Vence ${it.expiration_date}` : ''}
                    </span>
                  </div>
                ))}
                {r.notes && (
                  <p className="text-[11px] text-slate-500 italic font-semibold">Nota: {r.notes}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {scannerOpen && (
        <ScannerModal
          title="Escanear para el ingreso"
          onClose={() => { setScannerOpen(false); scannerApi.resetStatus(); }}
          onUseProduct={(_product, code) => {
            const p = products.find((x) => x.id === _product.id)
              || matchLocalProduct(products, code)
              || products.find((x) => x.barcode === code);
            if (p) {
              addProductLine(p);
              notify(`"${p.name}" agregado al lote.`, 'success');
            } else {
              notify(`Código ${code} no está en el catálogo local.`, 'warning');
            }
            setScannerOpen(false);
            scannerApi.resetStatus();
          }}
          onCreateProduct={(code) => {
            setQuickAdd({ code });
            setQaName('');
            setQaCost('');
            setScannerOpen(false);
            scannerApi.resetStatus();
          }}
        />
      )}

      {/* Modal alta rápida de producto (#6) */}
      {quickAdd && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#1F1F1F] rounded-3xl border-2 border-emerald-200 dark:border-emerald-500/30 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <PackagePlus className="text-emerald-600" size={18} /> Producto nuevo
              </p>
              <button onClick={() => setQuickAdd(null)} className="text-slate-400 hover:text-red-500 transition cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-500 font-semibold">
              Código <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{quickAdd.code}</span> no existe. Completá lo mínimo y se agrega al lote al instante.
            </p>
            <label className="text-[11px] font-bold text-slate-500 block">
              Nombre *
              <input
                value={qaName}
                onChange={(e) => setQaName(e.target.value)}
                placeholder="Ej: Aceite de oliva 500ml"
                className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                autoFocus
              />
            </label>
            <label className="text-[11px] font-bold text-slate-500 block">
              Costo unitario (opcional)
              <input
                type="number" min="0" step="any" inputMode="decimal"
                value={qaCost}
                onChange={(e) => setQaCost(e.target.value)}
                placeholder="0"
                className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </label>
            <button
              onClick={handleQuickAddProduct}
              disabled={qaSaving || !qaName.trim()}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5"
            >
              {qaSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Crear y agregar al lote
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
