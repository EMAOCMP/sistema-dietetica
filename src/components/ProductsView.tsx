import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Product, Supplier, Profile } from '../types';
import { Plus, Search, Edit2, Trash2, Barcode, X, Camera, History, Copy, Download, Percent, PackagePlus, PackageMinus, Tag, Upload, Truck, Clock, ImagePlus, ClipboardCheck, ListOrdered, RotateCcw, QrCode, MessageCircle, Bookmark, BarChart3, AlertTriangle } from 'lucide-react';
import { ScannerModal } from '../features/scanner/components/ScannerModal';
import { useScanner } from '../features/scanner/hooks/useScanner';
import { useBarcodeResolution } from '../features/scanner/hooks/useBarcodeResolution';
import { upsertProductBarcode, deactivateBarcodes } from '../lib/productBarcodes';
import { downloadCsv, stampName } from '../lib/exportCsv';
import { RoundedSelect } from './RoundedSelect';
import { ActionDropdown } from './ActionDropdown';

const daysToExpiry = (p: Product): number | null => {
  if (!p.expiry_date) return null;
  const diff = new Date(p.expiry_date + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime();
  return Math.round(diff / 86400000);
};

const ADJUST_REASONS = [
  { value: 'compra', label: 'Compra a proveedor' },
  { value: 'devolucion', label: 'Devolución cliente' },
  { value: 'ajuste', label: 'Ajuste inventario' },
  { value: 'vencido', label: 'Vencido / rotura' },
];

interface StockMovement {
  id: string;
  type: string;
  quantity: number;
  notes: string | null;
  created_at: string;
  user_name?: string | null;
}

const MOVE_LABELS: Record<string, string> = {
  purchase: 'Ingreso',
  sale: 'Venta',
  adjustment: 'Ajuste',
  return: 'Devolución',
  loss: 'Merma',
  initial: 'Inicial',
  transfer_in: 'Transferencia in',
  transfer_out: 'Transferencia out',
};

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlightMatch(text: string, term: string) {
  if (!term.trim()) return text;
  const parts = text.split(new RegExp(`(${escapeReg(term)})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === term.toLowerCase()
      ? <mark key={i} className="bg-amber-200 dark:bg-amber-400/40 rounded px-0.5">{part}</mark>
      : part
  ) as any;
}

const CATEGORIES_LIST = [
  'Frutos Secos',
  'Semillas',
  'Legumbres',
  'Cereales y Granola',
  'Harinas y Repostería',
  'Especias y Condimentos',
  'Infusiones y Té',
  'Suplementos y Naturales',
  'General',
];

export function ProductsView({ showToast, profile }: { showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void; profile?: Profile | null }) {
  // Vendedor edita todo menos baja/reactivar (lo bloquea RLS + se oculta acá).
  // Solo admin borra y gestiona ubicaciones/usuarios.
  const canManage = ['admin', 'supervisor', 'vendedor'].includes(profile?.role || '');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [localToast, setLocalToast] = useState<string | null>(null);
  const notifyTimer = useRef<number | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string } | null>(null);
  const confirmResolve = useRef<((v: boolean) => void) | null>(null);
  const askConfirm = (message: string): Promise<boolean> =>
    new Promise((resolve) => {
      confirmResolve.current = resolve;
      setConfirmState({ message });
    });
  const answerConfirm = (v: boolean) => {
    setConfirmState(null);
    confirmResolve.current?.(v);
    confirmResolve.current = null;
  };
  // Operaciones complejas que requieren conexión (bulk/merge/conteo/import)
  const requireOnline = (what: string) => {
    if (navigator.onLine) return true;
    notify(`${what} requiere conexión. Se guardará cuando vuelva internet.`, 'warning');
    return false;
  };
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) { showToast(msg, kind); return; }
    setLocalToast(msg);
    if (notifyTimer.current) window.clearTimeout(notifyTimer.current);
    notifyTimer.current = window.setTimeout(
      () => setLocalToast(null),
      kind === 'warning' || kind === 'error' ? 6000 : 3500
    );
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState(CATEGORIES_LIST[0]);
  const [unitType, setUnitType] = useState<'unit' | 'kg'>('unit');
  const [costPrice, setCostPrice] = useState('');
  const [wholesalePrice, setWholesalePrice] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [stockQuantity, setStockQuantity] = useState('');
  const [minStock, setMinStock] = useState('5');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedOk, setScannedOk] = useState(false);

  // Botón central móvil: abre el escáner al navegar desde el sheet
  useEffect(() => {
    const open = () => setScannerOpen(true);
    window.addEventListener('dv:open-scanner', open);
    return () => window.removeEventListener('dv:open-scanner', open);
  }, []);

  // Scanner Core: resolver único centralizado (barcode barcode_normalized + match local)
  const scannerApi = useScanner();
  const { resolve: resolveBarcodeCode } = useBarcodeResolution(products);
  useEffect(() => {
    scannerApi.setOnDetected(resolveBarcodeCode);
    return () => { scannerApi.setOnDetected(null); };
  }, [resolveBarcodeCode]);

  const applyScannedCode = (code: string) => {
    const dupe = products.find((p) => p.barcode === code && p.id !== editingProduct?.id);
    if (dupe) {
      notify(`Atención: ese código ya lo usa "${dupe.name}". Igual se cargó para que lo revises.`, 'warning');
    }
    // Desde el botón central móvil el formulario está cerrado: abrirlo con el código
    if (!modalOpen) handleOpenModal();
    setBarcode(code);
    setScannedOk(true);
    setScannerOpen(false);
    scannerApi.resetStatus();
  };

  // Tab del modal
  const [modalTab, setModalTab] = useState<'datos' | 'precios' | 'stock'>('datos');
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-calc precios
  const [autoMargin, setAutoMargin] = useState('');
  const [autoCalcField, setAutoCalcField] = useState<'wholesale' | 'retail'>('wholesale');

  // Duplicados detection
  const [nameDuplicates, setNameDuplicates] = useState<Product[]>([]);

  // Barcode preview canvas
  const barcodeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Último proveedor usado
  const lastSupplier = (() => {
    try { return localStorage.getItem('dv-last-supplier') || ''; } catch { return ''; }
  })();

  // Filtros y orden
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'critical'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'wholesale' | 'retail' | 'expiry' | 'rotation'>('name');

  // Ajuste rápido de stock
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustMode, setAdjustMode] = useState<'in' | 'out'>('in');
  const [adjustReason, setAdjustReason] = useState('compra');
  const [savingAdjust, setSavingAdjust] = useState(false);

  // Historial de movimientos
  const [movesProduct, setMovesProduct] = useState<Product | null>(null);
  const [moves, setMoves] = useState<StockMovement[]>([]);
  const [loadingMoves, setLoadingMoves] = useState(false);

  // Aumento masivo
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('all');
  const [bulkField, setBulkField] = useState<'both' | 'wholesale' | 'retail'>('both');
  const [bulkPercent, setBulkPercent] = useState('10');
  const [savingBulk, setSavingBulk] = useState(false);

  // Vencimientos
  const [expiryDate, setExpiryDate] = useState('');
  const [expiryFilter, setExpiryFilter] = useState(false);

  // Proveedores
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');

  // Historial de precios
  const [priceHistProduct, setPriceHistProduct] = useState<Product | null>(null);
  const [priceHist, setPriceHist] = useState<any[]>([]);
  const [loadingPriceHist, setLoadingPriceHist] = useState(false);

  // Etiquetas
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labelQty, setLabelQty] = useState<Record<string, number>>({});

  // Importación CSV
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  // Inactivos
  const [showInactive, setShowInactive] = useState(false);

  // Foto
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Conteo físico
  const [countOpen, setCountOpen] = useState(false);
  const [countSearch, setCountSearch] = useState('');
  const [countLines, setCountLines] = useState<{ product: Product; counted: string }[]>([]);
  const [savingCount, setSavingCount] = useState(false);

  // Rotación
  const [rotation, setRotation] = useState<Record<string, { last: string; qty: number }>>({});

  // Densidad tabla
  const [density, setDensity] = useState<'comfortable' | 'compact'>(() => {
    try { return (localStorage.getItem('dv-density') as any) || 'comfortable'; } catch { return 'comfortable'; }
  });
  // Selección múltiple + expandible
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Margen objetivo
  const [targetMargin, setTargetMargin] = useState(() => {
    try {
      return localStorage.getItem('dv-target-margin') || '40';
    } catch {
      return '40';
    }
  });
  const [savingTarget, setSavingTarget] = useState(false);

  // Duplicados
  const [dupesOpen, setDupesOpen] = useState(false);
  const [mergingId, setMergingId] = useState<string | null>(null);

  // Filtros guardados
  const [savedFilters, setSavedFilters] = useState<Array<{ name: string; category: string; stock: string; sort: string; expiry: boolean }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('dv-saved-filters') || '[]');
    } catch { return []; }
  });
  const [filterNameInput, setFilterNameInput] = useState('');
  const [showSaveFilter, setShowSaveFilter] = useState(false);

  // Rotación dashboard
  const [rotationDashOpen, setRotationDashOpen] = useState(false);
  const [rotSort, setRotSort] = useState<'recent' | 'volume'>('recent');

  // Generador de código de barras
  const generateBarcode = () => {
    const code = Date.now().toString().slice(-13).padStart(13, '0');
    setBarcode(code);
    setScannedOk(false);
  };

  const marginOf = (p: Product) => {
    const w = Number(p.wholesale_price);
    if (w <= 0) return null;
    return ((w - Number(p.cost_price)) / w) * 100;
  };

  useEffect(() => {
    fetchProducts();
    fetchSuppliers();
    fetchRotation();
    // Búsqueda entrante desde el dashboard (buscador rápido)
    try {
      const q = localStorage.getItem('dv-product-search');
      if (q) {
        setSearchTerm(q);
        localStorage.removeItem('dv-product-search');
      }
    } catch { /* noop */ }
  }, []);

  // Autofocus al abrir modal
  useEffect(() => {
    if (modalOpen && modalTab === 'datos') {
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [modalOpen, modalTab]);

  // Detección de duplicados por nombre
  useEffect(() => {
    if (!modalOpen || !name.trim() || name.length < 3) {
      setNameDuplicates([]);
      return;
    }
    const q = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const matches = activeProducts.filter((p) => {
      if (editingProduct && p.id === editingProduct.id) return false;
      const pname = p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return pname.includes(q) || q.includes(pname);
    }).slice(0, 3);
    setNameDuplicates(matches);
  }, [name, modalOpen]);

  // Renderizar preview de código de barras
  useEffect(() => {
    if (!modalOpen || !barcode || barcode.length < 4 || !barcodeCanvasRef.current) return;
    let cancelled = false;
    const render = async () => {
      try {
        // Cargar bwip-js desde CDN si no está cargado
        if (!(window as any).bwipjs) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/bwip-js@4.3.0/dist/bwip-js-min.js';
            s.onload = () => resolve();
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        if (cancelled || !barcodeCanvasRef.current || !(window as any).bwipjs) return;
        (window as any).bwipjs.toCanvas(barcodeCanvasRef.current, {
          bcid: 'code128',
          text: barcode,
          scale: 2,
          height: 40,
          includetext: true,
          textxalign: 'center',
        });
      } catch { /* barcode inválido o sin internet */ }
    };
    render();
    return () => { cancelled = true; };
  }, [barcode, modalOpen]);

  // Auto-calcular precios
  const handleAutoCalc = () => {
    const cost = parseFloat(costPrice) || 0;
    const margin = parseFloat(autoMargin) || 0;
    if (cost <= 0 || margin <= 0 || margin >= 100) return;
    const price = Math.round((cost / (1 - margin / 100)) * 100) / 100;
    if (autoCalcField === 'wholesale') {
      setWholesalePrice(price.toString());
      if (parseFloat(retailPrice) < price) setRetailPrice(price.toString());
    } else {
      setRetailPrice(price.toString());
    }
  };

  // Guardar último proveedor usado
  useEffect(() => {
    if (supplierId) {
      try { localStorage.setItem('dv-last-supplier', supplierId); } catch { /* noop */ }
    }
  }, [supplierId]);

  const fetchRotation = async () => {
    try {
      const { data, error } = await supabase
        .from('sale_items')
        .select('product_id, quantity, sales(created_at)')
        .limit(5000);
      if (error) throw error;
      const map: Record<string, { last: string; qty: number }> = {};
      (data || []).forEach((row: any) => {
        const dt = row.sales?.created_at;
        if (!dt) return;
        const cur = map[row.product_id];
        if (!cur || dt > cur.last) {
          map[row.product_id] = { last: dt, qty: (cur?.qty || 0) + Number(row.quantity) };
        } else {
          cur.qty += Number(row.quantity);
        }
      });
      setRotation(map);
    } catch {
      setRotation({});
    }
  };

  const daysSince = (iso: string) =>
    Math.round((new Date(new Date().toDateString()).getTime() - new Date(iso).getTime()) / 86400000);

  const normName = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  const fetchSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      setSuppliers(data || []);
    } catch {
      setSuppliers([]);
    }
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setProducts(data || []);
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setBarcode(product.barcode || '');
      setName(product.name);
      setCategory(product.category || CATEGORIES_LIST[0]);
      setUnitType(product.unit_type);
      setCostPrice(product.cost_price.toString());
      setWholesalePrice(product.wholesale_price.toString());
      setRetailPrice(product.retail_price.toString());
      setStockQuantity(product.stock_quantity.toString());
      setMinStock((product.min_stock || 5).toString());
      setExpiryDate(product.expiry_date || '');
      setSupplierId(product.supplier_id || '');
      setImageUrl(product.image_url || '');
    } else {
      setEditingProduct(null);
      setBarcode('');
      setName('');
      setCategory(CATEGORIES_LIST[0]);
      setUnitType('unit');
      setCostPrice('');
      setWholesalePrice('');
      setRetailPrice('');
      setStockQuantity('');
      setMinStock('5');
      setExpiryDate('');
      setSupplierId(lastSupplier);
      setImageUrl('');
    }
    setAutoMargin('');
    setNameDuplicates([]);
    setModalTab('datos');
    setModalOpen(true);
  };

  const handleReactivate = async (product: Product) => {
    if (!navigator.onLine) {
      const { enqueueProductUpdate } = await import('../lib/offlineDB');
      await enqueueProductUpdate({ id: product.id, is_active: true });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_active: true } : p)));
      notify('Sin conexión: reactivación encolada, se sincronizará sola.', 'success');
      return;
    }
    try {
      const { error } = await supabase.from('products').update({ is_active: true }).eq('id', product.id);
      if (error) throw error;
      fetchProducts();
    } catch (err: any) {
      notify('Error al reactivar: ' + err.message, 'error');
    }
  };

  const handlePhotoUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!requireOnline('Subir fotos')) return;
    if (file.size > 2 * 1024 * 1024) {
      notify('La foto debe pesar menos de 2MB.');
      return;
    }
    setUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upError } = await supabase.storage.from('product-images').upload(path, file);
      if (upError) throw upError;
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (err: any) {
      notify('No se pudo subir la foto: ' + err.message + ' (¿corriste el SQL del bucket?)', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePrintPriceList = () => {
    const rows = filteredProducts
      .map(
        (p) => `
      <tr>
        <td>${p.name}</td>
        <td class="num">$${Number(p.wholesale_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num">$${Number(p.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`
      )
      .join('');
    const win = window.open('', '_blank', 'width=720,height=640');
    if (!win) {
      notify('Permití ventanas emergentes para imprimir.');
      return;
    }
    win.document.write(`
      <html><head><title>Lista de precios</title>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Plus Jakarta Sans', Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 24px; color: #111; }
        h1 { text-align: center; font-size: 22px; letter-spacing: 3px; }
        .sub { text-align: center; color: #555; font-size: 12px; margin: 4px 0 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; font-size: 11px; letter-spacing: 1px; color: #555; border-bottom: 2px solid #111; padding: 6px 4px; }
        td { border-bottom: 1px dashed #bbb; padding: 6px 4px; }
        .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
      </style>
      </head><body>
        <h1>DIETÉTICA VISHAL</h1>
        <div class="sub">Lista de precios • ${new Date().toLocaleDateString('es-AR')} • ${filteredProducts.length} productos</div>
        <table><thead><tr><th>Producto</th><th style="text-align:right">Mayorista</th><th style="text-align:right">Minorista</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <script>window.onload=function(){window.focus();window.print();}</script>
      </body></html>`);
    win.document.close();
  };

  const liveMargin = (price: string) => {
    const cost = parseFloat(costPrice) || 0;
    const sell = parseFloat(price) || 0;
    if (sell <= 0) return null;
    return (((sell - cost) / sell) * 100).toFixed(1);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const code = barcode.trim();
      if (code) {
        let q = supabase.from('products').select('id, name').eq('barcode', code).limit(1);
        if (editingProduct) q = q.neq('id', editingProduct.id);
        const { data: dupe } = await q.maybeSingle();
        if (dupe) {
          notify(`Ese código ya lo usa "${(dupe as any).name}". Cambialo antes de guardar.`, 'warning');
          return;
        }
        // También buscar en aliases de otros productos
        try {
          const { data: aliasHit } = await supabase
            .from('product_barcodes')
            .select('product_id, products(id, name)')
            .eq('barcode', code)
            .limit(5);
          const other = ((aliasHit || []) as any[]).find(
            (r) => r.product_id !== editingProduct?.id
          );
          if (other?.products) {
            notify(`Ese código ya es alias de "${other.products.name}". Cambialo antes de guardar.`, 'warning');
            return;
          }
        } catch { /* tabla puede no existir todavía */ }
        }
      const cost = parseFloat(costPrice) || 0;
      const whole = parseFloat(wholesalePrice) || 0;
      const retail = parseFloat(retailPrice) || 0;
      if ((whole > 0 && whole < cost) || (retail > 0 && retail < cost)) {
        if (!(await askConfirm('Atención: un precio quedó POR DEBAJO del costo (venta a pérdida). ¿Guardar igual?'))) return;
      }
      const productData: any = {
        barcode: barcode.trim() || null,
        name: name.trim(),
        category: category,
        unit_type: unitType,
        cost_price: parseFloat(costPrice) || 0,
        wholesale_price: parseFloat(wholesalePrice) || 0,
        retail_price: parseFloat(retailPrice) || 0,
        stock_quantity: parseFloat(stockQuantity) || 0,
        min_stock: parseFloat(minStock) || 5,
        expiry_date: expiryDate || null,
        supplier_id: supplierId || null,
        image_url: imageUrl.trim() || null,
        is_active: true,
      };

      const saveWithFallback = async () => {
        try {
          if (editingProduct) {
            const { error } = await supabase.from('products').update(productData).eq('id', editingProduct.id);
            if (error) throw error;
            return editingProduct.id;
          }
          const { data, error } = await supabase.from('products').insert([productData]).select('id').single();
          if (error) throw error;
          return (data as any)?.id as string;
        } catch (err: any) {
          if (err?.message?.includes('column') || err?.code === '42703') {
            delete productData.expiry_date;
            delete productData.supplier_id;
            delete productData.image_url;
            if (editingProduct) {
              const { error } = await supabase.from('products').update(productData).eq('id', editingProduct.id);
              if (error) throw error;
              return editingProduct.id;
            }
            const { data, error } = await supabase.from('products').insert([productData]).select('id').single();
            if (error) throw error;
            return (data as any)?.id as string;
          }
          throw err;
        }
      };

      // Sin conexión: encolar para sincronizar después
      if (!navigator.onLine) {
        const { enqueueProductCreate, enqueueProductUpdate } = await import('../lib/offlineDB');
        if (editingProduct) {
          await enqueueProductUpdate({ id: editingProduct.id, ...productData });
          setProducts((prev) => prev.map((p) => (p.id === editingProduct.id ? { ...p, ...productData } : p)));
        } else {
          await enqueueProductCreate(productData);
        }
        setModalOpen(false);
        notify('Sin conexión: producto encolado, se sincronizará solo.', 'success');
        return;
      }

      const savedId = await saveWithFallback();

      // P4: registrar/sincronizar el código en product_barcodes (servicio central)
      if (savedId) {
        const code = (productData.barcode as string) || '';
        if (code) {
          const res = await upsertProductBarcode(savedId, code);
          if (res.error) notify(`Producto guardado, pero el código no se registró: ${res.error}`, 'warning');
        } else if (editingProduct?.barcode) {
          const res = await deactivateBarcodes(savedId);
          if (res.error) notify(`No se pudieron actualizar los códigos del producto: ${res.error}`, 'warning');
        }
      }

      // Historial de precios (si cambiaron; tabla opcional)
      try {
        const changed =
          !editingProduct ||
          Number(editingProduct.cost_price) !== Number(productData.cost_price) ||
          Number(editingProduct.wholesale_price) !== Number(productData.wholesale_price) ||
          Number(editingProduct.retail_price) !== Number(productData.retail_price);
        if (changed && savedId) {
          await supabase.from('product_price_history').insert({
            product_id: savedId,
            cost_price: productData.cost_price,
            wholesale_price: productData.wholesale_price,
            retail_price: productData.retail_price,
          });
        }
      } catch { /* tabla opcional */ }

      setModalOpen(false);
      fetchProducts();
    } catch (err: any) {
      notify('Error al guardar el producto: ' + err.message, 'error');
    }
  };

  const handleSoftDelete = async (product: Product) => {
    if (!(await askConfirm(`¿Estás seguro de dar de baja el producto "${product.name}"? Se mantendrá en el histórico de ventas.`))) {
      return;
    }

    if (!navigator.onLine) {
      const { enqueueProductUpdate } = await import('../lib/offlineDB');
      await enqueueProductUpdate({ id: product.id, is_active: false });
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_active: false } : p)));
      notify('Sin conexión: baja encolada, se sincronizará sola.', 'success');
      return;
    }

    try {
      const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', product.id);

      if (error) throw error;
      fetchProducts();
    } catch (err: any) {
      notify('Error al dar de baja el producto: ' + err.message, 'error');
    }
  };

  const activeProducts = products.filter((p) => p.is_active);
  const inactiveProducts = products.filter((p) => !p.is_active);
  const filteredProducts = products
    .filter((p) => (showInactive ? !p.is_active : p.is_active))
    .filter((p) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(searchTerm)) ||
        (p.category && p.category.toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (categoryFilter !== 'all' && (p.category || 'General') !== categoryFilter) return false;
      if (stockFilter === 'critical' && Number(p.stock_quantity) > Number(p.min_stock || 5)) return false;
      if (expiryFilter) {
        const d = daysToExpiry(p);
        if (d === null || d > 30) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'stock') return Number(a.stock_quantity) - Number(b.stock_quantity);
      if (sortBy === 'wholesale') return Number(b.wholesale_price) - Number(a.wholesale_price);
      if (sortBy === 'retail') return Number(b.retail_price) - Number(a.retail_price);
      if (sortBy === 'expiry') {
        const da = daysToExpiry(a);
        const db = daysToExpiry(b);
        if (da === null && db === null) return 0;
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      }
      if (sortBy === 'rotation') {
        const score = (p: Product) => {
          const r = rotation[p.id];
          return r ? -daysSince(r.last) : -99999;
        };
        return score(a) - score(b);
      }
      return a.name.localeCompare(b.name, 'es');
    });

  const dupeGroups = (() => {
    const byKey = new Map<string, Product[]>();
    activeProducts.forEach((p) => {
      const key = p.barcode ? `code:${p.barcode}` : `name:${normName(p.name)}`;
      const arr = byKey.get(key) || [];
      arr.push(p);
      byKey.set(key, arr);
    });
    return Array.from(byKey.values()).filter((g) => g.length > 1);
  })();

  const belowTarget = activeProducts.filter((p) => {
    const m = marginOf(p);
    return m !== null && m < parseFloat(targetMargin || '40');
  });

  const handleApplyTarget = async () => {
    if (!requireOnline('Aplicar margen objetivo')) return;
    const m = parseFloat(targetMargin);
    if (!m || m <= 0 || m >= 100) {
      notify('Ingresá un margen objetivo entre 1 y 99.', 'warning');
      return;
    }
    const targets = activeProducts.filter((p) => {
      const mg = marginOf(p);
      return mg !== null && mg < m;
    });
    if (targets.length === 0) {
      notify('Ningún producto está por debajo del objetivo.', 'warning');
      return;
    }
    if (!(await askConfirm(`¿Llevar ${targets.length} productos al ${m}% de margen mayorista?`))) return;
    setSavingTarget(true);
    try {
      for (const p of targets) {
        const wholesale = Math.round((Number(p.cost_price) / (1 - m / 100)) * 100) / 100;
        const update: any = { wholesale_price: wholesale };
        if (Number(p.retail_price) < wholesale) update.retail_price = wholesale;
        const { error } = await supabase.from('products').update(update).eq('id', p.id);
        if (error) throw error;
      }
      fetchProducts();
      notify('Precios llevados al objetivo.', 'success');
    } catch (err: any) {
      notify('Error: ' + err.message, 'error');
    } finally {
      setSavingTarget(false);
    }
  };

  const handleMergeGroup = async (group: Product[], keeperId: string) => {
    if (!requireOnline('Fusionar duplicados')) return;
    const keeper = group.find((p) => p.id === keeperId)!;
    const others = group.filter((p) => p.id !== keeperId);
    if (!(await askConfirm(`¿Fusionar ${others.length} en "${keeper.name}"? Se suma el stock y se da de baja al resto.`))) return;
    setMergingId(keeperId);
    try {
      const otherIds = others.map((p) => p.id);
      const totalStock = Math.round((Number(keeper.stock_quantity) + others.reduce((a, p) => a + Number(p.stock_quantity), 0)) * 100) / 100;
      const { error: itemsError } = await supabase.from('sale_items').update({ product_id: keeperId }).in('product_id', otherIds);
      if (itemsError) throw itemsError;
      try {
        await supabase.from('stock_movements').update({ product_id: keeperId }).in('product_id', otherIds);
        await supabase.from('product_price_history').update({ product_id: keeperId }).in('product_id', otherIds);
      } catch { /* historiales opcionales */ }
      const { error: stockError } = await supabase.from('products').update({ stock_quantity: totalStock }).eq('id', keeperId);
      if (stockError) throw stockError;
      const { error: offError } = await supabase.from('products').update({ is_active: false }).in('id', otherIds);
      if (offError) throw offError;
      setDupesOpen(false);
      fetchProducts();
      fetchRotation();
      notify('Productos fusionados.', 'success');
    } catch (err: any) {
      notify('Error al fusionar (¿tablas de historial existentes?): ' + err.message, 'error');
    } finally {
      setMergingId(null);
    }
  };

  // Filtros guardados
  const saveCurrentFilter = () => {
    if (!filterNameInput.trim()) return;
    const newFilter = {
      name: filterNameInput.trim(),
      category: categoryFilter,
      stock: stockFilter,
      sort: sortBy,
      expiry: expiryFilter,
    };
    const updated = [...savedFilters.filter((f) => f.name !== newFilter.name), newFilter];
    setSavedFilters(updated);
    localStorage.setItem('dv-saved-filters', JSON.stringify(updated));
    setFilterNameInput('');
    setShowSaveFilter(false);
  };

  const applySavedFilter = (f: typeof savedFilters[0]) => {
    setCategoryFilter(f.category);
    setStockFilter(f.stock as any);
    setSortBy(f.sort as any);
    setExpiryFilter(f.expiry);
  };

  const deleteSavedFilter = (name: string) => {
    const updated = savedFilters.filter((f) => f.name !== name);
    setSavedFilters(updated);
    localStorage.setItem('dv-saved-filters', JSON.stringify(updated));
  };

  // WhatsApp alerta stock crítico
  const sendWhatsAppAlert = (products: Product[]) => {
    const supplierGroups = new Map<string, Product[]>();
    products.forEach((p) => {
      const key = p.supplier_id || 'sin-proveedor';
      if (!supplierGroups.has(key)) supplierGroups.set(key, []);
      supplierGroups.get(key)!.push(p);
    });
    for (const [sid, prods] of supplierGroups) {
      const supplier = suppliers.find((s) => s.id === sid);
      const phone = supplier?.phone?.replace(/\D/g, '') || '';
      const list = prods.map((p) => `• ${p.name}: stock ${p.stock_quantity} (mín ${p.min_stock || 5})`).join('%0A');
      const msg = `Hola, necesito reponer:${list}`;
      const url = phone ? `https://wa.me/${phone}?text=${msg}` : `https://wa.me/?text=${encodeURIComponent(msg.replace(/%0A/g, '\n'))}`;
      window.open(url, '_blank');
    }
  };

  const valuation = activeProducts.reduce(
    (acc, p) => ({
      cost: acc.cost + Number(p.cost_price) * Number(p.stock_quantity),
      sale: acc.sale + Number(p.wholesale_price) * Number(p.stock_quantity),
    }),
    { cost: 0, sale: 0 }
  );

  const handleSaveAdjust = async () => {
    if (!adjustProduct) return;
    const qty = parseFloat(adjustQty);
    if (!qty || qty <= 0) {
      notify('Ingresá una cantidad mayor a 0.', 'warning');
      return;
    }
    const signed = adjustMode === 'in' ? qty : -qty;
    const reasonLabel = ADJUST_REASONS.find((r) => r.value === adjustReason)?.label || adjustReason;
    setSavingAdjust(true);
    try {
      const newStock = Math.round((Number(adjustProduct.stock_quantity) + signed) * 100) / 100;
      if (newStock < 0) {
        notify('El stock no puede quedar negativo.', 'warning');
        return;
      }
      if (!navigator.onLine) {
        const { enqueueStockAdjustment } = await import('../lib/offlineDB');
        await enqueueStockAdjustment({
          product_id: adjustProduct.id,
          quantity_change: signed,
          reason: `${adjustMode === 'in' ? 'Entrada' : 'Salida'}: ${reasonLabel}`,
          user_id: null,
        });
        setProducts((prev) => prev.map((p) => (p.id === adjustProduct.id ? { ...p, stock_quantity: newStock } : p)));
        setAdjustProduct(null);
        setAdjustQty('');
        notify('Sin conexión: ajuste encolado, se sincronizará solo.', 'success');
        return;
      }
      const { error: stockError } = await supabase
        .from('products')
        .update({ stock_quantity: newStock })
        .eq('id', adjustProduct.id);
      if (stockError) throw stockError;
      const { error: movError } = await supabase.from('stock_movements').insert({
        product_id: adjustProduct.id,
        type: 'adjustment',
        quantity: signed,
        notes: `${adjustMode === 'in' ? 'Entrada' : 'Salida'}: ${reasonLabel} (${signed > 0 ? '+' : ''}${signed})`,
      });
      if (movError) throw movError;
      setAdjustProduct(null);
      setAdjustQty('');
      fetchProducts();
    } catch (err: any) {
      notify('Error al ajustar stock: ' + err.message, 'error');
    } finally {
      setSavingAdjust(false);
    }
  };

  const openMoves = async (product: Product) => {
    setMovesProduct(product);
    setMoves([]);
    setLoadingMoves(true);
    try {
      const resolveNames = async (ids: (string | null)[]) => {
        const uniq = [...new Set(ids.filter(Boolean))] as string[];
        if (!uniq.length) return {} as Record<string, string>;
        const { data } = await supabase.from('profiles').select('id, full_name').in('id', uniq);
        return Object.fromEntries((data || []).map((p: any) => [p.id, p.full_name]));
      };
      // Modelo nuevo con autor
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('id, type, quantity, previous_quantity, new_quantity, reference_type, user_id, created_at')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      if ((data || []).length > 0) {
        const names = await resolveNames((data || []).map((m: any) => m.user_id));
        setMoves((data || []).map((m: any) => ({
          id: m.id,
          type: m.type,
          quantity: Number(m.quantity),
          notes: `${MOVE_LABELS[m.type] || m.type}${m.reference_type ? ` · ${m.reference_type}` : ''}${m.previous_quantity != null && m.new_quantity != null ? ` (${m.previous_quantity} → ${m.new_quantity})` : ''}`,
          created_at: m.created_at,
          user_name: (m.user_id && names[m.user_id]) || null,
        })));
        return;
      }
      // Fallback legado
      const legacy = await supabase
        .from('stock_movements')
        .select('id, type, quantity, notes, user_id, created_at')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (legacy.error) throw legacy.error;
      const names = await resolveNames((legacy.data || []).map((m: any) => m.user_id));
      setMoves((legacy.data || []).map((m: any) => ({
        id: m.id,
        type: m.type,
        quantity: Number(m.quantity),
        notes: m.notes || m.type,
        created_at: m.created_at,
        user_name: (m.user_id && names[m.user_id]) || null,
      })));
    } catch (err: any) {
      notify('Error al cargar movimientos: ' + err.message, 'error');
    } finally {
      setLoadingMoves(false);
    }
  };

  const handleDuplicate = (product: Product) => {
    setEditingProduct(null);
    setBarcode('');
    setScannedOk(false);
    setImageUrl(product.image_url || '');
    setName(`${product.name} (copia)`);
    setCategory(product.category || CATEGORIES_LIST[0]);
    setUnitType(product.unit_type);
    setCostPrice(product.cost_price.toString());
    setWholesalePrice(product.wholesale_price.toString());
    setRetailPrice(product.retail_price.toString());
    setStockQuantity('0');
    setMinStock((product.min_stock || 5).toString());
    setExpiryDate(product.expiry_date || '');
    setSupplierId(product.supplier_id || '');
    setModalTab('datos');
    setModalOpen(true);
  };

  const openPriceHist = async (product: Product) => {
    setPriceHistProduct(product);
    setPriceHist([]);
    setLoadingPriceHist(true);
    try {
      const { data, error } = await supabase
        .from('product_price_history')
        .select('*')
        .eq('product_id', product.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setPriceHist(data || []);
    } catch {
      setPriceHist([]);
    } finally {
      setLoadingPriceHist(false);
    }
  };

  const handlePrintLabels = () => {
    const items = filteredProducts.filter((p) => (labelQty[p.id] || 0) > 0);
    if (items.length === 0) {
      notify('Elegí cantidad de etiquetas en al menos un producto.', 'warning');
      return;
    }
    const labels = items
      .map((p) => {
        const q = Math.min(labelQty[p.id] || 0, 50);
        const code = p.barcode || '';
        return Array.from({ length: q })
          .map(
            () => `
          <div class="label">
            <div class="lname">${p.name}</div>
            <div class="lprice">$${Number(p.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            ${code ? `<canvas class="bcode" data-code="${code}"></canvas><div class="ccode">${code}</div>` : `<div class="ccode">SIN CÓDIGO</div>`}
          </div>`
          )
          .join('');
      })
      .join('');
    const win = window.open('', '_blank', 'width=640,height=640');
    if (!win) {
      notify('Permití ventanas emergentes para imprimir.');
      return;
    }
    win.document.write(`
      <html><head><title>Etiquetas</title>
      <script src="https://cdn.jsdelivr.net/npm/bwip-js@4.3.0/dist/bwip-js-min.js"><\/script>
      <style>
        @page { size: auto; margin: 5mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; display: flex; flex-wrap: wrap; gap: 3mm; }
        .label { width: 48mm; min-height: 28mm; border: 1px dashed #999; padding: 2mm; text-align: center; page-break-inside: avoid; }
        .lname { font-size: 9pt; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lprice { font-size: 13pt; font-weight: 900; margin: 1mm 0; }
        canvas.bcode { width: 100%; height: 9mm; }
        .ccode { font-size: 8pt; letter-spacing: 1px; }
      </style>
      </head><body>${labels}
      <script>
        window.onload = function() {
          try {
            document.querySelectorAll('canvas.bcode').forEach(function(c) {
              bwipjs.toCanvas(c, { bcid: 'code128', text: c.getAttribute('data-code'), scale: 2, height: 9, includetext: false });
            });
          } catch (e) { /* sin internet: queda el número */ }
          setTimeout(function(){ window.focus(); window.print(); }, 400);
        };
      <\/script>
      </body></html>`);
    win.document.close();
  };

  const addToCount = (product: Product) => {
    setCountLines((prev) => {
      if (prev.some((l) => l.product.id === product.id)) return prev;
      return [...prev, { product, counted: '' }];
    });
  };

  const applyCount = async () => {
    if (!requireOnline('Aplicar conteo')) return;
    const diffs = countLines
      .map((l) => ({ product: l.product, counted: parseFloat(l.counted) }))
      .filter((d) => !isNaN(d.counted));
    if (diffs.length === 0) {
      notify('Cargá al menos una cantidad contada.', 'warning');
      return;
    }
    if (!(await askConfirm(`¿Aplicar ${diffs.length} ajustes de conteo físico?`))) return;
    setSavingCount(true);
    try {
      for (const d of diffs) {
        const diff = Math.round((d.counted - Number(d.product.stock_quantity)) * 100) / 100;
        if (diff === 0) continue;
        const { error: stockError } = await supabase
          .from('products')
          .update({ stock_quantity: d.counted })
          .eq('id', d.product.id);
        if (stockError) throw stockError;
        await supabase.from('stock_movements').insert({
          product_id: d.product.id,
          type: 'adjustment',
          quantity: diff,
          notes: `Conteo físico: sistema ${d.product.stock_quantity} → contado ${d.counted}`,
        });
      }
      setCountOpen(false);
      setCountLines([]);
      setCountSearch('');
      fetchProducts();
      notify('Conteo aplicado correctamente.', 'success');
    } catch (err: any) {
      notify('Error al aplicar conteo: ' + err.message, 'error');
    } finally {
      setSavingCount(false);
    }
  };

  const downloadImportTemplate = () => {
    downloadCsv(
      'plantilla-productos.csv',
      ['nombre', 'codigo', 'categoria', 'tipo', 'costo', 'mayorista', 'minorista', 'stock', 'minimo'],
      [['Harina Integral x 1kg', '7790000000000', 'Harinas y Repostería', 'unit', 800, 1200, 1500, 20, 5]]
    );
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const clean = text.replace(/^\uFEFF/, '').trim();
    if (!clean) {
      notify('El archivo está vacío.', 'warning');
      return;
    }
    const lines = clean.split(/\r?\n/);
    const rows = lines.slice(1).filter((l) => l.trim()).map((line, idx) => {
      const cols = line.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
      const [nombre, codigo, categoria, tipo, costo, mayorista, minorista, stock, minimo] = cols;
      const errors: string[] = [];
      if (!nombre) errors.push('sin nombre');
      if (tipo && !['unit', 'kg'].includes(tipo.toLowerCase())) errors.push('tipo debe ser unit o kg');
      ['costo', 'mayorista', 'minorista', 'stock', 'minimo'].forEach((k, i) => {
        const v = [costo, mayorista, minorista, stock, minimo][i];
        if (v && isNaN(Number(v.replace(',', '.')))) errors.push(`${k} no numérico`);
      });
      const existing = codigo ? products.find((p) => p.barcode === codigo) : null;
      const diffCosto = existing && costo ? Number(costo.replace(',', '.')) - Number(existing.cost_price) : null;
      const diffMayorista = existing && mayorista ? Number(mayorista.replace(',', '.')) - Number(existing.wholesale_price) : null;
      const diffMinorista = existing && minorista ? Number(minorista.replace(',', '.')) - Number(existing.retail_price) : null;
      return { line: idx + 2, nombre, codigo, categoria, tipo: (tipo || 'unit').toLowerCase(), costo, mayorista, minorista, stock, minimo, errors, existing, diffCosto, diffMayorista, diffMinorista };
    });
    setImportRows(rows);
  };

  const handleConfirmImport = async () => {
    if (!requireOnline('Importar productos')) return;
    const valid = importRows.filter((r) => r.errors.length === 0 && r.nombre);
    if (valid.length === 0) {
      notify('No hay filas válidas para importar.', 'warning');
      return;
    }
    setImporting(true);
    try {
      const payload = valid.map((r) => ({
        name: r.nombre,
        barcode: r.codigo || null,
        category: r.categoria || 'General',
        unit_type: r.tipo === 'kg' ? 'kg' : 'unit',
        cost_price: Number((r.costo || '0').replace(',', '.')) || 0,
        wholesale_price: Number((r.mayorista || '0').replace(',', '.')) || 0,
        retail_price: Number((r.minorista || '0').replace(',', '.')) || 0,
        stock_quantity: Number((r.stock || '0').replace(',', '.')) || 0,
        min_stock: Number((r.minimo || '5').replace(',', '.')) || 5,
        is_active: true,
      }));
      const { error } = await supabase.from('products').insert(payload);
      if (error) throw error;
      setImportOpen(false);
      setImportRows([]);
      fetchProducts();
      notify(`${valid.length} productos importados.`, 'success');
    } catch (err: any) {
      notify('Error al importar: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleAddSupplier = async () => {
    if (!newSupplierName.trim()) {
      notify('Ingresá el nombre del proveedor.', 'warning');
      return;
    }
    if (!requireOnline('Agregar proveedor')) return;
    try {
      const { error } = await supabase.from('suppliers').insert({
        name: newSupplierName.trim(),
        phone: newSupplierPhone.trim() || null,
      });
      if (error) throw error;
      setNewSupplierName('');
      setNewSupplierPhone('');
      fetchSuppliers();
    } catch (err: any) {
      notify('Error al guardar proveedor: ' + err.message + ' (¿corriste el SQL de proveedores?)', 'error');
    }
  };

  const handleExportProducts = () => {
    downloadCsv(
      stampName('productos'),
      ['Nombre', 'Código', 'Categoría', 'Tipo', 'Costo', 'Mayorista', 'Minorista', 'Margen mayorista %', 'Stock', 'Stock mín', 'Estado'],
      filteredProducts.map((p) => {
        const margin = Number(p.wholesale_price) > 0
          ? (((Number(p.wholesale_price) - Number(p.cost_price)) / Number(p.wholesale_price)) * 100).toFixed(1)
          : '0';
        return [
          p.name, p.barcode || '', p.category || 'General', p.unit_type,
          p.cost_price, p.wholesale_price, p.retail_price, margin,
          p.stock_quantity, p.min_stock ?? 5,
          Number(p.stock_quantity) <= Number(p.min_stock || 5) ? 'CRÍTICO' : 'OK',
        ];
      })
    );
  };

  const handleBulkApply = async () => {
    if (!requireOnline('Aumento masivo de precios')) return;
    const pct = parseFloat(bulkPercent);
    if (!pct || pct <= -100) {
      notify('Ingresá un porcentaje válido (mayor a -100).', 'warning');
      return;
    }
    const targets = activeProducts.filter((p) => bulkCategory === 'all' || (p.category || 'General') === bulkCategory);
    if (targets.length === 0) {
      notify('No hay productos para esa categoría.', 'warning');
      return;
    }
    if (!(await askConfirm(`¿Aplicar ${pct > 0 ? '+' : ''}${pct}% a ${bulkField === 'both' ? 'mayorista y minorista' : bulkField === 'wholesale' ? 'mayorista' : 'minorista'} de ${targets.length} productos?`))) return;
    setSavingBulk(true);
    try {
      const factor = 1 + pct / 100;
      for (const p of targets) {
        const update: any = {};
        if (bulkField === 'both' || bulkField === 'wholesale') {
          update.wholesale_price = Math.round(Number(p.wholesale_price) * factor * 100) / 100;
        }
        if (bulkField === 'both' || bulkField === 'retail') {
          update.retail_price = Math.round(Number(p.retail_price) * factor * 100) / 100;
        }
        const { error } = await supabase.from('products').update(update).eq('id', p.id);
        if (error) throw error;
      }
      setBulkOpen(false);
      fetchProducts();
      notify('Precios actualizados correctamente.', 'success');
    } catch (err: any) {
      notify('Error en aumento masivo: ' + err.message, 'error');
    } finally {
      setSavingBulk(false);
    }
  };

  const expiringSoon = activeProducts.filter((p) => {
    const d = daysToExpiry(p);
    return d !== null && d <= 30;
  }).length;

  const criticalProducts = activeProducts.filter((p) => Number(p.stock_quantity) <= Number(p.min_stock || 5));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      {localToast && !showToast && (
        <div className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-lg">
          {localToast}
        </div>
      )}
      {confirmState && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50" onClick={() => answerConfirm(false)}>
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl border border-transparent dark:border-[#333333]" onClick={(e) => e.stopPropagation()}>
            <p className="font-bold text-slate-900 dark:text-white text-sm leading-relaxed">{confirmState.message}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => answerConfirm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-white rounded-xl text-sm font-bold transition cursor-pointer">
                Cancelar
              </button>
              <button onClick={() => answerConfirm(true)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-sm font-bold transition cursor-pointer">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3">
        <div className="shrink-0">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight whitespace-nowrap">Gestión de Productos y Stock</h1>
          <p className="text-sm text-slate-500 font-medium">Alta, modificación, precios mayoristas/minoristas y stock</p>
          <div className="flex flex-wrap gap-2 mt-1.5 text-xs font-bold">
            <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 tnum">Valorizado costo: ${valuation.cost.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 tnum">Potencial venta: ${valuation.sale.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            {expiringSoon > 0 && (
              <button onClick={() => setExpiryFilter(true)} className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200 transition cursor-pointer">
                ⏳ {expiringSoon} por vencer (30 días)
              </button>
            )}
            {criticalProducts.length > 0 && (
              <button
                onClick={() => sendWhatsAppAlert(criticalProducts)}
                className="px-3 py-1 rounded-full bg-green-100 text-green-800 hover:bg-green-200 transition cursor-pointer flex items-center gap-1"
              >
                <MessageCircle size={12} /> WhatsApp ({criticalProducts.length})
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:ml-auto">
          <button
            onClick={() => { setCountLines([]); setCountSearch(''); setCountOpen(true); }}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 text-slate-600 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
          >
            <ClipboardCheck size={15} />
            <span>Conteo</span>
          </button>
          <button
            onClick={handlePrintPriceList}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 text-slate-600 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
          >
            <ListOrdered size={15} />
            <span>Lista precios</span>
          </button>
          <button
              onClick={() => setSuppliersOpen(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 text-slate-600 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
            >
              <Truck size={15} />
              <span>Proveedores</span>
            </button>
          <button
            onClick={() => { setLabelQty({}); setLabelsOpen(true); }}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 text-slate-600 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
          >
            <Tag size={15} />
            <span>Etiquetas</span>
          </button>
          <button
              onClick={() => { setImportRows([]); setImportOpen(true); }}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 text-slate-600 rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
            >
              <Upload size={15} />
              <span>Importar</span>
            </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center space-x-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md text-sm font-bold transition shrink-0"
          >
            <Plus size={18} />
            <span>Nuevo Producto</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1F1F1F] p-4 rounded-2xl shadow-sm border border-slate-200/80 dark:border-[#333333] flex items-center space-x-3">
        <Search className="text-slate-400 shrink-0" size={20} />
        <input
          type="text"
          placeholder="Buscar por nombre, código de barras o categoría..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full focus:outline-none text-slate-900 dark:text-white text-sm font-medium bg-transparent"
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm('')} className="text-xs font-bold text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer">✕</button>
        )}
      </div>

      {/* Barra única: filtros + herramientas */}
      <div className="bg-white dark:bg-[#1F1F1F] rounded-2xl border border-slate-200/80 dark:border-[#333333] shadow-sm p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[170px] flex-1 sm:flex-none sm:w-52">
            <RoundedSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[{ value: 'all', label: '📦 Todas las categorías' }, ...CATEGORIES_LIST.map((cat) => ({ value: cat, label: cat }))]}
            />
          </div>
          <button
            onClick={() => setStockFilter((f) => (f === 'critical' ? 'all' : 'critical'))}
            className={`px-3.5 py-2 rounded-2xl text-[13px] font-bold border-2 transition active:scale-95 cursor-pointer ${stockFilter === 'critical' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-[#e2e8f0] text-slate-600 hover:border-red-300'}`}
          >
            {stockFilter === 'critical' ? '🔴 Solo críticos ✓' : '⚪ Solo críticos'}
          </button>
          <button
            onClick={() => setExpiryFilter((f) => !f)}
            className={`px-3.5 py-2 rounded-2xl text-[13px] font-bold border-2 transition active:scale-95 cursor-pointer ${expiryFilter ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-[#e2e8f0] text-slate-600 hover:border-amber-300'}`}
          >
            {expiryFilter ? '⏳ Por vencer ✓' : '⏳ Por vencer'}
          </button>
          <div className="min-w-[170px] flex-1 sm:flex-none sm:w-52">
            <RoundedSelect
              value={sortBy}
              onChange={(v) => setSortBy(v as any)}
              options={[
                { value: 'name', label: 'Orden: Nombre A-Z' },
                { value: 'stock', label: 'Orden: Menor stock' },
                { value: 'wholesale', label: 'Orden: Mayorista ↓' },
                { value: 'retail', label: 'Orden: Minorista ↓' },
                { value: 'expiry', label: 'Orden: Vence primero' },
                { value: 'rotation', label: 'Orden: Menor rotación' },
              ]}
            />
          </div>
          {/* contador filtros activos */}
          {(() => {
            const activeCount = (categoryFilter !== 'all' ? 1 : 0) + (stockFilter === 'critical' ? 1 : 0) + (expiryFilter ? 1 : 0) + (sortBy !== 'name' ? 1 : 0) + (searchTerm ? 1 : 0);
            return activeCount > 0 ? (
              <span className="ml-2 px-2 py-0.5 rounded-full bg-[#0ea5e9] text-white text-[11px] font-black tnum">•{activeCount}</span>
            ) : null;
          })()}
          {(() => {
            const hasActive = categoryFilter !== 'all' || stockFilter === 'critical' || expiryFilter || sortBy !== 'name' || !!searchTerm;
            return hasActive ? (
              <button onClick={() => { setCategoryFilter('all'); setStockFilter('all'); setExpiryFilter(false); setSortBy('name'); setSearchTerm(''); }} className="ml-1 text-[11px] font-bold text-slate-400 hover:text-red-600 underline cursor-pointer">Limpiar</button>
            ) : null;
          })()}
          <span className="text-xs font-bold text-slate-400 tnum ml-auto">{filteredProducts.length} productos</span>
          <button onClick={() => { const v = density === 'comfortable' ? 'compact' : 'comfortable'; setDensity(v); try { localStorage.setItem('dv-density', v); } catch {} }} className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-[#333333] text-[11px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-[#232323] cursor-pointer">{density === 'comfortable' ? 'Cómoda' : 'Compacta'}</button>
        </div>

        {savedFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Bookmark size={12} className="text-slate-400" />
            {savedFilters.map((f) => (
              <button
                key={f.name}
                onClick={() => applySavedFilter(f)}
                className="group flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-[#eef6ff] text-slate-600 hover:text-[#0284c7] rounded-full text-[11px] font-bold transition cursor-pointer"
              >
                {f.name}
                <span onClick={(e) => { e.stopPropagation(); deleteSavedFilter(f.name); }} className="text-slate-400 hover:text-red-500 hidden group-hover:inline">✕</span>
              </button>
            ))}
          </div>
        )}

        <div className="border-t border-slate-100" />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Precios</span>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-2xl">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Meta %</span>
            <input
              type="number"
              value={targetMargin}
              onChange={(e) => {
                setTargetMargin(e.target.value);
                try {
                  localStorage.setItem('dv-target-margin', e.target.value);
                } catch { /* noop */ }
              }}
              className="w-12 text-[13px] font-extrabold tnum focus:outline-none text-slate-900 bg-transparent"
            />
            <span className="w-px h-5 bg-slate-200" />
            <button
              onClick={handleApplyTarget}
              disabled={savingTarget}
              title={`Llevar al ${targetMargin}% los ${belowTarget.length} por debajo`}
              className="text-[12px] font-extrabold text-emerald-700 hover:text-emerald-900 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              {savingTarget ? '...' : `Al objetivo (${belowTarget.length})`}
            </button>
          </div>
          <button
            onClick={() => setBulkOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-[13px] font-bold transition active:scale-95 cursor-pointer"
          >
            <Percent size={15} /> Aumento %
          </button>
          <span className="w-px h-6 bg-slate-200 hidden sm:block" />
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest hidden sm:block">Datos</span>
          <button
            onClick={() => setDupesOpen(true)}
            className="relative px-3.5 py-2 bg-white border border-slate-200 hover:border-purple-400 text-slate-600 rounded-2xl text-[13px] font-bold transition active:scale-95 cursor-pointer"
          >
            🔍 Duplicados
            {dupeGroups.length > 0 && (
              <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-purple-600 text-white text-[10px] font-black flex items-center justify-center">
                {dupeGroups.length}
              </span>
            )}
          </button>
          <button
            onClick={handleExportProducts}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-emerald-500 text-slate-700 rounded-2xl text-[13px] font-bold transition active:scale-95 cursor-pointer"
          >
            <Download size={15} /> Excel
          </button>
          <button
            onClick={() => setRotationDashOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:border-blue-400 text-slate-600 rounded-2xl text-[13px] font-bold transition active:scale-95 cursor-pointer"
          >
            <BarChart3 size={15} /> Rotación
          </button>
          {showSaveFilter ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={filterNameInput}
                onChange={(e) => setFilterNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveCurrentFilter()}
                placeholder="Nombre filtro"
                autoFocus
                className="w-28 px-2.5 py-1.5 border-2 border-[#0ea5e9] rounded-xl text-xs font-bold focus:outline-none"
              />
              <button onClick={saveCurrentFilter} className="px-2.5 py-1.5 bg-[#0ea5e9] text-white rounded-xl text-xs font-bold cursor-pointer">OK</button>
              <button onClick={() => setShowSaveFilter(false)} className="px-2 py-1.5 text-slate-400 hover:text-red-500 text-xs font-bold cursor-pointer">✕</button>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveFilter(true)}
              className="flex items-center gap-1 px-3 py-2 bg-white border border-slate-200 hover:border-[#0ea5e9] text-slate-500 hover:text-[#0ea5e9] rounded-2xl text-[13px] font-bold transition active:scale-95 cursor-pointer"
            >
              <Bookmark size={14} /> Guardar filtro
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="bg-white dark:bg-[#1F1F1F] rounded-xl border-2 border-[#e2e8f0] dark:border-[#333333] p-1 flex text-[13px] font-bold">
          <button
            onClick={() => setShowInactive(false)}
            className={`px-4 py-1.5 rounded-lg transition active:scale-95 cursor-pointer ${!showInactive ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            Activos ({activeProducts.length})
          </button>
          <button
            onClick={() => setShowInactive(true)}
            className={`px-4 py-1.5 rounded-lg transition active:scale-95 cursor-pointer ${showInactive ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
          >
            Dados de baja ({inactiveProducts.length})
          </button>
        </div>
        {!showInactive && filteredProducts.length > 0 && (
          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333] rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={selectedIds.size === filteredProducts.length && filteredProducts.length > 0} onChange={(e) => setSelectedIds(e.target.checked ? new Set(filteredProducts.map(p=>p.id)) : new Set())} className="accent-emerald-600" />
            Seleccionar todo
          </label>
        )}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-1.5 ml-1">
            <span className="text-xs font-bold text-slate-500">{selectedIds.size} sel.</span>
            <button onClick={async () => { if(!(await askConfirm(`¿Dar de baja ${selectedIds.size} productos?`))) return; const ids = Array.from(selectedIds); if (!navigator.onLine) { const { enqueueProductUpdate } = await import('../lib/offlineDB'); for (const id of ids) await enqueueProductUpdate({ id, is_active: false }); setProducts((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, is_active: false } : p))); notify('Sin conexión: bajas encoladas.'); } else { ids.forEach(id=> supabase.from('products').update({is_active:false}).eq('id',id).then(()=> fetchProducts())); } setSelectedIds(new Set()); }} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer">Dar de baja</button>
            <button onClick={() => { const list = filteredProducts.filter(p=> selectedIds.has(p.id)); const csvRows = list.map(p=> [p.name, p.barcode||'', p.category||'', p.stock_quantity, p.wholesale_price, p.retail_price]); downloadCsv(stampName('seleccion'), ['Nombre','Código','Categoría','Stock','Mayorista','Minorista'], csvRows); }} className="px-3 py-1.5 bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333] text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer">Exportar</button>
            <button onClick={()=> setSelectedIds(new Set())} className="px-2 py-1 text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer">✕</button>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-[#1F1F1F] rounded-2xl shadow-sm border border-slate-200/80 dark:border-[#333333] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Cargando productos...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-8 text-center text-slate-500">No se encontraron productos.</div>
        ) : (
          <>
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              {(() => {
                const cellPad = density === 'compact' ? 'p-2' : 'p-4';
                 const SortTh = ({ id, label, align='left' }: { id: string; label: string; align?: string }) => {
                   const active = sortBy === id;
                   return (
                     <th onClick={()=> setSortBy(id as any)} className={`${cellPad} ${align==='center'?'text-center':align==='right'?'text-right':''} cursor-pointer select-none hover:text-sky-600 dark:hover:text-sky-400 transition font-semibold ${active ? 'text-sky-600 dark:text-sky-400' : 'text-slate-600 dark:text-slate-400'}`}>{label} {active ? '▼' : '▾'}</th>
                   );
                 };
                return (
               <thead>
                     <tr className="bg-white dark:bg-[#232323] text-slate-700 dark:text-slate-300 text-xs uppercase tracking-wider border-b-2 border-slate-200 dark:border-[#333333]">
                       <th className={`${cellPad} w-8`}><input type="checkbox" checked={selectedIds.size===filteredProducts.length && filteredProducts.length>0} onChange={(e)=> setSelectedIds(e.target.checked? new Set(filteredProducts.map(p=>p.id)): new Set())} className="accent-sky-500" /></th>
                       <th className={`${cellPad}`}>Código / Barras</th>
                       <SortTh id="name" label="Producto" />
                       <th className={`${cellPad}`}>Categoría</th>
                       <th className={`${cellPad}`}>Costo</th>
                        <SortTh id="wholesale" label="Mayorista" align="right" />
                        <SortTh id="retail" label="Minorista" align="right" />
                        <SortTh id="stock" label="Stock" align="center" />
                        <SortTh id="expiry" label="Vence" align="center" />
                        <SortTh id="rotation" label="Rotación" align="center" />
                        <th className={`${cellPad} text-center`}>Acciones</th>
                      </tr>
                   </thead>
                );
              })()}
               <tbody className="divide-y divide-slate-200 dark:divide-[#333333] text-sm text-slate-700 dark:text-slate-300">
                 {filteredProducts.map((p) => {
                   const pad = density === 'compact' ? 'p-2' : 'p-3';
                   const isExpanded = expandedId === p.id;
                   return (
                     <React.Fragment key={p.id}>
                      <tr key={p.id} onClick={()=> setExpandedId(isExpanded? null: p.id)} className={`hover:bg-slate-50 dark:hover:bg-[#2a2a2a] transition cursor-pointer border-b border-slate-100 dark:border-[#2a2a2a] ${selectedIds.has(p.id)? 'bg-sky-100 dark:bg-sky-900/30':''} ${isExpanded? 'bg-slate-100 dark:bg-[#252525]':''}`}>
                       <td className={`${pad} w-8 border-r border-slate-100 dark:border-[#333333]`} onClick={(e)=> e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(p.id)} onChange={(e)=> { const ns=new Set(selectedIds); if(e.target.checked) ns.add(p.id); else ns.delete(p.id); setSelectedIds(ns); }} className="accent-sky-500" /></td>
                       <td className={`${pad} font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap border-r border-slate-100 dark:border-[#333333]`}>
                         <span className="flex items-center gap-1.5">
                           <Barcode size={16} className="text-slate-400 shrink-0" />
                           {p.barcode ? highlightMatch(p.barcode, searchTerm) : 'Sin código'}
                         </span>
                       </td>
                       <td className={`${pad} font-semibold text-slate-900 dark:text-white border-r border-slate-100 dark:border-[#333333]`}>
                         <div className="flex items-center gap-2.5 min-w-0">
                           {p.image_url ? (
                             <img src={p.image_url} alt={p.name} className={`${density==='compact'?'w-8 h-8':'w-10 h-10'} rounded-xl object-cover border border-slate-200 shrink-0`} />
                           ) : (
                             <span className={`${density==='compact'?'w-8 h-8':'w-10 h-10'} rounded-xl bg-slate-100 dark:bg-[#232323] text-slate-400 flex items-center justify-center shrink-0`}>
                               <ImagePlus size={18} />
                             </span>
                           )}
                           <span className="min-w-0">
                             {highlightMatch(p.name, searchTerm)}
                             <span className="block text-xs font-semibold text-slate-500 uppercase">Unidad: {p.unit_type}</span>
                           </span>
                         </div>
                       </td>
                       <td className={`${pad} font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap border-r border-slate-100 dark:border-[#333333]`}>{highlightMatch(p.category || 'General', searchTerm)}</td>
                       <td className={`${pad} font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap border-r border-slate-100 dark:border-[#333333]`}>${Number(p.cost_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                       <td className={`${pad} font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap text-right border-r border-slate-100 dark:border-[#333333]`}>
                         ${Number(p.wholesale_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                         {(() => {
                           const m = marginOf(p);
                           if (m === null) return null;
                           const low = m < parseFloat(targetMargin || '40');
                           return (
                             <span className={`block text-[11px] font-extrabold tnum ${low ? 'text-red-600' : 'text-slate-500'}`}>
                               {m.toFixed(1)}%{low ? ' ⚠' : ''}
                             </span>
                           );
                         })()}
                       </td>
                       <td className={`${pad} font-bold text-blue-700 dark:text-blue-400 whitespace-nowrap text-right border-r border-slate-100 dark:border-[#333333]`}>${Number(p.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                       <td className={`${pad} text-center whitespace-nowrap border-r border-slate-100 dark:border-[#333333]`}>
                         <span className={`px-2.5 py-1 rounded-full text-xs font-extrabold tnum ${
                           p.stock_quantity <= (p.min_stock || 5)
                             ? 'bg-red-100 text-red-700'
                             : 'bg-emerald-100 text-emerald-700'
                         }`}>
                           {Number(p.stock_quantity)} {p.unit_type === 'kg' ? 'kg' : 'un'}
                         </span>
                       </td>
                       <td className={`${pad} text-center whitespace-nowrap border-r border-slate-100 dark:border-[#333333]`}>
                         {(() => {
                           const d = daysToExpiry(p);
                           if (d === null) return <span className="text-xs text-slate-400 font-semibold">—</span>;
                           if (d < 0) return <span className="px-2 py-1 rounded-full text-xs font-extrabold bg-red-600 text-white">Vencido</span>;
                           if (d <= 30) return <span className="px-2 py-1 rounded-full text-xs font-extrabold bg-amber-100 text-amber-800 tnum">{d}d</span>;
                           return <span className="text-xs font-bold text-slate-500 tnum">{new Date(p.expiry_date + 'T00:00:00').toLocaleDateString('es-AR')}</span>;
                         })()}
                       </td>
                       <td className={`${pad} text-center whitespace-nowrap border-r border-slate-100 dark:border-[#333333]`}>
                         {(() => {
                           const r = rotation[p.id];
                           if (!r) return <span className="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">Sin ventas</span>;
                           const d = daysSince(r.last);
                           return (
                             <span title={`Vendidos: ${r.qty}`}>
                               {d > 60 ? (
                                 <span className="px-2 py-1 rounded-full text-xs font-extrabold bg-red-100 text-red-700 tnum">{d}d sin mov.</span>
                               ) : (
                                 <span className="text-xs font-bold text-slate-500 tnum">{d}d • {r.qty} vend.</span>
                               )}
                             </span>
                           );
                         })()}
                       </td>
                       <td className={`${pad} text-center whitespace-nowrap`} onClick={(e)=> e.stopPropagation()}>
{showInactive ? (
                            canManage ? (
                              <button
                                onClick={() => handleReactivate(p)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer"
                                title="Reactivar producto"
                              >
                                <RotateCcw size={15} /> Reactivar
                              </button>
                            ) : null
                          ) : (
<ActionDropdown
                              items={[
                                { key: 'entry', label: 'Entrada de stock', icon: <PackagePlus size={15} /> },
                                { key: 'exit', label: 'Salida / ajuste de stock', icon: <PackageMinus size={15} /> },
                                { key: 'moves', label: 'Historial de movimientos', icon: <History size={15} /> },
                                { key: 'prices', label: 'Historial de precios', icon: <Clock size={15} /> },
                                { key: 'dup', label: 'Duplicar producto', icon: <Copy size={15} /> },
                                { key: 'edit', label: 'Editar', icon: <Edit2 size={15} /> },
                                ...(canManage ? [
                                  { key: 'delete', label: 'Dar de baja', icon: <Trash2 size={15} />, danger: true },
                                ] : []),
                              ]}
                             onSelect={(key) => {
                               if (key === 'entry') { setAdjustProduct(p); setAdjustMode('in'); setAdjustReason('compra'); setAdjustQty(''); }
                               else if (key === 'exit') { setAdjustProduct(p); setAdjustMode('out'); setAdjustReason('ajuste'); setAdjustQty(''); }
                               else if (key === 'moves') openMoves(p);
                               else if (key === 'prices') openPriceHist(p);
                               else if (key === 'dup') handleDuplicate(p);
                               else if (key === 'edit') handleOpenModal(p);
                               else if (key === 'delete') handleSoftDelete(p);
                             }}
                           />
                         )}
                       </td>
                     </tr>
                   {isExpanded && (
                     <tr key={`${p.id}-detail`} className="bg-slate-100 dark:bg-[#1a1a1a] border-t-2 border-slate-300 dark:border-[#333333]">
                       <td colSpan={11} className="p-4">
                         <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                           <div className="p-3 bg-white dark:bg-[#232323] rounded-xl border border-slate-200 dark:border-[#333333] shadow-sm">
                             <p className="font-black text-slate-500 uppercase text-[10px] tracking-wider">Proveedor</p>
                             <p className="font-bold text-slate-900 dark:text-white mt-0.5">{suppliers.find(s=>s.id===p.supplier_id)?.name || 'Sin proveedor'}</p>
                           </div>
                           <div className="p-3 bg-white dark:bg-[#232323] rounded-xl border border-slate-200 dark:border-[#333333] shadow-sm">
                             <p className="font-black text-slate-500 uppercase text-[10px] tracking-wider">Margen</p>
                             <p className="font-bold tnum text-emerald-600 dark:text-emerald-400 mt-0.5">{marginOf(p) !== null ? `${marginOf(p)!.toFixed(1)}%` : '—'}</p>
                           </div>
                           <div className="p-3 bg-white dark:bg-[#232323] rounded-xl border border-slate-200 dark:border-[#333333] shadow-sm">
                             <p className="font-black text-slate-500 uppercase text-[10px] tracking-wider">Valorizado</p>
                             <p className="font-bold tnum text-slate-900 dark:text-white mt-0.5">${(Number(p.stock_quantity)*Number(p.wholesale_price)).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                           </div>
                           <div className="p-3 bg-white dark:bg-[#232323] rounded-xl border border-slate-200 dark:border-[#333333] shadow-sm">
                             <p className="font-black text-slate-500 uppercase text-[10px] tracking-wider">Código</p>
                             <p className="font-mono font-bold text-slate-900 dark:text-white mt-0.5">{p.barcode || '—'}</p>
                           </div>
                         </div>
<div className="flex gap-2 mt-3">
                            <button onClick={()=> openMoves(p)} className="px-4 py-2 bg-white dark:bg-[#232323] border border-slate-200 dark:border-[#333333] rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-sm">Ver movimientos</button>
                            <button onClick={()=> openPriceHist(p)} className="px-4 py-2 bg-white dark:bg-[#232323] border border-slate-200 dark:border-[#333333] rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition cursor-pointer shadow-sm">Ver precios</button>
                            <button onClick={()=> handleOpenModal(p)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition cursor-pointer shadow-sm">Editar</button>
                          </div>
                       </td>
                     </tr>
                   )}
                 </React.Fragment>
                 );
                 })}
              </tbody>
            </table>
          </div>
          {/* Cards mobile */}
          <div className="lg:hidden p-3 space-y-3">
            {filteredProducts.map((p)=> (
               <div key={`card-${p.id}`} className={`p-4 bg-white dark:bg-[#1F1F1F] rounded-2xl border ${selectedIds.has(p.id)? 'border-sky-400 shadow-md':'border-slate-200 dark:border-[#333333]'} shadow-sm`}>
                 <div className="flex gap-3">
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={(e)=>{const ns=new Set(selectedIds); if(e.target.checked) ns.add(p.id); else ns.delete(p.id); setSelectedIds(ns);}} className="accent-sky-500 mt-1" />
                   {p.image_url ? <img src={p.image_url} alt={p.name} className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0" /> : <span className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-[#232323] flex items-center justify-center shrink-0"><ImagePlus size={20} className="text-slate-400" /></span>}
                   <div className="flex-1 min-w-0">
                     <p className="font-bold text-slate-900 dark:text-white text-base leading-tight">{highlightMatch(p.name, searchTerm)}</p>
                     <p className="text-sm font-semibold text-slate-500 mt-0.5">{p.category||'General'} • {p.barcode||'Sin código'}</p>
                     <div className="flex gap-2 mt-2 flex-wrap items-center">
                       <span className={`px-2.5 py-1 rounded-full text-xs font-extrabold tnum ${Number(p.stock_quantity)<=Number(p.min_stock||5)? 'bg-red-100 text-red-700':'bg-emerald-100 text-emerald-700'}`}>{Number(p.stock_quantity)} {p.unit_type==='kg'?'kg':'un'}</span>
                       <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">${Number(p.wholesale_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                       <span className="text-sm font-bold text-blue-700 dark:text-blue-400">${Number(p.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                     </div>
                   </div>
                  <div onClick={(e)=> e.stopPropagation()}>
                    {showInactive ? (
                      <button onClick={()=> handleReactivate(p)} className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold">Reactivar</button>
                    ) : (
                      <ActionDropdown items={[{key:'entry',label:'Entrada',icon:<PackagePlus size={14}/>},{key:'exit',label:'Salida',icon:<PackageMinus size={14}/>},{key:'moves',label:'Movimientos',icon:<History size={14}/>},{key:'prices',label:'Precios',icon:<Clock size={14}/>},{key:'dup',label:'Duplicar',icon:<Copy size={14}/>},{key:'edit',label:'Editar',icon:<Edit2 size={14}/>},...(canManage ? [{key:'delete',label:'Baja',icon:<Trash2 size={14}/>,danger:true} as const] : [])]} onSelect={(k)=>{ if(k==='entry'){setAdjustProduct(p);setAdjustMode('in');setAdjustReason('compra');setAdjustQty('');} else if(k==='exit'){setAdjustProduct(p);setAdjustMode('out');setAdjustReason('ajuste');setAdjustQty('');} else if(k==='moves') openMoves(p); else if(k==='prices') openPriceHist(p); else if(k==='dup') handleDuplicate(p); else if(k==='edit') handleOpenModal(p); else if(k==='delete') handleSoftDelete(p); }} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-lg w-full shadow-2xl max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-[#1F1F1F] px-6 pt-6 pb-4 border-b dark:border-[#333333]">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                </h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-[#232323] text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#333333] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              {/* Tabs */}
              <div className="flex gap-1 p-1 mt-4 bg-slate-100 dark:bg-[#232323] rounded-2xl">
                {(() => {
                  const tabHasErrors = (tab: string) => {
                    if (tab === 'datos') return !name.trim();
                    if (tab === 'precios') return !(parseFloat(costPrice) > 0 && parseFloat(wholesalePrice) > 0 && parseFloat(retailPrice) > 0);
                    if (tab === 'stock') return !(parseFloat(stockQuantity) >= 0);
                    return false;
                  };
                  const tabs = [['datos', 'Datos', Barcode], ['precios', 'Precios', Percent], ['stock', 'Stock', PackagePlus]] as const;
                  return tabs.map(([key, label, Icon]) => {
                    const hasError = modalTab !== key && tabHasErrors(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setModalTab(key)}
                        className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                          modalTab === key
                            ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                      >
                        <Icon size={14} />
                        {label}
                        {hasError && <span className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-red-500" />}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Body */}
            <form onSubmit={handleSaveProduct} className="p-6 space-y-4">

              {/* TAB: Datos */}
              {modalTab === 'datos' && (
                <div className="space-y-4 animate-row">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Código de Barras</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={barcode}
                        onChange={(e) => { setBarcode(e.target.value); setScannedOk(false); }}
                        className={`flex-1 min-w-0 px-3.5 py-2.5 border-2 rounded-2xl focus:outline-none text-slate-900 dark:text-white text-sm font-semibold shadow-xs tnum transition ${scannedOk ? 'border-emerald-600 bg-emerald-50/50' : 'border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 focus:border-emerald-600'}`}
                        placeholder="Ej. 779123456789"
                      />
                      <button
                        type="button"
                        onClick={() => setScannerOpen(true)}
                        title="Escanear con cámara"
                        className="shrink-0 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl shadow-md transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-sm font-bold"
                      >
                        <Camera size={18} />
                        <span className="hidden sm:inline">Escanear</span>
                      </button>
                      <button
                        type="button"
                        onClick={generateBarcode}
                        title="Generar código aleatorio"
                        className="shrink-0 px-3 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl shadow-md transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-sm font-bold"
                      >
                        <QrCode size={16} />
                        <span className="hidden sm:inline">Generar</span>
                      </button>
                    </div>
                    {/* Barcode preview */}
                    {barcode && barcode.length >= 4 && (
                      <div className="mt-2 flex justify-center">
                        <canvas ref={barcodeCanvasRef} className="max-w-[200px] h-auto" />
                      </div>
                    )}
                    <p className={`text-[11px] font-medium mt-1 transition-colors ${scannedOk ? 'text-emerald-700 font-bold' : 'text-slate-400'}`}>
                      {scannedOk ? '✓ Código cargado desde la cámara' : 'Escribilo a mano o escanéalo con la cámara'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Nombre del Producto *</label>
                    <input
                      ref={nameInputRef}
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setModalTab('precios'); } }}
                      className="w-full px-3.5 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-900 dark:text-white text-sm font-semibold shadow-xs"
                      placeholder="Ej. Almendras Nonpareil x 1kg"
                    />
                    {/* Duplicados detectados */}
                    {nameDuplicates.length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {nameDuplicates.map((d) => (
                          <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-[11px] font-bold text-amber-700 dark:text-amber-400">
                            <AlertTriangle size={12} className="shrink-0" />
                            Ya existe: {d.name}
                            <span className="text-amber-500 tnum">({d.stock_quantity} un.)</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Categoría</label>
                      <RoundedSelect
                        value={category}
                        onChange={setCategory}
                        options={CATEGORIES_LIST.map((cat) => ({ value: cat, label: cat }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Tipo de Venta</label>
                      <RoundedSelect
                        value={unitType}
                        onChange={(v) => setUnitType(v as 'unit' | 'kg')}
                        options={[
                          { value: 'unit', label: 'Por Unidad' },
                          { value: 'kg', label: 'Por Kilo (Granel)' },
                        ]}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Foto (opcional)</label>
                    <div className="flex gap-2 items-center">
                      <div className="relative group shrink-0">
                        {imageUrl ? (
                          <img src={imageUrl} alt="Foto" className="w-12 h-12 rounded-2xl object-cover border-2 border-emerald-200" />
                        ) : (
                          <span className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-[#232323] text-slate-300 flex items-center justify-center">
                            <ImagePlus size={20} />
                          </span>
                        )}
                        {imageUrl && (
                          <div className="absolute left-16 top-1/2 -translate-y-1/2 z-10 hidden group-hover:block pointer-events-none">
                            <img src={imageUrl} alt="Preview" className="w-48 h-48 rounded-2xl object-cover border-2 border-emerald-400 shadow-2xl" />
                          </div>
                        )}
                      </div>
                      <input
                        type="text"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        className="flex-1 min-w-0 px-3.5 py-2.5 border-2 border-emerald-500 rounded-2xl focus:outline-none text-slate-900 dark:text-white text-xs font-semibold shadow-xs"
                        placeholder="Pegar URL de imagen..."
                      />
                      <label className="shrink-0 px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-bold cursor-pointer transition active:scale-95">
                        {uploadingPhoto ? 'Subiendo...' : 'Subir'}
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoUpload(e.target.files?.[0])} />
                      </label>
                      {imageUrl && (
                        <button type="button" onClick={() => setImageUrl('')} className="shrink-0 px-2.5 py-2.5 text-slate-400 hover:text-red-600 text-sm font-black cursor-pointer" title="Quitar foto">
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Precios */}
              {modalTab === 'precios' && (
                <div className="space-y-4 animate-row">
                  {/* Auto-calcular precio */}
                  <div className="p-3 bg-slate-50 dark:bg-[#232323] border border-slate-200 dark:border-[#333333] rounded-2xl space-y-2">
                    <div className="flex items-center gap-2">
                      <Percent size={14} className="text-slate-500" />
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Auto-calculador de precio</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <span className="text-[11px] font-bold text-slate-500">Margen</span>
                      <input
                        type="number"
                        step="any"
                        min="1"
                        max="99"
                        value={autoMargin}
                        onChange={(e) => setAutoMargin(e.target.value)}
                        placeholder="40"
                        className="w-16 px-2 py-1.5 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-xs font-bold tnum focus:outline-none focus:border-emerald-500 bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-white"
                      />
                      <span className="text-[11px] font-bold text-slate-500">%</span>
                      <span className="w-px h-5 bg-slate-200 dark:bg-[#333333]" />
                      <span className="text-[11px] font-bold text-slate-500">Aplicar a</span>
                      <RoundedSelect
                        size="sm"
                        value={autoCalcField}
                        onChange={(v) => setAutoCalcField(v as any)}
                        options={[
                          { value: 'wholesale', label: 'Mayorista' },
                          { value: 'retail', label: 'Minorista' },
                        ]}
                      />
                      <button
                        type="button"
                        onClick={handleAutoCalc}
                        disabled={!autoMargin || !costPrice || parseFloat(autoMargin) <= 0}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Calcular
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[30, 35, 40, 45, 50].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => { setAutoMargin(String(m)); }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${autoMargin === String(m) ? 'bg-emerald-600 text-white' : 'bg-white dark:bg-[#1F1F1F] border border-slate-200 dark:border-[#333333] text-slate-600 dark:text-slate-400 hover:border-emerald-400'}`}
                        >
                          {m}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Costo *</label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value)}
                        className="w-full px-3 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-900 dark:text-white text-sm font-semibold shadow-xs"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-emerald-700 uppercase tracking-wide mb-1">Mayorista *</label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={wholesalePrice}
                        onChange={(e) => setWholesalePrice(e.target.value)}
                        className="w-full px-3 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-900 dark:text-white text-sm font-semibold shadow-xs"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-blue-700 uppercase tracking-wide mb-1">Minorista *</label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={retailPrice}
                        onChange={(e) => setRetailPrice(e.target.value)}
                        className="w-full px-3 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-900 dark:text-white text-sm font-semibold shadow-xs"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {/* Margen en vivo */}
                  {(liveMargin(wholesalePrice) !== null || liveMargin(retailPrice) !== null) && (
                    <div className="grid grid-cols-2 gap-3">
                      {liveMargin(wholesalePrice) !== null && (
                        <div className={`px-3.5 py-2.5 rounded-2xl border-2 text-sm font-bold flex justify-between items-center ${Number(liveMargin(wholesalePrice)) < 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800 text-red-700 dark:text-red-400' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400'}`}>
                          <span>Margen mayorista</span>
                          <span className="tnum">{liveMargin(wholesalePrice)}%</span>
                        </div>
                      )}
                      {liveMargin(retailPrice) !== null && (
                        <div className={`px-3.5 py-2.5 rounded-2xl border-2 text-sm font-bold flex justify-between items-center ${Number(liveMargin(retailPrice)) < 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800 text-red-700 dark:text-red-400' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-400'}`}>
                          <span>Margen minorista</span>
                          <span className="tnum">{liveMargin(retailPrice)}%</span>
                        </div>
                      )}
                    </div>
                  )}
                  {((parseFloat(wholesalePrice) || 0) > 0 && (parseFloat(wholesalePrice) || 0) < (parseFloat(costPrice) || 0)) ||
                  ((parseFloat(retailPrice) || 0) > 0 && (parseFloat(retailPrice) || 0) < (parseFloat(costPrice) || 0)) ? (
                    <p className="text-xs font-bold text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3.5 py-2.5">
                      ⚠ Un precio está por debajo del costo (venta a pérdida). Te lo voy a confirmar al guardar.
                    </p>
                  ) : null}
                </div>
              )}

              {/* TAB: Stock */}
              {modalTab === 'stock' && (
                <div className="space-y-4 animate-row">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Stock Inicial *</label>
                      <input
                        type="number"
                        step="any"
                        required
                        value={stockQuantity}
                        onChange={(e) => setStockQuantity(e.target.value)}
                        className="w-full px-3.5 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-900 dark:text-white text-sm font-semibold shadow-xs"
                        placeholder="100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Stock Mínimo Alerta</label>
                      <input
                        type="number"
                        step="any"
                        value={minStock}
                        onChange={(e) => setMinStock(e.target.value)}
                        className="w-full px-3 py-2.5 border-2 border-emerald-500 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-900 dark:text-white text-sm font-semibold shadow-xs"
                        placeholder="5"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Vencimiento (opcional)</label>
                    <div className="flex gap-1.5">
                      {(() => {
                        const parts = (expiryDate || '').split('-');
                        const y = parts[0] || '';
                        const m = parts[1] || '';
                        const d = parts[2] || '';
                        const thisYear = new Date().getFullYear();
                        const years = Array.from({ length: 7 }, (_, i) => String(thisYear + i));
                        const months = [
                          { value: '01', label: 'Ene' }, { value: '02', label: 'Feb' }, { value: '03', label: 'Mar' },
                          { value: '04', label: 'Abr' }, { value: '05', label: 'May' }, { value: '06', label: 'Jun' },
                          { value: '07', label: 'Jul' }, { value: '08', label: 'Ago' }, { value: '09', label: 'Sep' },
                          { value: '10', label: 'Oct' }, { value: '11', label: 'Nov' }, { value: '12', label: 'Dic' },
                        ];
                        const maxDay = y && m ? new Date(Number(y), Number(m), 0).getDate() : 31;
                        const days = Array.from({ length: maxDay }, (_, i) => String(i + 1).padStart(2, '0'));
                        const setPart = (kind: 'd' | 'm' | 'y', val: string) => {
                          let nd = kind === 'd' ? val : d;
                          let nm = kind === 'm' ? val : m;
                          let ny = kind === 'y' ? val : y;
                          if (!nd && !nm && !ny) { setExpiryDate(''); return; }
                          if (!nd) nd = '01';
                          if (!nm) nm = '01';
                          if (!ny) ny = String(thisYear);
                          const max = new Date(Number(ny), Number(nm), 0).getDate();
                          if (Number(nd) > max) nd = String(max).padStart(2, '0');
                          setExpiryDate(`${ny}-${nm}-${nd}`);
                        };
                        return (
                          <>
                            <div className="flex-1 min-w-0">
                              <RoundedSelect size="sm" value={d || ''} onChange={(v) => (v ? setPart('d', v) : setExpiryDate(''))} options={[{ value: '', label: 'Día' }, ...days.map((x) => ({ value: x, label: x }))]} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <RoundedSelect size="sm" value={m || ''} onChange={(v) => (v ? setPart('m', v) : setExpiryDate(''))} options={[{ value: '', label: 'Mes' }, ...months]} />
                            </div>
                            <div className="flex-[1.2] min-w-0">
                              <RoundedSelect size="sm" value={y || ''} onChange={(v) => (v ? setPart('y', v) : setExpiryDate(''))} options={[{ value: '', label: 'Año' }, ...years.map((x) => ({ value: x, label: x }))]} />
                            </div>
                            {expiryDate && (
                              <button type="button" onClick={() => setExpiryDate('')} title="Quitar fecha" className="shrink-0 px-2.5 rounded-2xl border-2 border-slate-200 dark:border-[#333333] text-slate-400 hover:text-red-600 hover:border-red-300 text-xs font-black transition cursor-pointer">
                                ✕
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Proveedor (opcional)</label>
                    <RoundedSelect
                      value={supplierId || 'none'}
                      onChange={(v) => setSupplierId(v === 'none' ? '' : v)}
                      options={[{ value: 'none', label: 'Sin proveedor' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
                    />
                  </div>
                </div>
              )}

              {/* Footer sticky */}
              <div className="sticky bottom-0 bg-white dark:bg-[#1F1F1F] pt-4 border-t dark:border-[#333333] flex justify-end space-x-3 -mx-6 px-6 pb-0">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-5 py-2.5 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#232323] transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-600/20 transition cursor-pointer"
                >
                  {editingProduct ? 'Actualizar Producto' : 'Guardar Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scannerOpen && (
        <ScannerModal
          title="Escanear código de barras"
          onClose={() => { setScannerOpen(false); scannerApi.resetStatus(); }}
          onUseProduct={(_product, code) => applyScannedCode(code)}
          onCreateProduct={(code) => {
            handleOpenModal();
            setBarcode(code);
            setScannedOk(true);
            notify('Código precargado: completá los datos del producto.', 'success');
            setScannerOpen(false);
            scannerApi.resetStatus();
          }}
        />
      )}

      {/* Ajuste rápido de stock */}
      {adjustProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900">Ajuste de stock</h2>
              <button onClick={() => setAdjustProduct(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <p className="text-sm font-bold text-slate-900">{adjustProduct.name}</p>
            <p className="text-xs font-semibold text-slate-500 tnum">Stock actual: {adjustProduct.stock_quantity} {adjustProduct.unit_type}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAdjustMode('in')}
                className={`py-2.5 rounded-2xl text-sm font-bold border-2 transition active:scale-95 cursor-pointer ${adjustMode === 'in' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-[#e2e8f0] text-slate-600'}`}
              >
                ➕ Entrada
              </button>
              <button
                onClick={() => setAdjustMode('out')}
                className={`py-2.5 rounded-2xl text-sm font-bold border-2 transition active:scale-95 cursor-pointer ${adjustMode === 'out' ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-[#e2e8f0] text-slate-600'}`}
              >
                ➖ Salida
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Cantidad</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  autoFocus
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  placeholder="Ej. 10"
                  className="w-full px-3 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-bold tnum focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Motivo</label>
                <RoundedSelect
                  size="sm"
                  value={adjustReason}
                  onChange={setAdjustReason}
                  options={ADJUST_REASONS.map((r) => ({ value: r.value, label: r.label }))}
                />
              </div>
            </div>
            {adjustQty && parseFloat(adjustQty) > 0 && (
              <p className="text-xs font-bold text-slate-600 tnum">
                Nuevo stock: {(Math.round((Number(adjustProduct.stock_quantity) + (adjustMode === 'in' ? parseFloat(adjustQty) : -parseFloat(adjustQty))) * 100) / 100)} {adjustProduct.unit_type}
              </p>
            )}
            <button
              onClick={handleSaveAdjust}
              disabled={savingAdjust}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-bold shadow transition disabled:opacity-50 cursor-pointer"
            >
              {savingAdjust ? 'Guardando...' : 'Confirmar ajuste'}
            </button>
          </div>
        </div>
      )}

      {/* Historial de movimientos */}
      {movesProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900">Movimientos: {movesProduct.name}</h2>
              <button onClick={() => setMovesProduct(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            {loadingMoves ? (
              <p className="text-sm text-slate-400 text-center py-6">Cargando movimientos...</p>
            ) : moves.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">Sin movimientos registrados.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-2">
                {moves.map((m) => (
                  <div key={m.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-2xl border border-slate-100 text-sm">
                    <div>
                      <p className="font-bold text-slate-800">{m.notes || m.type}</p>
                      <p className="text-[11px] text-slate-400 font-medium tnum">
                        {new Date(m.created_at).toLocaleString('es-AR')}
                        {m.user_name ? ` · ${m.user_name}` : ''}
                      </p>
                    </div>
                    <span className={`font-extrabold tnum ${Number(m.quantity) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Number(m.quantity) > 0 ? `+${m.quantity}` : m.quantity}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setMovesProduct(null)}
              className="w-full py-2.5 bg-slate-900 text-white rounded-2xl text-sm font-bold cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Aumento masivo */}
      {bulkOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900">Aumento masivo %</h2>
              <button onClick={() => setBulkOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Categoría</label>
              <RoundedSelect
                size="sm"
                value={bulkCategory}
                onChange={setBulkCategory}
                options={[{ value: 'all', label: 'Todas las categorías' }, ...CATEGORIES_LIST.map((cat) => ({ value: cat, label: cat }))]}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Aplica a</label>
                <RoundedSelect
                  size="sm"
                  value={bulkField}
                  onChange={(v) => setBulkField(v as any)}
                  options={[
                    { value: 'both', label: 'Mayorista + Minorista' },
                    { value: 'wholesale', label: 'Solo Mayorista' },
                    { value: 'retail', label: 'Solo Minorista' },
                  ]}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Porcentaje</label>
                <input
                  type="number"
                  step="any"
                  value={bulkPercent}
                  onChange={(e) => setBulkPercent(e.target.value)}
                  placeholder="Ej. 10"
                  className="w-full px-3 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-bold tnum focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <p className="text-xs font-semibold text-slate-500">
              Se aplica a {activeProducts.filter((p) => bulkCategory === 'all' || (p.category || 'General') === bulkCategory).length} productos activos.
            </p>
            <button
              onClick={handleBulkApply}
              disabled={savingBulk}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-sm font-bold shadow transition disabled:opacity-50 cursor-pointer"
            >
              {savingBulk ? 'Aplicando...' : 'Aplicar aumento'}
            </button>
          </div>
        </div>
      )}

      {/* Proveedores */}
      {suppliersOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Truck size={20} className="text-emerald-600" /> Proveedores
              </h2>
              <button onClick={() => setSuppliersOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Nombre del proveedor"
                className="flex-1 min-w-0 px-3 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-semibold focus:outline-none focus:border-emerald-500"
              />
              <input
                type="text"
                value={newSupplierPhone}
                onChange={(e) => setNewSupplierPhone(e.target.value)}
                placeholder="Teléfono"
                className="w-28 px-3 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-semibold focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleAddSupplier}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-bold transition active:scale-95 cursor-pointer shrink-0"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {suppliers.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Sin proveedores cargados. Si no corriste el SQL, acá va a dar error al guardar.</p>
              ) : (
                suppliers.map((s) => {
                  const count = activeProducts.filter((p) => p.supplier_id === s.id).length;
                  return (
                    <div key={s.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-center">
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{s.name}</p>
                        <p className="text-[11px] text-slate-500 font-medium tnum">{s.phone || 'Sin teléfono'} • {count} productos</p>
                      </div>
                      <button
                        onClick={async () => {
                          if (!(await askConfirm(`¿Dar de baja a "${s.name}"?`))) return;
                          const { error } = await supabase.from('suppliers').update({ is_active: false }).eq('id', s.id);
                          if (error) notify('Error: ' + error.message, 'error');
                          else fetchSuppliers();
                        }}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <button
              onClick={() => setSuppliersOpen(false)}
              className="w-full py-2.5 bg-slate-900 text-white rounded-2xl text-sm font-bold cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Etiquetas */}
      {labelsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Tag size={20} className="text-emerald-600" /> Etiquetas de góndola
              </h2>
              <button onClick={() => setLabelsOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <p className="text-xs text-slate-500 font-medium">Elegí cuántas etiquetas imprimir por producto (lista filtrada actual).</p>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {filteredProducts.slice(0, 60).map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-2xl border border-slate-100">
                  <span className="flex-1 min-w-0 font-bold text-slate-800 text-[13px] truncate">{p.name}</span>
                  <span className="text-[11px] font-bold text-slate-400 tnum">${Number(p.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setLabelQty((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] || 0) - 1) }))}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 font-black text-slate-600 hover:bg-slate-100 cursor-pointer"
                    >
                      −
                    </button>
                    <span className="w-7 text-center font-extrabold text-sm tnum">{labelQty[p.id] || 0}</span>
                    <button
                      onClick={() => setLabelQty((q) => ({ ...q, [p.id]: Math.min(50, (q[p.id] || 0) + 1) }))}
                      className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-black hover:bg-emerald-700 cursor-pointer"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handlePrintLabels}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-sm font-bold transition cursor-pointer"
            >
              🖨 Imprimir {Object.values(labelQty).reduce((a, b) => a + b, 0)} etiquetas
            </button>
          </div>
        </div>
      )}

      {/* Importar CSV */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Upload size={20} className="text-emerald-600" /> Importar productos (CSV)
              </h2>
              <button onClick={() => { setImportOpen(false); setImportRows([]); }} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <div className="text-xs text-slate-600 font-medium bg-slate-50 rounded-2xl border p-3.5 space-y-1">
              <p>Columnas separadas por <strong>;</strong> (abre en Excel):</p>
              <p className="font-mono text-[11px]">nombre;codigo;categoria;tipo;costo;mayorista;minorista;stock;minimo</p>
              <p>tipo: <strong>unit</strong> o <strong>kg</strong>. La primera fila es encabezado.</p>
              <button onClick={downloadImportTemplate} className="text-emerald-700 font-bold hover:underline cursor-pointer">
                ⬇ Descargar plantilla
              </button>
            </div>
            <label className="block w-full py-3 border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl text-center text-sm font-bold text-slate-600 cursor-pointer transition">
              📁 Elegir archivo .csv
              <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => handleImportFile(e.target.files?.[0])} />
            </label>
            {importRows.length > 0 && (
              <div className="max-h-56 overflow-y-auto border rounded-2xl divide-y text-[13px]">
                {importRows.map((r, idx) => {
                  const hasDiffs = r.existing && (r.diffCosto !== null || r.diffMayorista !== null || r.diffMinorista !== null);
                  const diffPct = (diff: number, base: number) => base > 0 ? Math.round((diff / base) * 100) : 0;
                  return (
                    <div key={idx} className={`p-2.5 ${r.errors.length > 0 ? 'bg-red-50' : hasDiffs ? 'bg-amber-50' : 'bg-white'}`}>
                      <p className="font-bold text-slate-800">
                        Línea {r.line}: {r.nombre || '(sin nombre)'}
                        {r.existing && <span className="ml-1.5 text-[10px] font-black text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full">EXISTE</span>}
                      </p>
                      {r.errors.length > 0 && <p className="text-red-600 font-bold text-xs">⚠ {r.errors.join(', ')}</p>}
                      {hasDiffs && r.errors.length === 0 && (
                        <div className="flex flex-wrap gap-2 mt-1 text-[11px] font-bold">
                          {r.diffCosto !== null && r.diffCosto !== 0 && (
                            <span className={r.diffCosto > 0 ? 'text-red-600' : 'text-emerald-600'}>
                              Costo: ${Number(r.costo.replace(',','.')).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({r.diffCosto > 0 ? '+' : ''}{diffPct(r.diffCosto, Number(r.existing.cost_price))}%)
                            </span>
                          )}
                          {r.diffMayorista !== null && r.diffMayorista !== 0 && (
                            <span className={r.diffMayorista > 0 ? 'text-red-600' : 'text-emerald-600'}>
                              Mayor: ${Number(r.mayorista.replace(',','.')).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({r.diffMayorista > 0 ? '+' : ''}{diffPct(r.diffMayorista, Number(r.existing.wholesale_price))}%)
                            </span>
                          )}
                          {r.diffMinorista !== null && r.diffMinorista !== 0 && (
                            <span className={r.diffMinorista > 0 ? 'text-red-600' : 'text-emerald-600'}>
                              Min: ${Number(r.minorista.replace(',','.')).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({r.diffMinorista > 0 ? '+' : ''}{diffPct(r.diffMinorista, Number(r.existing.retail_price))}%)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button
              onClick={handleConfirmImport}
              disabled={importing || importRows.filter((r) => r.errors.length === 0).length === 0}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-bold shadow transition disabled:opacity-50 cursor-pointer"
            >
              {importing ? 'Importando...' : `Importar ${importRows.filter((r) => r.errors.length === 0).length} productos válidos`}
            </button>
          </div>
        </div>
      )}

      {/* Conteo físico */}
      {countOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ClipboardCheck size={20} className="text-emerald-600" /> Conteo físico
              </h2>
              <button onClick={() => setCountOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={countSearch}
                onChange={(e) => setCountSearch(e.target.value)}
                placeholder="Buscar producto para contar..."
                className="w-full pl-9 pr-3 py-2.5 border-2 border-slate-200 rounded-2xl text-sm font-semibold focus:outline-none focus:border-emerald-500"
              />
            </div>
            {countSearch.trim() && (
              <div className="max-h-40 overflow-y-auto border rounded-2xl divide-y">
                {activeProducts
                  .filter((p) => p.name.toLowerCase().includes(countSearch.toLowerCase()) || (p.barcode && p.barcode.includes(countSearch)))
                  .slice(0, 8)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { addToCount(p); setCountSearch(''); }}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 text-sm font-bold text-slate-800 transition cursor-pointer flex justify-between"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="text-slate-400 tnum shrink-0 ml-2">sist: {p.stock_quantity}</span>
                    </button>
                  ))}
              </div>
            )}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {countLines.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">Buscá y agregá productos, cargá lo contado y aplicá las diferencias.</p>
              ) : (
                countLines.map((l) => {
                  const counted = parseFloat(l.counted);
                  const diff = !isNaN(counted) ? Math.round((counted - Number(l.product.stock_quantity)) * 100) / 100 : null;
                  return (
                    <div key={l.product.id} className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3">
                      <span className="flex-1 min-w-0 font-bold text-slate-800 text-[13px] truncate">{l.product.name}</span>
                      <span className="text-[11px] font-bold text-slate-400 tnum whitespace-nowrap">sist: {l.product.stock_quantity}</span>
                      <input
                        type="number"
                        step="any"
                        value={l.counted}
                        onChange={(e) => setCountLines((prev) => prev.map((x) => (x.product.id === l.product.id ? { ...x, counted: e.target.value } : x)))}
                        placeholder="Contado"
                        className="w-20 px-2 py-1.5 border-2 border-slate-200 rounded-xl text-sm font-bold tnum text-right focus:outline-none focus:border-emerald-500"
                      />
                      <span className={`text-xs font-extrabold tnum w-14 text-right ${diff === null ? 'text-slate-300' : diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {diff === null ? '—' : diff === 0 ? '= 0' : `${diff > 0 ? '+' : ''}${diff}`}
                      </span>
                      <button
                        onClick={() => setCountLines((prev) => prev.filter((x) => x.product.id !== l.product.id))}
                        className="text-slate-300 hover:text-red-500 text-sm font-black cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <button
              onClick={applyCount}
              disabled={savingCount || countLines.length === 0}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-bold shadow transition disabled:opacity-50 cursor-pointer"
            >
              {savingCount ? 'Aplicando...' : `Aplicar diferencias (${countLines.length})`}
            </button>
          </div>
        </div>
      )}

      {/* Duplicados */}
      {dupesOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900">🔍 Posibles duplicados ({dupeGroups.length})</h2>
              <button onClick={() => setDupesOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            {dupeGroups.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">Sin duplicados por código o nombre. 👌</p>
            ) : (
              <div className="max-h-96 overflow-y-auto space-y-3">
                {dupeGroups.map((group, gi) => (
                  <div key={gi} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                    <p className="text-[11px] font-bold text-slate-400 uppercase">
                      {group[0].barcode ? `Mismo código: ${group[0].barcode}` : 'Nombre similar'}
                    </p>
                    {group.map((p) => (
                      <div key={p.id} className="flex justify-between items-center text-sm">
                        <span className="font-bold text-slate-800">{p.name} <span className="text-slate-400 font-medium tnum">({p.stock_quantity})</span></span>
                        <button
                          onClick={() => handleMergeGroup(group, p.id)}
                          disabled={mergingId === p.id}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          {mergingId === p.id ? '...' : 'Quedarme este'}
                        </button>
                      </div>
                    ))}
                    <p className="text-[11px] text-slate-400 font-medium">Fusiona stock e historial en el elegido y da de baja al resto.</p>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setDupesOpen(false)}
              className="w-full py-2.5 bg-slate-900 text-white rounded-2xl text-sm font-bold cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Historial de precios */}
      {priceHistProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900">Precios: {priceHistProduct.name}</h2>
              <button onClick={() => setPriceHistProduct(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            {loadingPriceHist ? (
              <p className="text-sm text-slate-400 text-center py-6">Cargando...</p>
            ) : priceHist.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">Sin cambios registrados todavía (se guardan desde ahora).</p>
            ) : (
              <>
                {priceHist.length >= 2 && (() => {
                  const sorted = [...priceHist].reverse();
                  const vals = sorted.flatMap((h: any) => [Number(h.cost_price), Number(h.wholesale_price), Number(h.retail_price)]);
                  const maxV = Math.max(...vals) || 1;
                  const minV = Math.min(...vals);
                  const range = maxV - minV || 1;
                  const w = 320, h = 120, pad = 10;
                  const toX = (i: number) => pad + (i / (sorted.length - 1)) * (w - 2 * pad);
                  const toY = (v: number) => pad + (1 - (v - minV) / range) * (h - 2 * pad);
                  const path = (key: string) => sorted.map((r: any, i: number) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(Number(r[key]))}`).join(' ');
                  return (
                    <div className="bg-slate-50 dark:bg-[#232323] rounded-2xl border border-slate-100 dark:border-[#333333] p-3 mb-3">
                      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
                        <path d={path('cost_price')} fill="none" stroke="#ef4444" strokeWidth="2" />
                        <path d={path('wholesale_price')} fill="none" stroke="#10b981" strokeWidth="2" />
                        <path d={path('retail_price')} fill="none" stroke="#3b82f6" strokeWidth="2" />
                        {sorted.map((r: any, i: number) => (
                          <g key={i}>
                            <circle cx={toX(i)} cy={toY(Number(r.cost_price))} r="3" fill="#ef4444" />
                            <circle cx={toX(i)} cy={toY(Number(r.wholesale_price))} r="3" fill="#10b981" />
                            <circle cx={toX(i)} cy={toY(Number(r.retail_price))} r="3" fill="#3b82f6" />
                          </g>
                        ))}
                      </svg>
                      <div className="flex justify-center gap-4 mt-1.5 text-[11px] font-bold">
                        <span className="text-red-600">● Costo</span>
                        <span className="text-emerald-600">● Mayorista</span>
                        <span className="text-blue-600">● Minorista</span>
                      </div>
                    </div>
                  );
                })()}
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {priceHist.map((h: any) => (
                    <div key={h.id} className="p-3 bg-slate-50 dark:bg-[#232323] rounded-2xl border border-slate-100 dark:border-[#333333] text-[13px]">
                      <p className="text-[11px] text-slate-400 font-bold tnum">{new Date(h.created_at).toLocaleString('es-AR')}</p>
                      <div className="flex justify-between font-bold text-slate-800 dark:text-white tnum mt-1">
                        <span>Costo ${Number(h.cost_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className="text-emerald-700">May ${Number(h.wholesale_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className="text-blue-700">Min ${Number(h.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <button
              onClick={() => setPriceHistProduct(null)}
              className="w-full py-2.5 bg-slate-900 text-white rounded-2xl text-sm font-bold cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Dashboard de rotación de stock */}
      {rotationDashOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl max-w-2xl w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b dark:border-[#333333] pb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BarChart3 size={20} className="text-blue-600" /> Rotación de Stock
              </h2>
              <button onClick={() => setRotationDashOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            {(() => {
              const ranked = activeProducts
                .map((p) => {
                  const r = rotation[p.id];
                  const days = r ? daysSince(r.last) : 9999;
                  return { product: p, days, qty: r?.qty || 0, sold: !!r };
                })
                .sort((a, b) => a.days - b.days);
              const soldOnly = ranked.filter((r) => r.sold);
              const byRecent = [...soldOnly].sort((a, b) => a.days - b.days).slice(0, 10);
              const byVolume = [...soldOnly].sort((a, b) => b.qty - a.qty).slice(0, 10);
              const shown = rotSort === 'recent' ? byRecent : byVolume;
              const maxQty = Math.max(...soldOnly.map((r) => r.qty), 1);
              const top10 = ranked.slice(0, 10);
              const dormant = ranked.filter((r) => r.days > 60);
              const neverSold = ranked.filter((r) => !rotation[r.product.id]);
              return (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-200 dark:border-emerald-800 text-center">
                      <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400 tnum">{top10.length}</p>
                      <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-500">Alta rotación</p>
                    </div>
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-200 dark:border-amber-800 text-center">
                      <p className="text-2xl font-black text-amber-700 dark:text-amber-400 tnum">{dormant.length}</p>
                      <p className="text-[11px] font-bold text-amber-600 dark:text-amber-500">Dormidos (60d+)</p>
                    </div>
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-200 dark:border-red-800 text-center">
                      <p className="text-2xl font-black text-red-700 dark:text-red-400 tnum">{neverSold.length}</p>
                      <p className="text-[11px] font-bold text-red-600 dark:text-red-500">Sin ventas</p>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Top 10 {rotSort === 'recent' ? 'más recientes' : 'más vendidos'}</h3>
                      <div className="flex rounded-lg p-0.5 gap-0.5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-[#333333]">
                        {(['recent', 'volume'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setRotSort(m)}
                            className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition cursor-pointer ${
                              rotSort === m
                                ? 'bg-white text-slate-900 shadow-sm dark:bg-emerald-600 dark:text-white'
                                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                            }`}
                          >
                            {m === 'recent' ? 'Recientes' : 'Más vendidos'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {shown.map((r, i) => {
                        const pct = Math.max(Math.round((r.qty / maxQty) * 100), 3);
                        const critical = Number(r.product.stock_quantity) <= Number(r.product.min_stock || 5);
                        const rev = Math.round(r.qty * Number(r.product.retail_price));
                        return (
                          <div key={r.product.id} className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333]">
                            <span className={`w-6 h-6 rounded-full text-[11px] font-black tnum flex items-center justify-center shrink-0 ${
                              i === 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                              : i === 1 ? 'bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200'
                              : i === 2 ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300'
                              : 'text-slate-400'
                            }`}>{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 dark:text-white truncate">
                                {r.product.name}
                                {critical && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 ml-1.5 align-middle" title="Stock crítico" />}
                              </p>
                              <div className="w-full h-1.5 bg-slate-200 dark:bg-[#333333] rounded-full mt-1">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    background: i === 0 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#10b981,#34d399)',
                                  }}
                                />
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-400 tnum whitespace-nowrap">${rev.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 tnum whitespace-nowrap">hace {r.days}d · {r.qty} ventas</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {dormant.length > 0 && (
                    <div>
                      <h3 className="text-xs font-black text-amber-600 uppercase tracking-widest mb-2">⚠ Dormidos (60+ días sin movimiento)</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {dormant.slice(0, 15).map((r) => (
                          <span key={r.product.id} className="px-2.5 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full text-[11px] font-bold tnum">
                            {r.product.name.length > 20 ? `${r.product.name.slice(0, 20)}…` : r.product.name} · hace {r.days}d
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
            <button
              onClick={() => setRotationDashOpen(false)}
              className="w-full py-2.5 bg-slate-900 text-white rounded-2xl text-sm font-bold cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
