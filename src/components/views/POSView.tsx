import { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import type { Product, CartItem, Profile } from '../../types';
import { Search, ShoppingCart, Trash2, Plus, Minus, Check, Camera, Scale, Pause, X, Clock, AlertTriangle, Receipt, Printer, ArrowRight, Loader2 } from 'lucide-react';
import { CheckCircle, WhatsappLogo, Printer as PrinterPh, Copy as CopyPh, X as XPh, FilePdf as FilePdfPh, Desktop as DesktopPh, SignIn as SignInPh } from '@phosphor-icons/react';
import { RoundedSelect } from '../ui/RoundedSelect';
import { IVA_COND_LABELS, netoFromTotal, ivaFromTotal, round2 } from '../../lib/tax';
import { nextReceiptNumber } from '../../lib/receipt';
import { ScannerModal } from '../../features/scanner/components/ScannerModal';
import { useScanner } from '../../features/scanner/hooks/useScanner';
import { useBarcodeResolution } from '../../features/scanner/hooks/useBarcodeResolution';
import { ContextualTooltip } from '../../features/onboarding';
import { resolveScaleProduct } from '../../features/scanner/services/catalogResolver';
import { loadBusiness, loadCopyToMe, saveCopyToMe } from '../../lib/businessSettings';
import { isValidPhone, normalizeArgPhone, formatPhoneForDisplay, sendTicketWhatsApp, isMobileDevice, openWhatsAppWebLogin } from '../../lib/whatsapp';
import { buildTicketText as buildSharedTicketText, type TicketData, type TicketItem } from '../../lib/ticketText';
import { ticketPdfFile, downloadTicketPdf } from '../../lib/ticketPdf';
import { shareFile } from '../../lib/share';
import { ScaleModal } from '../ui/ScaleModal';
import { enqueueSale } from '../../lib/offlineDB';
import { matchLocalProduct } from '../../lib/productLookup';
import * as cartSvc from '../../lib/cartService';
import { buildSalePayload, executeSale, newOpKey } from '../../lib/salesService';
import { canAnnulSales } from '../../lib/permissions';
import { createMercadoPagoPreference, loadMercadoPagoSettings } from '../../lib/mercadoPagoService';

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

interface ParkedSale {
  id: string;
  customerName: string;
  cart: CartItem[];
  date: string;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface POSViewProps {
  profile: Profile | null;
  showToast?: (msg: string, kind?: ToastKind) => void;
}

export function POSView({ profile, showToast }: POSViewProps) {
  const [products, setProducts] = useState<Product[]>([]);
  // WhatsApp del dueño del negocio: recibe copia de cada comprobante enviado.
  const myWhatsapp = useMemo(() => normalizeArgPhone(loadBusiness().myWhatsapp), []);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [priceType, setPriceType] = useState<'wholesale' | 'retail'>('retail');
  const [saleType, setSaleType] = useState<'internal' | 'afip'>('internal');
  // 'mercadopago'      → Checkout Pro (link / QR online)
  // 'mercadopago_point' → terminal Mercado Pago Point (Point Smart)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'card' | 'mercadopago' | 'mercadopago_point'>('cash');
  // El valor que se guarda en sales.payment_method: Point y Checkout Pro
  // se reportan igual (ambos son Mercado Pago).
  const dbPaymentMethod = paymentMethod === 'mercadopago_point' ? 'mercadopago' : paymentMethod;
  // Detalle transferencia
  const [transferBank, setTransferBank] = useState(() => {
    try { return localStorage.getItem('dv-transfer-bank') || ''; } catch { return ''; }
  });
  const [transferBankOther, setTransferBankOther] = useState('');
  const [transferAccount, setTransferAccount] = useState(() => {
    try { return localStorage.getItem('dv-transfer-account') || ''; } catch { return ''; }
  });
  const [transferAccountOptions, setTransferAccountOptions] = useState<string[]>([]);
  const [transferAccountOther, setTransferAccountOther] = useState('');
  const [transferRef, setTransferRef] = useState('');
  // Detalle tarjeta
  const [cardType, setCardType] = useState<'debit' | 'credit'>('debit');
  const [cardBrand, setCardBrand] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [cardAuth, setCardAuth] = useState('');
  const [cardInstallments, setCardInstallments] = useState('1');
  // Detalle Mercado Pago
  const [mpMode] = useState<'test' | 'prod'>(() => loadMercadoPagoSettings().mpMode || 'test');
  const [mpAuth, setMpAuth] = useState('');
  const [mpLink, setMpLink] = useState('');
  const [mpPreferenceId, setMpPreferenceId] = useState('');
  const [mpPendingSaleId, setMpPendingSaleId] = useState<string | null>(null);
  const [mpWaiting, setMpWaiting] = useState(false);
  const [mpOrderId, setMpOrderId] = useState('');

  const resetMpState = () => {
    setMpLink('');
    setMpPreferenceId('');
    setMpAuth('');
    setMpPendingSaleId(null);
    setMpWaiting(false);
    setMpOrderId('');
  };

  // El webhook de MP finaliza/cancela la venta.
  // Se escucha por Realtime y, como respaldo, por polling cada 3s
  // (así funciona aunque Realtime no esté habilitado en la tabla sales).
  useEffect(() => {
    if (!mpPendingSaleId) return;
    let done = false;

    const applyStatus = (status: string | undefined) => {
      if (done) return;
      if (status === 'completed') {
        done = true;
        setCart([]);
        resetMpState();
        fetchProducts();
        window.dispatchEvent(new Event('dv:sale-completed'));
        if (showToast) showToast('✅ Pago aprobado. Venta registrada automáticamente.', 'success');
      } else if (status === 'cancelled') {
        done = true;
        resetMpState();
        if (showToast) showToast('❌ Pago rechazado. La venta NO se guardó.', 'error');
      }
    };

    const channel = supabase
      .channel(`mp-sale-${mpPendingSaleId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sales', filter: `id=eq.${mpPendingSaleId}` },
        (payload) => applyStatus((payload.new as any)?.status)
      )
      .subscribe();

    let alive = true;
    // Respaldo: si el webhook de MP no llega, se le pregunta a MP directamente.
    // Se limita a 1 consulta cada ~8s para no golpear la API.
    let lastCheck = 0;
    const CHECK_INTERVAL_MS = 8000;

    const forceCheck = async () => {
      if (!alive) return;
      const now = Date.now();
      if (now - lastCheck < CHECK_INTERVAL_MS) return;
      lastCheck = now;
      try {
        const { data, error } = await supabase.functions.invoke('mp-check-payment', {
          body: { p_sale_id: mpPendingSaleId },
        });
        if (error) return;
        const r = data as any;
        if (r?.action === 'finalized') applyStatus('completed');
        else if (r?.action === 'cancelled') applyStatus('cancelled');
      } catch { /* sin red o funcion no desplegada: se reintenta en el proximo ciclo */ }
    };

    const poll = async () => {
      const { data } = await supabase
        .from('sales')
        .select('status')
        .eq('id', mpPendingSaleId)
        .maybeSingle();
      if (!alive || !data) return;
      // Si sigue pendiente, se fuerza la consulta a MP.
      if (data.status === 'pending_payment' || data.status === 'pending') {
        await forceCheck();
        if (!alive) return;
        const { data: fresh } = await supabase
          .from('sales')
          .select('status')
          .eq('id', mpPendingSaleId)
          .maybeSingle();
        applyStatus((fresh?.status ?? data.status) as string);
        return;
      }
      applyStatus(data.status as string);
    };
    poll();
    const timer = window.setInterval(poll, 3000);

    return () => {
      alive = false;
      window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpPendingSaleId]);

  // Venta dirigida por pago: genera link + crea venta pendiente (sin stock) + espera el webhook
  const startMpPayment = async () => {
    if (mpPendingSaleId) return; // ya hay una venta MP en curso, no duplicar
    const externalRef = `SALE-${(typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const res = await createMercadoPagoPreference({
      title: `Venta Dietética (${cart.length} ítems)`,
      unitPrice: totalAmount,
      quantity: 1,
      externalReference: externalRef,
    });
    const link = res.initPoint;

    const opKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { data, error } = await supabase.rpc('create_mp_pending_sale', {
      p_customer_name: customerName || 'Cliente General',
      p_total_amount: totalAmount,
      p_items: cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price,
        cost_price: item.product.cost_price,
      })),
      p_payment: { method: 'mercadopago', ...paymentDetailFields() },
      p_sale_type: saleType,
      p_dispatch_type: dispatchType,
      p_notes: saleNotes || null,
      p_customer_doc: customerDoc.replace(/\D/g, '') || null,
      p_customer_iva_cond: customerIvaCond,
      p_customer_phone: customerPhone.replace(/\D/g, '') || null,
      p_net_amount: round2(netoFromTotal(totalAmount)),
      p_iva_amount: round2(ivaFromTotal(totalAmount)),
      p_profit_amount: totalProfit,
      p_discount_amount: round2(discountVal),
      p_idempotency_key: opKey,
      p_mp_link: link,
      p_mp_preference_id: res.preferenceId || null,
      p_mp_external_ref: externalRef,
    });
    if (error) throw error;
    const saleId = Array.isArray(data) ? data?.[0]?.sale_id : data?.sale_id;

    setMpLink(link);
    setMpPreferenceId(res.preferenceId || '');
    setMpPendingSaleId(saleId);
    setMpWaiting(true);
  };

  /**
   * Mercado Pago POINT (terminal Point Smart).
   * Crea la venta pendiente y luego la "order" que viaja a la terminal.
   * El webhook de MP (o el polling de respaldo) termina la venta.
   */
  const startMpPointPayment = async () => {
    if (mpPendingSaleId) return; // ya hay una venta MP en curso, no duplicar
    const externalRef = `SALE-${(typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

    const opKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 1) Venta pendiente (sin stock hasta que se apruebe el pago)
    const { data, error } = await supabase.rpc('create_mp_pending_sale', {
      p_customer_name: customerName || 'Cliente General',
      p_total_amount: totalAmount,
      p_items: cart.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        unit_price: item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price,
        cost_price: item.product.cost_price,
      })),
      p_payment: { method: 'mercadopago' },
      p_sale_type: saleType,
      p_dispatch_type: dispatchType,
      p_notes: saleNotes || null,
      p_customer_doc: customerDoc.replace(/\D/g, '') || null,
      p_customer_iva_cond: customerIvaCond,
      p_customer_phone: customerPhone.replace(/\D/g, '') || null,
      p_net_amount: round2(netoFromTotal(totalAmount)),
      p_iva_amount: round2(ivaFromTotal(totalAmount)),
      p_profit_amount: totalProfit,
      p_discount_amount: round2(discountVal),
      p_idempotency_key: opKey,
      p_mp_link: null,
      p_mp_preference_id: null,
      p_mp_external_ref: externalRef,
    });
    if (error) throw error;
    const saleId = Array.isArray(data) ? data?.[0]?.sale_id : data?.sale_id;

    setMpPendingSaleId(saleId);
    setMpWaiting(true);

    // 2) Crear la order en la terminal
    const { data: fnData, error: fnError } = await supabase.functions.invoke('mp-point-order', {
      body: { p_action: 'create', p_sale_id: saleId, p_mode: mpMode },
    });
    if (fnError) {
      notify(`No se pudo enviar el cobro a la terminal: ${fnError.message}`, 'error');
      return;
    }
    const res = fnData as any;
    if (res?.error) {
      notify(`Terminal Point: ${res.error}`, 'error');
      return;
    }
    setMpOrderId(res?.orderId || '');
  };

  const abortMpPayment = async () => {
    const saleId = mpPendingSaleId;
    resetMpState();
    if (saleId) {
      try {
        await supabase.rpc('cancel_mp_sale', { p_sale_id: saleId });
      } catch { /* si ya se aprobó, no se puede cancelar */ }
    }
    if (showToast) showToast('Espera cancelada. La venta pendiente quedó anulada.', 'info');
  };

  const BANKS_AR = ['Galicia', 'Santander', 'Nación', 'Provincia', 'BBVA', 'Macro', 'ICBC', 'Patagonia', 'HSBC', 'Supervielle', 'Mercado Pago', 'Ualá', 'Brubank', 'Naranja X', 'Otro'];
  const [cardBrandOptions, setCardBrandOptions] = useState<string[]>(['Visa', 'Mastercard', 'American Express', 'Cabal', 'Naranja X', 'Ualá', 'Mercado Pago', 'Nativa', 'Otra']);
  const [cardBrandOther, setCardBrandOther] = useState('');
  const cardBrandEff = cardBrand === 'Otra' ? cardBrandOther.trim() : cardBrand;

  const normalizeBrandCode = (name: string) =>
    name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  // Auto-registra marcas nuevas en el catálogo (sin duplicar)
  const registerCardBrand = async (name: string) => {
    const clean = name.trim();
    if (!clean || !navigator.onLine) return;
    try {
      const norm = normalizeBrandCode(clean);
      if (!norm) return;
      const { data: existing } = await supabase.from('card_brands').select('code, name').eq('is_active', true);
      if ((existing || []).some((b: any) => normalizeBrandCode(b.name) === norm || b.code === norm)) return;
      const code = norm.slice(0, 30);
      const { error } = await supabase.from('card_brands').upsert({ code, name: clean }, { onConflict: 'code' });
      if (error) throw error;
      setCardBrandOptions((prev) => {
        const withoutOtra = prev.filter((n) => n !== 'Otra');
        if (withoutOtra.some((n) => normalizeBrandCode(n) === norm)) return prev;
        return [...withoutOtra, clean, 'Otra'];
      });
      notify(`Tarjeta "${clean}" agregada al catálogo.`, 'success');
    } catch { /* sin permiso o sin red: la venta igual se guarda */ }
  };
  // Auto-registra alias nuevos en el catálogo (sin duplicar)
  const registerTransferAccount = async (name: string) => {
    const clean = name.trim();
    if (!clean || !navigator.onLine) return;
    try {
      const norm = normalizeBrandCode(clean);
      if (!norm) return;
      const { data: existing } = await supabase.from('transfer_accounts').select('alias').eq('is_active', true);
      if ((existing || []).some((a: any) => normalizeBrandCode(a.alias) === norm)) return;
      const { error } = await supabase.from('transfer_accounts').upsert({ alias: clean }, { onConflict: 'alias' });
      if (error) throw error;
      setTransferAccountOptions((prev) => {
        if (prev.some((a) => normalizeBrandCode(a) === norm)) return prev;
        return [...prev.filter((a) => a !== 'Otro'), clean, 'Otro'];
      });
      notify(`Alias "${clean}" agregado al catálogo.`, 'success');
    } catch { /* sin permiso o sin red: la venta igual se guarda */ }
  };
  const transferBankEff = transferBank === 'Otro' ? transferBankOther.trim() : transferBank;
  const transferAccountEff = transferAccount === 'Otro' ? transferAccountOther.trim() : transferAccount;

  // Solo envía columnas con valor (compatible con schemas viejos)
  const paymentDetailFields = () => ({
    ...(paymentMethod === 'transfer' ? {
      ...(transferBankEff ? { transfer_bank: transferBankEff } : {}),
      ...(transferAccountEff ? { transfer_account: transferAccountEff } : {}),
      ...(transferRef ? { transfer_ref: transferRef } : {}),
    } : {}),
    ...(paymentMethod === 'card' ? {
      card_type: cardType,
      ...(cardBrandEff ? { card_brand: cardBrandEff } : {}),
      ...(cardLast4 ? { card_last4: cardLast4 } : {}),
      ...(cardAuth.trim() ? { card_auth: cardAuth.trim() } : {}),
      ...(cardType === 'credit' ? { card_installments: parseInt(cardInstallments) || 1 } : {}),
    } : {}),
    ...(paymentMethod === 'mercadopago' ? {
      ...(mpAuth.trim() ? { mp_auth: mpAuth.trim() } : {}),
      ...(mpLink ? { mp_link: mpLink } : {}),
      ...(mpPreferenceId ? { mp_preference_id: mpPreferenceId } : {}),
    } : {}),
  });

  const rememberPaymentDefaults = () => {
    try {
      if (transferBank) localStorage.setItem('dv-transfer-bank', transferBank);
      if (transferAccountEff) localStorage.setItem('dv-transfer-account', transferAccountEff);
    } catch { /* noop */ }
  };

  const clearPaymentDetailOnce = () => {
    setTransferRef('');
    setCardLast4('');
    setCardAuth('');
    setCardInstallments('1');
    setCardBrandOther('');
    setMpAuth('');
    setMpLink('');
    setMpPreferenceId('');
  };
  const [dispatchType, setDispatchType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryFeeType, setDeliveryFeeType] = useState<'free' | 'fixed' | 'percent'>('free');
  const [deliveryFeeValue, setDeliveryFeeValue] = useState<string>('0');
  const [customerName, setCustomerName] = useState('Cliente General');
  const [customerDoc, setCustomerDoc] = useState('');
  const [customerIvaCond, setCustomerIvaCond] = useState<'CF' | 'RI' | 'MONOTRIBUTO' | 'EXENTO'>('CF');
  const [customerPhone, setCustomerPhone] = useState('');
  const [whatsappError, setWhatsappError] = useState('');
  const [copiedOk, setCopiedOk] = useState(false);
  const [copyToMe, setCopyToMe] = useState(() => loadCopyToMe());
  const [pdfBusy, setPdfBusy] = useState(false);
  const [cashGiven, setCashGiven] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountValue, setDiscountValue] = useState<string>('0');
  const [loading, setLoading] = useState(false);
  const [saleNotes, setSaleNotes] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Modals state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scaleModalOpen, setScaleModalOpen] = useState(false);
  const [activeKgProduct, setActiveKgProduct] = useState<Product | null>(null);

  // Scanner Core: el POS registra el RESOLVER; el modal solo reacciona (sin supabase)
  const scannerApi = useScanner();
  const lastScannedCodeRef = useRef('');
  const lastHardwareAddedRef = useRef('');
  // Botón central móvil: abre el escáner de esta vista al navegar desde el sheet
  useEffect(() => {
    const open = () => setScannerOpen(true);
    window.addEventListener('dv:open-scanner', open);
    return () => window.removeEventListener('dv:open-scanner', open);
  }, []);

  /** F9: si es código de balanza, devuelve {product, weightKg} buscando por PLU. */
  const resolveScale = (code: string): { product: Product; weightKg: number } | null =>
    resolveScaleProduct(code, products);

  const { resolve: resolveBarcodeCode } = useBarcodeResolution(products, { scaleNameSuffix: true });

  useEffect(() => {
    scannerApi.setOnDetected(async (code: string) => resolveBarcodeCode(code));
    return () => { scannerApi.setOnDetected(null); };
  }, [products, resolveBarcodeCode]);

  // F8: lector físico (USB/BT) sin modal — suma directo al carrito.
  // El provider captura código+ENTER global; si el modal está cerrado y
  // la lectura vino por hardware, se agrega sin confirmación.
  const scannerResolution = scannerApi.resolution;
  const scannerLastResult = scannerApi.lastResult;
  useEffect(() => {
    if (!scannerResolution || scannerResolution.status !== 'found') return;
    if (scannerOpen) return; // modal abierto → confirma el usuario con el botón
    if (scannerLastResult?.source !== 'hardware') return;
    const code = scannerResolution.barcode;
    if (!code || code === lastHardwareAddedRef.current) return;
    lastHardwareAddedRef.current = code;
    handleBarcodeScanned(code);
    scannerApi.resetStatus();
    window.setTimeout(() => { lastHardwareAddedRef.current = ''; }, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerResolution]);
  const [successSale, setSuccessSale] = useState<any | null>(null);
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [recentModalOpen, setRecentModalOpen] = useState(false);
  const [recentLoading, setRecentLoading] = useState(false);
  const [parkedSales, setParkedSales] = useState<ParkedSale[]>(() => {
    try {
      const raw = localStorage.getItem('pos-parked-sales');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [parkedModalOpen, setParkedModalOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem('pos-parked-sales', JSON.stringify(parkedSales)); } catch { /* noop */ }
  }, [parkedSales]);
  const [isOnline, setIsOnline] = useState(true);
  const [customers, setCustomers] = useState<{ id: string; name: string; phone?: string | null; doc_number?: string | null }[]>([]);
  const [custDropdown, setCustDropdown] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('pos-recent') || '[]'); } catch { return []; }
  });

  const trackRecent = (id: string) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, 8);
      try { localStorage.setItem('pos-recent', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };
  const [localToast, setLocalToast] = useState<string | null>(null);
  const notifyTimer = useRef<number | null>(null);
  const notify = (msg: string, kind: ToastKind = 'info') => {
    if (showToast) { showToast(msg, kind); return; }
    setLocalToast(msg);
    if (notifyTimer.current) window.clearTimeout(notifyTimer.current);
    notifyTimer.current = window.setTimeout(
      () => setLocalToast(null),
      kind === 'warning' || kind === 'error' ? 6000 : 3500
    );
  };

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    fetchProducts();
    (async () => {
      try {
        const { getCachedCustomers, cacheCustomers } = await import('../../lib/offlineDB');
        if (!navigator.onLine) {
          setCustomers(await getCachedCustomers());
        } else {
          const { data } = await supabase.from('customers').select('id, name, phone, doc_number').eq('is_active', true).order('name').limit(200);
          if (data) { setCustomers(data); await cacheCustomers(data); }
        }
      } catch { /* sin clientes: se usa texto libre */ }
      try {
        const { data: brands } = await supabase.from('card_brands').select('name').eq('is_active', true).order('name');
        if (brands && brands.length > 0) {
          const names = brands.map((b: any) => b.name).filter(Boolean);
          setCardBrandOptions([...names.filter((n: string) => n !== 'Otra'), 'Otra']);
        }
      } catch { /* fallback: lista local */ }
      try {
        const { data: accounts } = await supabase.from('transfer_accounts').select('alias').eq('is_active', true).order('alias');
        if (accounts && accounts.length > 0) {
          const aliases = accounts.map((a: any) => a.alias).filter(Boolean);
          setTransferAccountOptions([...aliases.filter((a: string) => a !== 'Otro'), 'Otro']);
        }
      } catch { /* fallback: lista local */ }
    })();
  }, []);

  // Atajos que necesitan la versión actual de los handlers (evita closures viejas).
  const shortcutHandlers = useRef<{ complete: () => void; park: () => void }>({
    complete: () => {},
    park: () => {},
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSuccessSale(null);
        setShowShortcuts(false);
      }
      if (e.key === 'h' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      // F12 → cobrar (mismo comportamiento que el botón COBRAR).
      if (e.key === 'F12') {
        e.preventDefault();
        shortcutHandlers.current.complete();
        return;
      }
      // P → poner el carrito en espera (sin modificadores ni foco en un input).
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
        e.preventDefault();
        shortcutHandlers.current.park();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      let list = data || [];
      // Mergear aliases para lookup local (principal + alias)
      try {
        const { data: aliases } = await supabase.from('product_barcodes').select('product_id, barcode');
        if (aliases && (aliases as any[]).length > 0) {
          const byPid = new Map<string, string[]>();
          (aliases as any[]).forEach((r) => {
            if (!byPid.has(r.product_id)) byPid.set(r.product_id, []);
            byPid.get(r.product_id)!.push(r.barcode);
          });
          list = list.map((p: any) => ({ ...p, aliasBarcodes: byPid.get(p.id) || [] }));
        }
      } catch { /* tabla puede no existir todavía */ }
      setProducts(list);
      // Cachear productos exitosos
      if (list.length > 0) {
        const { cacheProducts } = await import('../../lib/offlineDB');
        await cacheProducts(list);
      }
    } catch (err) {
      console.warn('Fetch products failed, loading from cache:', err);
      // Fallback a caché offline
      try {
        const { getCachedProducts } = await import('../../lib/offlineDB');
        const cached = await getCachedProducts();
        if (cached.length > 0) {
          setProducts(cached.filter(p => p.is_active).sort((a, b) => a.name.localeCompare(b.name)));
          console.log('Loaded products from offline cache:', cached.length);
        }
      } catch (cacheErr) {
        console.error('Error loading from cache:', cacheErr);
      }
    }
  };

  const handleProductClick = (product: Product) => {
    if (product.unit_type === 'kg') {
      setActiveKgProduct(product);
      setScaleModalOpen(true);
    } else {
      addToCart(product, 1);
    }
  };

  const addToCart = (product: Product, quantity: number) => {
    console.log('[POS] add-item', product.name, quantity);
    trackRecent(product.id);
    const result = cartSvc.addToCart(cart, product, quantity, priceType);
    if (result.status === 'insufficient') {
      notify(`Stock insuficiente: ${product.name} (disponible ${result.available})`, 'warning');
      return;
    }
    if (result.clampedTo !== null) {
      notify(`Stock insuficiente: ${product.name} (disponible ${Number(product.stock_quantity)})`, 'warning');
    }
    setCart(result.cart);
  };

  const updateQuantity = (productId: string, delta: number) => {
    const next = cartSvc.updateQuantity(cart, productId, delta);
    if (next === null) {
      const item = cart.find((i) => i.product.id === productId);
      notify(`Stock máximo alcanzado: ${item?.product.name} (${item?.product.stock_quantity})`, 'warning');
      return;
    }
    setCart(next);
  };

  const removeItem = (productId: string) => {
    const doomed = cart.find((item) => item.product.id === productId);
    if (doomed) stashRemoved([doomed], doomed.product.name);
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Deshacer quitar/vaciar (snapshot 8s)
  const [lastRemoved, setLastRemoved] = useState<{ items: CartItem[]; label: string } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const stashRemoved = (items: CartItem[], label: string) => {
    setLastRemoved({ items, label });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setLastRemoved(null), 8000);
  };
  const undoRemove = () => {
    if (!lastRemoved) return;
    setCart(cartSvc.restoreRemoved(cart, lastRemoved.items));
    setLastRemoved(null);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
  };
  const handleClearCart = () => {
    if (cart.length === 0) return;
    stashRemoved([...cart], `${cart.length} líneas`);
    setCart([]);
  };

  // El toggle global aplica a TODO el carrito (evita carrito mixto silencioso)
  const handlePriceTypeChange = (t: 'wholesale' | 'retail') => {
    setPriceType(t);
    setCart((prev) => (prev.length > 0 ? cartSvc.setCartPriceType(prev, t) : prev));
    if (cart.length > 0) {
      notify(t === 'wholesale' ? 'Carrito a precio Mayorista' : 'Carrito a precio Minorista');
    }
  };

  const { rawSubtotal, discountVal, deliveryFee, totalAmount, totalProfit } = cartSvc.computeTotals(
    cart,
    { discountType, discountValue },
    { dispatchType, deliveryFeeType, deliveryFeeValue }
  );

  const cashGivenNum = parseFloat(cashGiven) || 0;
  const changeDue = cashGivenNum > totalAmount ? cashGivenNum - totalAmount : 0;

  const handleBarcodeScanned = (barcode: string) => {
    // F9: balanza → peso directo, sin ScaleModal
    const scaleHit = resolveScale(barcode);
    if (scaleHit) {
      if (scaleHit.product.unit_type === 'kg') {
        addToCart(scaleHit.product, Math.round(scaleHit.weightKg * 1000) / 1000);
        notify(`Balanza: ${scaleHit.product.name} × ${scaleHit.weightKg.toFixed(3)} kg`, 'success');
      } else {
        handleProductClick(scaleHit.product);
        notify('Código de balanza para producto unitario: agregado ×1.', 'info');
      }
      return;
    }
    const found = matchLocalProduct(products, barcode) || products.find((p) => p.barcode === barcode);
    if (found) {
      handleProductClick(found);
    } else {
      notify(`Sin resultados para código: ${barcode}`, 'warning');
    }
  };

  const handleBarcodeSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const term = searchTerm.trim();
      if (!term) return;
      const found = matchLocalProduct(products, term) || products.find((p) => p.barcode === term);
      if (found) {
        handleProductClick(found);
        setSearchTerm('');
      } else {
        // No es un código de barras válido, buscar por nombre
        setSearchTerm(term);
      }
    }
  };

  const handleParkSale = () => {
    if (cart.length === 0) return;
    const newParked: ParkedSale = {
      id: Math.random().toString(36).substring(2, 9),
      customerName: customerName || 'Cliente General',
      cart: [...cart],
      date: new Date().toLocaleTimeString(),
    };
    setParkedSales((prev) => [...prev, newParked]);
    setCart([]);
    setCustomerName('Cliente General');
    notify('Venta en espera guardada.', 'success');
  };

  const handleResumeParkedSale = (parked: ParkedSale) => {
    setCart(parked.cart);
    setCustomerName(parked.customerName);
    setParkedSales((prev) => prev.filter((p) => p.id !== parked.id));
    setParkedModalOpen(false);
  };

  const fetchRecentSales = async () => {
    setRecentLoading(true);
    try {
      const { data } = await supabase
        .from('sales')
        .select('*, sale_items(product_id, quantity, unit_price, subtotal, products(name))')
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentSales(data || []);
    } catch { setRecentSales([]); }
    finally { setRecentLoading(false); }
  };

  const openRecentModal = () => {
    setRecentModalOpen(true);
    fetchRecentSales();
  };

  // Reimprime un ticket viejo reutilizando el modal de éxito
  const handleReprintSale = (s: any) => {
    const cart = (s.sale_items || []).map((it: any) => ({
      product: { id: '', name: it.products?.name || 'Producto', wholesale_price: Number(it.unit_price), retail_price: Number(it.unit_price), cost_price: 0, unit_type: 'unit' as const },
      quantity: Number(it.quantity),
      priceType: 'retail' as const,
      discount: 0,
    }));
    const raw = cart.reduce((a: number, i: any) => a + Number(i.product.retail_price) * Number(i.quantity), 0);
    setRecentModalOpen(false);
    setSuccessSale({
      id: s.id,
      receiptNumber: s.receipt_number || null,
      customerName: s.customer_name || 'Cliente General',
      customerDoc: '', customerIvaCond: 'CF', customerPhone: '',
      cart, rawSubtotal: raw, discountVal: 0, discountType: 'fixed' as const, discountValue: 0,
      deliveryFee: 0, deliveryFeeType: 'free' as const,
      totalAmount: Number(s.total_amount),
      netAmount: round2(netoFromTotal(Number(s.total_amount))),
      ivaAmount: round2(ivaFromTotal(Number(s.total_amount))),
      saleType: s.sale_type || 'internal', paymentMethod: s.payment_method || 'cash',
      dispatchType: s.dispatch_type || 'pickup', notes: '',
      cashGiven: 0, changeDue: 0,
      itemCount: cart.reduce((a: number, i: any) => a + Number(i.quantity), 0),
      date: new Date(s.created_at).toLocaleString('es-AR'),
    });
  };

  const handleAnnulSale = async (s: any) => {
    if (!confirm(`¿Anular la venta de $${Number(s.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${s.customer_name || 'Cliente General'})? Se devuelve el stock.`)) return;
    try {
      // Anulación transaccional (mismo mecanismo que Dashboard e Historial).
      const { error } = await supabase.rpc('cancel_sale', { p_sale_id: s.id });
      if (error) throw error;
      notify('Venta anulada y stock restituido.', 'success');
      fetchRecentSales();
      fetchProducts();
    } catch (err: any) {
      notify(`Error al anular: ${err?.message || err}`, 'error');
    }
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) return;

    // Última barrera de stock: nunca cobrar más de lo disponible.
    const overStock = cart.find((item) => {
      const available = cartSvc.stockOf(item.product);
      return Number.isFinite(available) && item.quantity > available;
    });
    if (overStock) {
      notify(`Stock insuficiente: ${overStock.product.name} (disponible ${overStock.product.stock_quantity})`, 'error');
      return;
    }

    setLoading(true);

    // Modo offline: encolar venta localmente
    if (!isOnline) {
      try {
        const receiptNumber = await nextReceiptNumber();
        const salePayload: any = {
          user_id: profile?.id || null,
          customer_name: customerName || 'Cliente General',
          customer_doc: customerDoc.replace(/\D/g, '') || null,
          customer_iva_cond: customerIvaCond,
          sale_type: saleType,
          receipt_number: receiptNumber,
          total_amount: totalAmount,
          net_amount: round2(netoFromTotal(totalAmount)),
          iva_amount: round2(ivaFromTotal(totalAmount)),
          profit_amount: totalProfit,
          discount_amount: round2(discountVal),
          payment_method: dbPaymentMethod,
          dispatch_type: dispatchType,
          notes: saleNotes || null,
          status: 'completed',
          // Clave de idempotencia: garantiza que un reintento del sync
          // NO cree una venta duplicada.
          idempotency_key: newOpKey(),
          ...paymentDetailFields(),
        };

        // Encolar venta completa para sincronizar después
        await enqueueSale({
          salePayload,
          cart: cartSvc.checkoutItems(cart),
          profileId: profile?.id || null,
          paymentMethod,
          dispatchType,
        }, profile?.id || null);

        // Actualizar stock local optimista (sin red: solo estado local)
        setProducts((prev) => prev.map((p) => {
          const item = cart.find((i) => i.product.id === p.id);
          if (!item) return p;
          return { ...p, stock_quantity: Math.max(0, Number(p.stock_quantity) - item.quantity) };
        }));

        setSuccessSale({
          id: `offline-${Date.now()}`,
          receiptNumber: `OFF-${Date.now().toString().slice(-6)}`,
          customerName,
          customerDoc: customerDoc.replace(/\D/g, ''),
          customerIvaCond,
          customerPhone: customerPhone.replace(/\D/g, ''),
          cart: [...cart],
          rawSubtotal,
          discountVal,
          discountType,
          discountValue: parseFloat(discountValue) || 0,
          deliveryFee,
          deliveryFeeType,
          totalAmount,
          netAmount: round2(netoFromTotal(totalAmount)),
          ivaAmount: round2(ivaFromTotal(totalAmount)),
          saleType,
          paymentMethod,
          dispatchType,
          notes: saleNotes || '',
          cashGiven: cashGivenNum,
          changeDue,
          itemCount: cart.reduce((a, i) => a + i.quantity, 0),
          date: new Date().toLocaleString('es-AR'),
          ...paymentDetailFields(),
        });

        setCart([]);
        setCustomerName('Cliente General');
        setCustomerDoc('');
        setCustomerPhone('');
        setSaleNotes('');
        setDiscountValue('0');
        setDiscountType('percent');
        setDeliveryFeeValue('0');
        setDeliveryFeeType('free');
        rememberPaymentDefaults();
        clearPaymentDetailOnce();

        notify('Venta guardada offline. Se sincronizará al recuperar conexión.', 'success');
        window.dispatchEvent(new Event('dv:sale-completed'));
      } catch (err) {
        console.error('Error guardando offline:', err);
        notify('Error al guardar venta offline', 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Mercado Pago: venta dirigida por pago.
    // Se crea una venta PENDIENTE (sin stock) y el webhook la finaliza
    // al aprobar o la cancela al rechazar. No se limpia el carrito acá.
    if (paymentMethod === 'mercadopago_point') {
      console.log('[Sale] mp-point-flow-start', cart.length, 'items');
      try {
        await startMpPointPayment();
        if (showToast) showToast('Cobro enviado a la terminal. Esperando pago…', 'info');
      } catch (e: any) {
        console.log('[Sale] mp-point-flow-error', e?.message || e);
        notify('Error enviando el cobro a la terminal: ' + (e?.message || e), 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (paymentMethod === 'mercadopago') {
      console.log('[Sale] mp-flow-start', cart.length, 'items');
      try {
        await startMpPayment();
        if (showToast) showToast('Link generado. Esperando pago del cliente…', 'info');
      } catch (e: any) {
        console.log('[Sale] mp-flow-error', e?.message || e);
        notify('Error generando link Mercado Pago: ' + (e?.message || e), 'error');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Modo ONLINE: flujo original
    console.log('[Sale] checkout-start', cart.length, 'items');
    try {
      const receiptNumber = await nextReceiptNumber();
      const customer = {
        name: customerName || 'Cliente General',
        doc: customerDoc,
        ivaCond: customerIvaCond,
        phone: customerPhone,
      };
      const config = {
        saleType,
        dispatchType,
        notes: saleNotes || null,
        totalAmount,
        totalProfit,
        discountAmount: discountVal,
      };
      const paymentDetail = paymentDetailFields();

      const { saleId, receiptNumber: finalReceipt } = await executeSale({
        payload: buildSalePayload({
          userId: profile?.id || null,
          customer,
          config,
          receiptNumber,
          paymentMethod,
          paymentDetail,
        }),
        cart,
        customer,
        config,
        paymentMethod,
        paymentDetail,
      });

      setSuccessSale({
        id: saleId,
        receiptNumber: finalReceipt,
        customerName,
        customerDoc: customerDoc.replace(/\D/g, ''),
        customerIvaCond,
        customerPhone: customerPhone.replace(/\D/g, ''),
        cart: [...cart],
        rawSubtotal,
        discountVal,
        discountType,
        discountValue: parseFloat(discountValue) || 0,
        deliveryFee,
        deliveryFeeType,
        totalAmount,
        netAmount: round2(netoFromTotal(totalAmount)),
        ivaAmount: round2(ivaFromTotal(totalAmount)),
        saleType,
        paymentMethod,
        dispatchType,
        notes: saleNotes || '',
        cashGiven: cashGivenNum,
        changeDue,
        itemCount: cart.reduce((a, i) => a + i.quantity, 0),
        date: new Date().toLocaleString('es-AR'),
        ...paymentDetailFields(),
      });
      setSaleNotes('');
      setCart([]);
      setCashGiven('');
      setDiscountType('percent');
      setDiscountValue('0');
      setDeliveryFeeType('free');
      setDeliveryFeeValue('0');
      rememberPaymentDefaults();
      clearPaymentDetailOnce();
      fetchProducts();
      if (paymentMethod === 'card' && cardBrand === 'Otra' && cardBrandOther.trim()) {
        registerCardBrand(cardBrandOther);
      }
      console.log('[Sale] checkout-success', saleId);
      window.dispatchEvent(new Event('dv:sale-completed'));
    } catch (err: any) {
      console.log('[Sale] checkout-error', err?.message || err);
      notify('Error al procesar la venta: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Mantiene los atajos apuntando a la versión actual de los handlers.
  shortcutHandlers.current.complete = () => {
    if (loading) return;
    if (successSale || scaleModalOpen || scannerOpen || recentModalOpen || parkedModalOpen) return;
    if (cart.length === 0) return;
    handleCompleteSale();
  };
  shortcutHandlers.current.park = () => {
    if (successSale || scaleModalOpen || scannerOpen || recentModalOpen || parkedModalOpen) return;
    handleParkSale();
  };

  /** Arma el modelo de ticket (compartido por WhatsApp, impresión y PDF). */
  const toTicketData = (sale: any): TicketData => {
    const items: TicketItem[] = (sale.cart || []).map((i: CartItem) => {
      const uPrice = i.priceType === 'wholesale' ? i.product.wholesale_price : i.product.retail_price;
      return {
        name: i.product.name,
        quantity: i.quantity,
        unitPrice: uPrice,
        subtotal: i.quantity * uPrice,
      };
    });

    const paymentDetails: string[] = [];
    if (sale.paymentMethod === 'transfer') {
      if (sale.transfer_bank || sale.transferBank) paymentDetails.push(`Banco origen: ${sale.transfer_bank || sale.transferBank}`);
      if (sale.transfer_account || sale.transferAccount) paymentDetails.push(`Cuenta destino: ${sale.transfer_account || sale.transferAccount}`);
      if (sale.transfer_ref || sale.transferRef) paymentDetails.push(`Comprobante: ${sale.transfer_ref || sale.transferRef}`);
    }
    if (sale.paymentMethod === 'card') {
      const det = [
        sale.card_type === 'credit' ? 'Crédito' : sale.card_type === 'debit' ? 'Débito' : null,
        sale.card_brand || sale.cardBrand,
        (sale.card_last4 || sale.cardLast4) ? `****${sale.card_last4 || sale.cardLast4}` : null,
      ].filter(Boolean).join(' · ');
      if (det) paymentDetails.push(`Tarjeta: ${det}`);
      if (sale.card_auth || sale.cardAuth) paymentDetails.push(`Autorización: ${sale.card_auth || sale.cardAuth}`);
      if ((sale.card_type === 'credit') && (sale.card_installments || sale.cardInstallments)) paymentDetails.push(`Cuotas: ${sale.card_installments || sale.cardInstallments}`);
    }

    return {
      saleId: sale.id,
      receiptNumber: sale.receiptNumber || null,
      dateLabel: sale.date || new Date().toLocaleString('es-AR'),
      customerName: sale.customerName || 'Cliente General',
      customerDoc: sale.customerDoc || null,
      customerIvaCond: sale.customerIvaCond || null,
      saleType: sale.saleType || 'internal',
      paymentMethod: sale.paymentMethod || 'cash',
      dispatchType: sale.dispatchType || 'pickup',
      paymentDetails,
      notes: sale.notes || null,
      items,
      subtotal: sale.rawSubtotal,
      discountLabel: (sale.discountVal || 0) > 0
        ? (sale.discountType === 'fixed' ? `$${sale.discountValue}` : `${sale.discountValue}%`)
        : null,
      discountAmount: sale.discountVal || 0,
      deliveryFee: sale.deliveryFee || 0,
      deliveryFeeFree: sale.deliveryFeeType === 'free' || !(sale.deliveryFee || 0),
      netAmount: sale.netAmount,
      ivaAmount: sale.ivaAmount,
      totalAmount: sale.totalAmount,
      sellerName: 'Caja',
    };
  };

  const buildTicketText = (sale: any) => buildSharedTicketText(toTicketData(sale));

  const handleWhatsAppSend = (phoneOverride?: string, mode: 'auto' | 'web' | 'universal' = 'auto') => {
    if (!successSale) return;
    const rawPhone = phoneOverride ?? customerPhone ?? successSale.customerPhone ?? '';
    const cleanPhone = normalizeArgPhone(rawPhone);

    if (!cleanPhone) {
      setWhatsappError('Ingresá el número de WhatsApp del cliente primero.');
      return;
    }
    if (!isValidPhone(cleanPhone)) {
      setWhatsappError(`El número "${rawPhone}" parece incompleto. En Argentina usá 549 + área + número (Ej: 5491123456789), sin 0, sin 15, sin +.`);
      return;
    }

    const biz = loadBusiness();
    const myPhone = normalizeArgPhone(biz.myWhatsapp);
    const copyPhone = copyToMe && isValidPhone(myPhone) ? myPhone : '';

    setWhatsappError('');
    const plainText = buildTicketText(successSale);
    const result = sendTicketWhatsApp({
      toPhone: cleanPhone,
      text: plainText,
      copyPhone,
      mode,
    });

    if (!result.customerOpened) {
      setWhatsappError('No se pudo abrir WhatsApp. Permití las ventanas emergentes o usá "Copiar texto".');
      return;
    }
    if (copyPhone && !result.copyOpened) {
      setWhatsappError('Se abrió el chat del cliente, pero la copia a tu WhatsApp fue bloqueada. Permití las ventanas emergentes.');
    }
  };

  /**
   * Ticket en PDF. En el móvil abre la hoja de compartir del sistema (ahí se
   * elige WhatsApp y el PDF viaja como documento). En escritorio, que no
   * soporta compartir archivos, lo descarga.
   */
  const handleSendPdf = async () => {
    if (!successSale) return;
    setPdfBusy(true);
    setWhatsappError('');
    try {
      const data = toTicketData(successSale);
      const file = ticketPdfFile(data);
      const outcome = await shareFile(file, {
        title: `Ticket ${data.receiptNumber || data.saleId.slice(0, 8).toUpperCase()}`,
        text: `Comprobante ${data.receiptNumber || ''} - ${data.customerName}`,
      });

      if (outcome === 'downloaded') {
        notify('PDF descargado. Abrí WhatsApp y adjuntá el archivo.', 'warning');
        // Además abre el chat para que sólo falte adjuntar.
        const cleanPhone = normalizeArgPhone(customerPhone || successSale.customerPhone || '');
        if (isValidPhone(cleanPhone)) {
          sendTicketWhatsApp({ toPhone: cleanPhone, text: buildTicketText(successSale) });
        }
      } else if (outcome === 'unsupported') {
        downloadTicketPdf(data);
        notify('PDF descargado.', 'success');
      }
    } catch (e: any) {
      notify(`No se pudo generar el PDF: ${e?.message || e}`, 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleCopyTicket = async () => {
    if (!successSale) return;
    try {
      await navigator.clipboard.writeText(buildTicketText(successSale));
      setCopiedOk(true);
      setTimeout(() => setCopiedOk(false), 2500);
    } catch {
      setWhatsappError('No se pudo copiar. Seleccioná el texto del ticket manualmente.');
    }
  };

  const paymentLabel = (m: string) =>
    m === 'cash' ? 'Efectivo' : m === 'transfer' ? 'Transferencia' : m === 'card' ? 'Tarjeta' : m === 'mercadopago' ? 'Mercado Pago' : m?.toUpperCase();
  const dispatchLabel = (d: string) => (d === 'delivery' ? 'Envío' : 'Retira');

  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || (p.barcode && p.barcode.includes(searchTerm));
    const prodCat = (p.category || 'General').trim();
    const matchesCategory = selectedCategory === 'all' || prodCat === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 pb-24 lg:pb-6">
      {localToast && !showToast && (
        <div className="lg:col-span-12 -mb-1">
          <div className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-lg animate-in fade-in-0 slide-in-from-top-2 duration-200">
            {localToast}
          </div>
        </div>
      )}
      {/* Products Column */}
      <div className="lg:col-span-7 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5">
              Caja / Ventas (POS)
              <ContextualTooltip tipKey="pos-shortcuts" title="Atajos y escáner">
                Escaneá con la cámara o un lector USB. <strong>F8</strong> lector físico, <strong>F9</strong> balanza, <strong>F12</strong> cobrar. Tocá el ícono para volver a ver esta ayuda.
              </ContextualTooltip>
            </h1>
            <p className="text-[13px] sm:text-sm text-slate-500 font-medium">Búsqueda rápida, cámara, balanza y categorías</p>
          </div>
          <div className="flex items-center gap-2">
            {parkedSales.length > 0 && (
              <button
                onClick={() => setParkedModalOpen(true)}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-extrabold flex items-center gap-1 shadow-sm transition cursor-pointer animate-bounce"
              >
                <Clock size={15} />
                <span>En Espera ({parkedSales.length})</span>
              </button>
            )}
            <div className="flex bg-slate-200/80 p-1 rounded-xl text-xs font-bold" role="group" aria-label="Tipo de precio">
              <button
                onClick={() => handlePriceTypeChange('wholesale')}
                aria-pressed={priceType === 'wholesale'}
                className={`px-3 sm:px-3.5 py-2 rounded-lg transition cursor-pointer whitespace-nowrap ${priceType === 'wholesale' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900 dark:text-slate-300'}`}
              >
                Mayorista
              </button>
              <button
                onClick={() => handlePriceTypeChange('retail')}
                aria-pressed={priceType === 'retail'}
                className={`px-3 sm:px-3.5 py-2 rounded-lg transition cursor-pointer whitespace-nowrap ${priceType === 'retail' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900 dark:text-slate-300'}`}
              >
                Minorista
              </button>
            </div>
          </div>
        </div>

        {/* Search, Camera Scanner & Category Dropdown */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div data-tour="pos-search" className="sm:col-span-6 bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center space-x-3">
            <Search className="text-slate-400" size={20} />
            <input
              type="text"
              placeholder="Buscar o escribir código de barras + Enter"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleBarcodeSearch}
              className="w-full focus:outline-none text-slate-900 text-sm font-medium"
            />
            <button
              onClick={() => setScannerOpen(true)}
              title="Escanear con cámara"
              className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl transition cursor-pointer"
            >
              <Camera size={20} />
            </button>
            <button
              onClick={() => setShowShortcuts(true)}
              title="Atajos de teclado (Ctrl+H)"
              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl transition cursor-pointer"
            >
              ⌨️
            </button>
          </div>
          <div data-tour="pos-categories" className="sm:col-span-6">
            <RoundedSelect
              value={selectedCategory}
              onChange={(v) => setSelectedCategory(v)}
              options={[{ value: 'all', label: 'Todas' }, ...CATEGORIES_LIST.map((cat) => ({ value: cat, label: cat }))]}
            />
          </div>
        </div>

        {/* Recientes */}
        {!searchTerm && selectedCategory === 'all' && recentIds.length > 0 && (
          <div>
            <p className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Clock size={13} /> Recientes
            </p>
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              {recentIds
                .map((id) => products.find((p) => p.id === id))
                .filter((p): p is Product => !!p)
                .map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleProductClick(p)}
                    title={p.name}
                    className="shrink-0 max-w-[160px] px-3 py-2 bg-white border border-slate-200/80 hover:border-emerald-500 rounded-xl text-left transition cursor-pointer shadow-sm dark:bg-obsidian-800/60 dark:border-obsidian-600/60"
                  >
                    <p className="text-xs font-bold text-slate-800 dark:text-white truncate">{p.name}</p>
                    <p className="text-[11px] font-extrabold text-emerald-600 tnum">
                      ${(priceType === 'wholesale' ? p.wholesale_price : p.retail_price).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </button>
                ))}
                </div>
              </div>
            )}
            {paymentMethod === 'mercadopago_point' && (
              <div className="p-3 bg-violet-50/70 dark:bg-violet-500/10 rounded-2xl border border-violet-200 dark:border-violet-500/30 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-extrabold text-violet-800 dark:text-violet-300 uppercase tracking-wide">Mercado Pago (Terminal Point)</p>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${mpMode === 'prod' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                    {mpMode === 'prod' ? '💰 Producción' : '🧪 Prueba'}
                  </span>
                </div>
                {mpWaiting ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300">
                      <Loader2 size={14} className="animate-spin shrink-0" />
                      <span className="text-xs font-bold">Esperando pago en la terminal… La venta se guarda solo si MP la aprueba.</span>
                    </div>
                    {mpOrderId && (
                      <p className="text-[10px] font-mono text-slate-500 truncate">Order: {mpOrderId}</p>
                    )}
                    <button
                      type="button"
                      onClick={abortMpPayment}
                      className="w-full px-3 py-2 bg-white border-2 border-rose-300 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-extrabold transition cursor-pointer"
                    >
                      Cancelar espera
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-violet-700 dark:text-violet-300 font-semibold">
                    Al apretar <b>COBRAR</b> se envía el cobro a la terminal Point. El cliente paga ahí y la venta queda <b>pendiente</b> hasta que MP la apruebe.
                  </p>
                )}
              </div>
            )}
            {paymentMethod === 'mercadopago' && (
              <div className="p-3 bg-blue-50/70 dark:bg-blue-500/10 rounded-2xl border border-blue-200 dark:border-blue-500/30 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-extrabold text-blue-800 dark:text-blue-300 uppercase tracking-wide">Mercado Pago (QR / Link de Pago)</p>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${mpMode === 'prod' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>
                    {mpMode === 'prod' ? '💰 Producción' : '🧪 Prueba'}
                  </span>
                </div>
                {mpWaiting ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300">
                      <Loader2 size={14} className="animate-spin shrink-0" />
                      <span className="text-xs font-bold">Esperando pago del cliente… La venta se guarda solo si MP la aprueba.</span>
                    </div>
                    <button
                      type="button"
                      onClick={abortMpPayment}
                      className="w-full px-3 py-2 bg-white border-2 border-rose-300 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-extrabold transition cursor-pointer"
                    >
                      Cancelar espera
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-blue-700 dark:text-blue-300 font-semibold">Al apretar <b>COBRAR</b> se genera el link y la venta queda <b>pendiente</b>. Se completa sola con el pago aprobado.</p>
                )}
                {mpLink && (
                  <div className="p-2 bg-white rounded-xl border border-sky-100 flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-slate-600 truncate">{mpLink}</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(mpLink);
                        if (showToast) showToast('Link copiado al portapapeles', 'success');
                      }}
                      className="px-2.5 py-1 bg-slate-900 text-white rounded-lg text-[11px] font-bold shrink-0 cursor-pointer"
                    >
                      Copiar
                    </button>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">N° autorización / operación MP (opcional)</label>
                  <input
                    type="text"
                    value={mpAuth}
                    onChange={(e) => setMpAuth(e.target.value.slice(0, 30))}
                    placeholder="Se completa solo con el pago"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 tnum"
                  />
                </div>
              </div>
            )}

        {/* Products Grid */}
        <div data-tour="pos-products" className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-h-[420px] sm:max-h-[540px] overflow-y-auto pr-1">
          {filteredProducts.length === 0 && (
            <div className="sm:col-span-2 flex flex-col items-center justify-center py-12 text-center bg-white rounded-2xl border border-dashed border-slate-300 dark:bg-obsidian-800/40 dark:border-obsidian-600">
              <Search size={28} className="text-slate-300 mb-2" />
              <p className="font-bold text-slate-700 dark:text-slate-200 text-sm">Sin resultados</p>
              <p className="text-xs text-slate-500 mt-1">
                {searchTerm ? `Nada coincide con "${searchTerm}"` : 'Probá otra categoría'}
              </p>
              {(searchTerm || selectedCategory !== 'all') && (
                <button
                  onClick={() => { setSearchTerm(''); setSelectedCategory('all'); }}
                  className="mt-3 px-4 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
          {filteredProducts.map((p) => {
            const price = priceType === 'wholesale' ? p.wholesale_price : p.retail_price;
            return (
              <div
                key={p.id}
                onClick={() => handleProductClick(p)}
                className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm border border-slate-200/80 hover:border-emerald-500 hover:shadow-md transition duration-200 flex flex-col justify-between cursor-pointer active:scale-[0.99] dark:bg-obsidian-800/60 dark:border-obsidian-600/60 dark:backdrop-blur-xl dark:hover:border-brand-500/50"
              >
                <div>
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider dark:bg-emerald-500/10 dark:text-emerald-400">
                      {p.category || 'General'}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${p.stock_quantity > 0 ? 'bg-slate-100 text-slate-700' : 'bg-red-100 text-red-700'}`}>
                      Stock: {p.stock_quantity} {p.unit_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 mt-2">
                    {p.image_url && (
                      <img src={p.image_url} alt={p.name} loading="lazy" className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0" />
                    )}
                    <h3 className="font-bold text-slate-900 text-sm">{p.name}</h3>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 font-semibold uppercase">
                      {p.unit_type === 'kg' ? '⚖️ Precio x Kilo' : 'Precio Unitario'}
                    </span>
                    <span className="text-lg sm:text-xl font-extrabold text-emerald-600 block tnum">${price.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  {p.unit_type === 'kg' ? (
                    <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold flex items-center gap-1 shadow-xs dark:bg-emerald-500/10 dark:text-emerald-400">
                      <Scale size={14} /> Pesar
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); addToCart(p, 1); }}
                      className="px-3.5 py-2 bg-accent-emerald hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm transition cursor-pointer"
                    >
                      <Plus size={16} /> Agregar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart & Checkout Column */}
      <div data-tour="pos-cart" className="lg:col-span-5 bg-white p-4 sm:p-6 rounded-3xl shadow-xl border-2 border-slate-200/80 flex flex-col justify-between dark:bg-obsidian-800/60 dark:border-obsidian-600/60 dark:backdrop-blur-xl">
        <div className="space-y-4">
          <div className="flex justify-between items-center border-b pb-3">
            <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <ShoppingCart size={22} className="text-emerald-600" />
              <span>Carrito de Venta</span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={openRecentModal}
                title="Últimos tickets (reimprimir / anular)"
                className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition cursor-pointer"
              >
                <Receipt size={16} />
              </button>
              {cart.length > 0 && (
                <button
                  onClick={handleParkSale}
                  title="Poner en espera"
                  className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl transition cursor-pointer"
                >
                  <Pause size={16} />
                </button>
              )}
              <span className="text-xs bg-slate-100 text-slate-800 px-3 py-1 rounded-full font-bold tnum">
                {cart.length} líneas · {cart.reduce((a, i) => a + Number(i.quantity), 0).toLocaleString('es-AR')} un
              </span>
            </div>
          </div>

          {/* Customer & Sale Options */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">Cliente / Distribuidor</label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => { setCustomerName(e.target.value); setCustDropdown(true); }}
                  onFocus={() => setCustDropdown(true)}
                  onBlur={() => setTimeout(() => setCustDropdown(false), 150)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                  placeholder="Cliente General"
                />
                {custDropdown && customerName.trim().length >= 2 && (() => {
                  const q = customerName.trim().toLowerCase();
                  const matches = customers.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
                  if (matches.length === 0) return null;
                  return (
                    <div className="absolute z-30 mt-1 w-full bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 space-y-0.5 max-h-48 overflow-y-auto">
                      {matches.map((c) => (
                        <button
                          key={c.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCustomerName(c.name);
                            if (c.phone) setCustomerPhone(c.phone);
                            if (c.doc_number) setCustomerDoc(c.doc_number.replace(/\D/g, ''));
                            setCustDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-emerald-50 transition cursor-pointer"
                        >
                          <p className="text-sm font-bold text-slate-800">{c.name}</p>
                          {(c.phone || c.doc_number) && (
                            <p className="text-[11px] text-slate-500">{[c.phone, c.doc_number].filter(Boolean).join(' · ')}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">WhatsApp Cliente</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
                  placeholder="5491123456789"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500 font-medium">WhatsApp: código país + área sin 0, sin 15, sin +. Ej AR: 5491123456789.</p>
            {saleType === 'afip' && (
              <div className="grid grid-cols-2 gap-2 p-3 bg-blue-50/60 dark:bg-blue-500/10 rounded-2xl border border-blue-200 dark:border-blue-500/30">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">CUIT / DNI (RI)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={customerDoc}
                    onChange={(e) => setCustomerDoc(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 tnum"
                    placeholder="20123456789"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Cond. IVA cliente</label>
                  <RoundedSelect size="sm" value={customerIvaCond} onChange={(v) => setCustomerIvaCond(v as any)} options={IVA_COND_LABELS.map((o) => ({ value: o.value, label: o.label }))} />
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Comprobante</label>
                <RoundedSelect size="sm" value={saleType} onChange={(v) => setSaleType(v as 'internal' | 'afip')} options={[{ value: 'internal', label: 'Interno' }, { value: 'afip', label: 'ARCA' }]} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Pago</label>
                <RoundedSelect size="sm" value={paymentMethod} onChange={(v) => setPaymentMethod(v as any)} options={[{ value: 'cash', label: 'Efectivo 💵' }, { value: 'transfer', label: 'Transf. 🏦' }, { value: 'card', label: 'Tarjeta 💳' }, { value: 'mercadopago', label: 'Mercado Pago 🔗' }, { value: 'mercadopago_point', label: 'MP Terminal 📟' }]} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Despacho</label>
                <RoundedSelect size="sm" value={dispatchType} onChange={(v) => setDispatchType(v as 'pickup' | 'delivery')} options={[{ value: 'pickup', label: 'Retira 🏬' }, { value: 'delivery', label: 'Envío 🚚' }]} />
              </div>
            </div>
            {paymentMethod === 'transfer' && (
              <div className="p-3 bg-sky-50/70 dark:bg-sky-500/10 rounded-2xl border border-sky-200 dark:border-sky-500/30 space-y-2">
                <p className="text-[10px] font-extrabold text-sky-800 dark:text-sky-300 uppercase tracking-wide">Datos de la transferencia</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Banco origen</label>
                    <RoundedSelect size="sm" value={transferBank} onChange={(v) => setTransferBank(v)} options={[{ value: '', label: 'Seleccionar...' }, ...BANKS_AR.map((b) => ({ value: b, label: b }))]} flip={false} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Cuenta destino (alias)</label>
                    <RoundedSelect
                      size="sm"
                      value={transferAccount}
                      onChange={(v) => {
                        setTransferAccount(v);
                        if (v !== 'Otro') setTransferAccountOther('');
                      }}
                      options={[
                        { value: '', label: 'Seleccionar...' },
                        ...[...new Set([...transferAccountOptions.filter((a) => a !== 'Otro'), ...(transferAccount && transferAccount !== 'Otro' && !transferAccountOptions.includes(transferAccount) ? [transferAccount] : [])])].map((a) => ({ value: a, label: a })),
                        { value: 'Otro', label: '➕ Agregar nuevo alias...' },
                      ]}
                    />
                  </div>
                  {transferAccount === 'Otro' && (
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Nuevo alias (cuenta destino)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={transferAccountOther}
                          onChange={(e) => setTransferAccountOther(e.target.value)}
                          onBlur={() => { if (transferAccountOther.trim()) registerTransferAccount(transferAccountOther); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (transferAccountOther.trim()) registerTransferAccount(transferAccountOther); } }}
                          placeholder="Ej: VISHAL.MP"
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900"
                        />
                      </div>
                      <p className="text-[9px] text-slate-500 mt-1">Se guarda en el catálogo al salir del campo (Enter).</p>
                    </div>
                  )}
                </div>
                {transferBank === 'Otro' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">¿Cuál banco?</label>
                    <input
                      type="text"
                      value={transferBankOther}
                      onChange={(e) => setTransferBankOther(e.target.value)}
                      placeholder="Nombre del banco"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">N° comprobante / referencia</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={transferRef}
                    onChange={(e) => setTransferRef(e.target.value.replace(/\D/g, '').slice(0, 20))}
                    placeholder="Ej: 0123456789"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900 tnum"
                  />
                </div>
              </div>
            )}
            {paymentMethod === 'card' && (
              <div className="p-3 bg-violet-50/70 dark:bg-violet-500/10 rounded-2xl border border-violet-200 dark:border-violet-500/30 space-y-2">
                <p className="text-[10px] font-extrabold text-violet-800 dark:text-violet-300 uppercase tracking-wide">Datos de la tarjeta</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Tipo</label>
                    <RoundedSelect size="sm" value={cardType} onChange={(v) => setCardType(v as 'debit' | 'credit')} options={[{ value: 'debit', label: 'Débito' }, { value: 'credit', label: 'Crédito' }]} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Tarjeta</label>
                    <RoundedSelect size="sm" value={cardBrand} onChange={(v) => setCardBrand(v)} options={[{ value: '', label: 'Seleccionar...' }, ...cardBrandOptions.map((b) => ({ value: b, label: b }))]} />
                  </div>
                </div>
                {cardBrand === 'Otra' && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">¿Cuál tarjeta?</label>
                    <input
                      type="text"
                      value={cardBrandOther}
                      onChange={(e) => setCardBrandOther(e.target.value.slice(0, 30))}
                      placeholder="Ej: Ualá, Nativa..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900"
                    />
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Últimos 4</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cardLast4}
                      onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="1234"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 tnum"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Autorización</label>
                    <input
                      type="text"
                      value={cardAuth}
                      onChange={(e) => setCardAuth(e.target.value.slice(0, 20))}
                      placeholder="N° cupón"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Cuotas</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cardInstallments}
                      onChange={(e) => setCardInstallments(e.target.value.replace(/\D/g, '').slice(0, 2))}
                      disabled={cardType !== 'credit'}
                      placeholder="1"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-900 tnum disabled:opacity-40"
                    />
                  </div>
                </div>
              </div>
            )}
            {dispatchType === 'delivery' && (
              <div className="p-3 bg-orange-50 dark:bg-orange-500/10 rounded-2xl border border-orange-200 dark:border-orange-500/30 flex items-center justify-between gap-2 text-xs font-bold text-slate-700">
                <span className="whitespace-nowrap">🚚 Costo envío:</span>
                <div className="min-w-[150px] flex-1">
                  <RoundedSelect size="sm" value={deliveryFeeType} onChange={(v) => setDeliveryFeeType(v as 'free' | 'fixed' | 'percent')} options={[{ value: 'free', label: 'Bonificado 🎉' }, { value: 'fixed', label: 'Monto $' }, { value: 'percent', label: 'Porcentaje %' }]} />
                </div>
                {deliveryFeeType !== 'free' && (
                  <input
                    type="number"
                    value={deliveryFeeValue}
                    onChange={(e) => setDeliveryFeeValue(e.target.value)}
                    placeholder={deliveryFeeType === 'fixed' ? 'Ej: 1500' : 'Ej: 10'}
                    min="0"
                    className="w-20 px-2 py-1.5 border rounded-xl text-right font-bold bg-white"
                  />
                )}
                <span className="text-orange-700 dark:text-orange-400 font-extrabold">
                  {deliveryFeeType === 'free' ? '$0,00' : `+$${deliveryFee.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </span>
              </div>
            )}
            {/* Notas de venta */}
            <div>
              <label className="block text-[10px] font-bold text-slate-700 uppercase tracking-wide mb-1">Notas (opcional)</label>
              <input
                type="text"
                value={saleNotes}
                onChange={(e) => setSaleNotes(e.target.value)}
                placeholder="Ej: Entregar antes de las 18h, factura A..."
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900"
              />
            </div>
          </div>

          {/* Cart Items List */}
          <div className="max-h-48 sm:max-h-[540px] overflow-y-auto space-y-2.5 pr-1 divide-y divide-slate-100">
            {cart.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm font-medium">El carrito está vacío. Agregá productos.</p>
            ) : (
              <>
                <div className="flex justify-between items-center mb-2 gap-2">
                  {lastRemoved ? (
                    <button
                      onClick={undoRemove}
                      className="text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-xl transition cursor-pointer"
                    >
                      ↩ Deshacer ({lastRemoved.label})
                    </button>
                  ) : <span />}
                  <button
                    onClick={handleClearCart}
                    className="text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-xl transition cursor-pointer"
                  >
                    🗑️ Vaciar carrito
                  </button>
                </div>
                {cart.map((item) => {
                  const unitPrice = item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price;
                  const discountMultiplier = 1 - (item.discount || 0) / 100;
                  const subtotal = unitPrice * item.quantity * discountMultiplier;
                  const stockWarning = item.quantity > item.product.stock_quantity;
                  const atMaxStock = item.quantity >= item.product.stock_quantity;
                  const isKg = item.product.unit_type === 'kg';
                  const step = isKg ? 0.25 : 1;
                  return (
                    <div key={item.product.id} className="pt-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          {item.product.image_url && (
                            <img src={item.product.image_url} alt={item.product.name} className="w-10 h-10 rounded-lg object-cover bg-slate-100 flex-shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-slate-900 truncate text-sm">{item.product.name}</p>
                              <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold flex-shrink-0 ${item.priceType === 'wholesale' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                {item.priceType === 'wholesale' ? 'MAY' : 'MIN'}
                              </span>
                              {item.product.category && (
                                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-md text-[9px] font-bold flex-shrink-0">{item.product.category}</span>
                              )}
                            </div>
                            <p className="text-[10px] font-semibold text-slate-500 mt-0.5 tnum">
                              {item.quantity} × ${unitPrice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{item.product.unit_type === 'kg' ? '/kg' : ''}
                              {(item.discount || 0) > 0 && <span className="text-amber-600 font-bold"> · -{item.discount}%</span>}
                            </p>
                            {item.product.barcode && (
                              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{item.product.barcode}</p>
                            )}
                            {stockWarning && (
                              <p className="text-[10px] font-bold text-red-600 flex items-center gap-0.5 mt-0.5">
                                <AlertTriangle size={10} /> Stock insuficiente ({item.product.stock_quantity} disp.)
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <span className="font-extrabold text-emerald-600 text-sm tnum">${subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          {/* Discount per item */}
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={item.discount || 0}
                              onChange={(e) => {
                                const val = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                                setCart((prev) =>
                                  prev.map((ci) =>
                                    ci.product.id === item.product.id ? { ...ci, discount: Math.min(100, Math.max(0, val)) } : ci
                                  )
                                );
                              }}
                              className="w-12 px-1 py-0.5 border border-slate-300 rounded-lg text-center text-[10px] font-bold text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                              placeholder="0%"
                            />
                            <span className="text-[9px] text-slate-400">%</span>
                          </div>
                          {/* Quantity controls */}
                          <div className="flex items-center bg-slate-100 rounded-xl p-0.5 gap-0.5">
                            <button
                              onClick={() => updateQuantity(item.product.id, -10)}
                              className="px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-white rounded-md transition cursor-pointer"
                            >
                              −10
                            </button>
                            <button
                              onClick={() => updateQuantity(item.product.id, isKg ? -0.25 : -1)}
                              className="p-1 text-slate-700 hover:bg-white rounded-lg transition cursor-pointer"
                            >
                              <Minus size={12} />
                            </button>
                            <input
                              type="number"
                              value={item.quantity}
                              max={atMaxStock ? item.quantity : undefined}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (isNaN(val) || val <= 0) {
                                  removeItem(item.product.id);
                                  return;
                                }
                                // No permitir superar el stock disponible: el cobro tampoco lo aceptaría.
                                const available = cartSvc.stockOf(item.product);
                                if (Number.isFinite(available) && val > available) {
                                  const clamped = cartSvc.setQuantity(cart, item.product.id, available);
                                  if (clamped) setCart(clamped);
                                  notify(`Stock insuficiente: ${item.product.name} (disponible ${available})`, 'warning');
                                  return;
                                }
                                const next = cartSvc.setQuantity(cart, item.product.id, val);
                                if (next) setCart(next);
                              }}
                              className="w-14 px-1 py-0.5 border border-slate-300 rounded-lg text-center text-xs font-extrabold text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                              min="0.01"
                              step={step}
                            />
                            <button
                              onClick={() => updateQuantity(item.product.id, isKg ? 0.25 : 1)}
                              disabled={atMaxStock}
                              className="p-1 text-slate-700 hover:bg-white rounded-lg transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Plus size={12} />
                            </button>
                            <button
                              onClick={() => updateQuantity(item.product.id, 10)}
                              className="px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-white rounded-md transition cursor-pointer"
                            >
                              +10
                            </button>
                            <button
                              onClick={() => removeItem(item.product.id)}
                              className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Totals & Checkout - fijo abajo en móvil (encima de la tab bar + safe area) */}
        <div data-tour="pos-totals" className="border-t pt-3 sm:pt-4 space-y-3 mt-4 sticky bottom-[calc(84px_+_env(safe-area-inset-bottom))] z-10 bg-white/95 backdrop-blur rounded-2xl shadow-[0_-6px_20px_rgba(0,0,0,0.10)] border border-emerald-100 p-3 lg:bottom-2 lg:static lg:z-auto lg:shadow-none lg:border-0 lg:rounded-none lg:p-0 lg:bg-transparent lg:backdrop-blur-0">
          <div className="text-xs font-bold text-slate-600 space-y-1 bg-slate-50 p-2.5 rounded-2xl border">
            <div className="flex justify-between"><span>Subtotal:</span><span>${rawSubtotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
            {discountVal > 0 && <div className="flex justify-between text-red-600"><span>Descuento {discountType === 'percent' ? `(${discountValue}%)` : `($)`}:</span><span>-${discountVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
            {dispatchType === 'delivery' && <div className="flex justify-between text-orange-700"><span>Envío 🚚 {deliveryFeeType === 'free' ? '(Bonificado)' : ''}:</span><span>{deliveryFee === 0 ? '$0,00' : `+$${deliveryFee.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span></div>}
            {(() => {
              const itemSavings = cart.reduce((a, i) => {
                const up = i.priceType === 'wholesale' ? i.product.wholesale_price : i.product.retail_price;
                return a + up * Number(i.quantity) * ((i.discount || 0) / 100);
              }, 0);
              const totalSaved = itemSavings + discountVal;
              return totalSaved > 0 ? (
                <div className="flex justify-between text-emerald-700">
                  <span>🎉 El cliente ahorra:</span>
                  <span>${totalSaved.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ) : null;
            })()}
          </div>
          {/* Discount input - percent or fixed amount */}
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 bg-slate-50 p-2.5 rounded-2xl border gap-2 overflow-hidden">
            <span className="whitespace-nowrap shrink-0">Descuento:</span>
            <div className="min-w-0 flex-1">
              <RoundedSelect size="sm" value={discountType} onChange={(v) => setDiscountType(v as 'percent' | 'fixed')} options={[{ value: 'percent', label: '% Porcentaje' }, { value: 'fixed', label: '$ Monto' }]} />
            </div>
            <input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder={discountType === 'percent' ? 'Ej: 10' : 'Ej: 500'}
              className="w-20 shrink-0 px-2 py-1 border rounded-xl text-right font-bold bg-white"
              min="0"
              max={discountType === 'percent' ? '100' : undefined}
            />
          </div>

          {paymentMethod === 'cash' && cart.length > 0 && (
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-xs font-bold text-slate-700 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span>Paga con: $</span>
                <input
                  type="number"
                  value={cashGiven}
                  onChange={(e) => setCashGiven(e.target.value)}
                  placeholder={totalAmount.toString()}
                  className="w-28 px-2.5 py-1 border border-slate-300 rounded-xl text-right font-extrabold text-slate-900 bg-white"
                />
                <span className="text-emerald-700 whitespace-nowrap">Vuelto: ${changeDue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCashGiven(Math.ceil(totalAmount).toString())}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition cursor-pointer"
                  title="Monto exacto (sin vuelto)"
                >
                  Exacto
                </button>
                {[1000, 2000, 5000, 10000, 20000, 50000]
                  .filter((b) => b >= Math.ceil(totalAmount))
                  .slice(0, 4)
                  .map((b) => (
                    <button
                      key={b}
                      onClick={() => setCashGiven(b.toString())}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg font-bold text-slate-700 transition cursor-pointer tnum"
                    >
                      ${b.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </button>
                  ))}
              </div>
            </div>
          )}

           <div className="flex justify-between items-center text-base sm:text-lg font-black text-slate-900">
            <span>TOTAL A COBRAR:</span>
            <span className="text-2xl sm:text-3xl text-emerald-600 font-black tnum">${totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          <button
            onClick={handleParkSale}
            disabled={cart.length === 0}
            className="w-full py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 font-extrabold rounded-2xl transition duration-200 disabled:opacity-40 text-sm flex items-center justify-center gap-2 cursor-pointer mb-2"
          >
            <Clock size={18} />
            <span>Guardar pedido (sin cobrar)</span>
          </button>

          <button
            onClick={handleCompleteSale}
            disabled={cart.length === 0 || loading}
            className="w-full py-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-obsidian-900 font-extrabold rounded-2xl shadow-glow-emerald transition duration-200 disabled:opacity-40 text-base flex items-center justify-between px-5 cursor-pointer group"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-obsidian-900" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="mx-auto">Procesando Cobro...</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  <Check size={20} />
                  <span>COBRAR</span>
                  <span className="hidden sm:inline tnum">${totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </span>
                <span className="hidden sm:flex items-center gap-2">
                  <span className="text-xs font-bold bg-white/20 px-2 py-1 rounded-lg backdrop-blur-sm">F12</span>
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Resumen flotante del carrito (solo desktop: en móvil lo cubre la tab bar) */}
      {cart.length > 0 && (
        <div className="hidden lg:flex bottom-4 fixed left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl items-center gap-4 text-sm font-bold">
          <span>{cart.reduce((a, i) => a + i.quantity, 0)} prod.</span>
          <span className="text-emerald-400 tnum">${totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <button onClick={handleParkSale} disabled={cart.length === 0} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 rounded-xl text-xs font-extrabold cursor-pointer transition">
            Guardar
          </button>
          <button onClick={handleCompleteSale} disabled={loading} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-xs font-extrabold cursor-pointer transition">
            Cobrar
          </button>
        </div>
      )}

      {/* MODALS */}
      {scannerOpen && (
        <ScannerModal
          title="Escanear producto"
          immediate
          onClose={() => { setScannerOpen(false); scannerApi.resetStatus(); }}
          onUseProduct={(_product, code) => {
            lastScannedCodeRef.current = code;
            handleBarcodeScanned(code);
            setScannerOpen(false);
            scannerApi.resetStatus();
          }}
        />
      )}

      <ScaleModal
        isOpen={scaleModalOpen}
        product={activeKgProduct}
        priceType={priceType}
        onClose={() => {
          setScaleModalOpen(false);
          setActiveKgProduct(null);
        }}
        onConfirm={(prod, kg) => {
          addToCart(prod, kg);
        }}
      />

      {/* PARKED SALES MODAL */}
      {parkedModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-slate-900">Ventas en Espera (Multiticket)</h2>
              <button onClick={() => setParkedModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {parkedSales.map((p) => (
                <div key={p.id} className="p-3.5 bg-slate-50 rounded-2xl border flex justify-between items-center">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{p.customerName}</p>
                    <p className="text-xs text-slate-500">{p.cart.length} ítems • {p.date}</p>
                  </div>
                  <button
                    onClick={() => handleResumeParkedSale(p)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
                  >
                    Recuperar
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button onClick={() => setParkedModalOpen(false)} className="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {recentModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Receipt size={20} className="text-slate-500" /> Últimos tickets
              </h2>
              <button onClick={() => setRecentModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={22} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-2">
              {recentLoading ? (
                <p className="text-center text-slate-400 text-sm py-6">Cargando...</p>
              ) : recentSales.length === 0 ? (
                <p className="text-center text-slate-400 text-sm py-6">Sin ventas registradas.</p>
              ) : (
                recentSales.map((s) => (
                  <div key={s.id} className={`p-3.5 rounded-2xl border flex justify-between items-center gap-2 ${s.status === 'cancelled' ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">
                        {s.customer_name || 'Cliente General'}
                        {s.status === 'cancelled' && <span className="ml-2 text-[10px] font-extrabold uppercase text-red-600">Anulada</span>}
                      </p>
                      <p className="text-xs text-slate-500 tnum">
                        {new Date(s.created_at).toLocaleString('es-AR')} · <strong className="text-emerald-700">${Number(s.total_amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleReprintSale(s)}
                        title="Reimprimir ticket"
                        className="p-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl transition cursor-pointer"
                      >
                        <Printer size={15} />
                      </button>
                      {s.status !== 'cancelled' && canAnnulSales(profile?.role) && (
                        <button
                          onClick={() => handleAnnulSale(s)}
                          title="Anular venta"
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-xl transition cursor-pointer"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button onClick={() => setRecentModalOpen(false)} className="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold cursor-pointer">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUCCESS TICKET & WHATSAPP / PRINT MODAL - estilo moderno */}
      {successSale && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setSuccessSale(null)}>
          <div
            className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header moderno - muestra Plus Jakarta Sans 800 + Phosphor fill */}
            <div className="bg-gradient-to-r from-emerald-700 to-emerald-500 px-6 py-5 text-center relative shrink-0" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <button
                onClick={() => setSuccessSale(null)}
                className="no-print absolute right-4 top-4 p-1.5 bg-white/20 hover:bg-white/30 text-white rounded-full transition cursor-pointer"
              >
                <XPh size={18} weight="bold" />
              </button>
              <div className="inline-flex p-2 bg-white rounded-full shadow-lg mb-2">
                <CheckCircle size={34} weight="fill" className="text-emerald-600" />
              </div>
              <h2 className="text-[22px] font-extrabold text-white tracking-tight leading-none">¡Cobro Exitoso!</h2>
              <p className="text-[13px] text-emerald-50 font-bold mt-1.5 tnum">{successSale.receiptNumber ? `Comprobante N° ${successSale.receiptNumber}` : `Ticket #${successSale.id.slice(0, 8).toUpperCase()}`}</p>
            </div>

            <div className="overflow-y-auto p-5 space-y-4">
              {/* Ticket estilo papel 320px */}
              <div id="ticket-print-area" className="bg-white rounded-xl shadow-lg overflow-hidden relative mx-auto" style={{ fontFamily: "'Inter', sans-serif", maxWidth: '320px' }}>
                {/* Cabecera */}
                <div className="text-center py-5 px-4">
                  <div className="w-14 h-14 bg-[#22c55e] rounded-2xl flex items-center justify-center shadow-sm mx-auto mb-3">
                    <img src="/logo-512.jpg" alt="Vishal" className="w-12 h-12 object-contain rounded-xl" />
                  </div>
                  <h1 className="text-[17px] font-bold tracking-[0.15em] text-gray-900 leading-none">DIETÉTICA VISHAL</h1>
                  <p className="text-[10px] font-medium tracking-[0.3em] text-gray-500 mt-1 uppercase">Ticket</p>
                </div>

                <div className="border-t border-dashed border-gray-300 mx-4"></div>

                {/* Datos */}
                <div className="px-4 py-3 space-y-1.5 text-[13px]">
                  <div className="flex justify-between"><span className="text-gray-500">TICKET:</span><span className="text-gray-900 font-medium">{successSale.receiptNumber || `#${successSale.id.slice(0, 8).toUpperCase()}`}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">FECHA:</span><span className="text-gray-900">{successSale.date}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">CLIENTE:</span><span className="text-gray-900">{successSale.customerName}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">VENDEDOR:</span><span className="text-gray-900">Caja</span></div>
                </div>

                <div className="border-t border-dashed border-gray-300 mx-4"></div>

                {/* Productos */}
                <div className="px-4 py-3 space-y-3">
                  {successSale.cart.map((item: CartItem, idx: number) => {
                    const uPrice = item.priceType === 'wholesale' ? item.product.wholesale_price : item.product.retail_price;
                    const isKg = item.product.unit_type === 'kg';
                    return (
                      <div key={idx}>
                        <div className="flex justify-between items-start">
                          <span className="text-gray-800 text-[14px] leading-snug">{item.product.name}</span>
                          <span className="text-gray-900 font-medium text-[14px] tnum">${(item.quantity * uPrice).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <p className="text-gray-500 text-[11px] mt-0.5 tnum">
                          {isKg ? `${item.quantity} kg` : `x${item.quantity}`} • {uPrice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-dashed border-gray-300 mx-4"></div>

                {/* Total */}
                <div className="px-4 py-3 flex justify-between items-center">
                  <span className="text-[15px] font-bold text-gray-900 uppercase">Total:</span>
                  <span className="text-xl font-bold text-gray-900 tnum">${successSale.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                <div className="border-t border-dashed border-gray-300 mx-4"></div>

                {/* Pago y despacho */}
                <div className="px-4 py-3 text-center text-[13px] text-gray-700">
                  Pago: {paymentLabel(successSale.paymentMethod)} • {dispatchLabel(successSale.dispatchType)}
                </div>

                <div className="border-t border-dashed border-gray-300 mx-4"></div>

                {/* Cierre */}
                <div className="text-center py-4 px-4">
                  <p className="text-[13px] font-medium text-gray-800 uppercase mb-1">¡Gracias por su compra!</p>
                  <p className="text-[11px] text-gray-500 tracking-[0.2em] font-mono">*{successSale.receiptNumber || successSale.id.slice(0, 8).toUpperCase()}*</p>
                </div>

                {/* Borde zig-zag inferior */}
                <div className="h-2 bg-white" style={{ maskImage: 'radial-gradient(circle at 4px 4px, transparent 4px, black 4.5px)', maskSize: '8px 8px', maskPosition: '-4px 100%', WebkitMaskImage: 'radial-gradient(circle at 4px 4px, transparent 4px, black 4.5px)', WebkitMaskSize: '8px 8px', WebkitMaskPosition: '-4px 100%' } as React.CSSProperties}></div>
              </div>

              {/* WhatsApp muestra Phosphor */}
              <div className="no-print p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                <p className="text-[13px] font-bold text-slate-900 flex items-center gap-1.5"><WhatsappLogo size={17} weight="fill" className="text-emerald-600" /> Enviar comprobante por WhatsApp</p>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => { setCustomerPhone(e.target.value); setWhatsappError(''); setCopiedOk(false); }}
                    placeholder="5491123456789"
                    className={`flex-1 px-3 py-2.5 border-2 rounded-xl text-[14px] font-semibold bg-white text-slate-900 focus:outline-none transition tnum ${customerPhone === '' ? 'border-slate-300 focus:border-emerald-500' : isValidPhone(customerPhone) ? 'border-emerald-500 focus:border-emerald-600' : 'border-red-300 focus:border-red-500'}`}
                  />
                  <button
                    onClick={() => handleWhatsAppSend()}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[13px] font-bold flex items-center gap-1.5 cursor-pointer shadow-md transition whitespace-nowrap"
                  >
                    <WhatsappLogo size={17} weight="bold" /> Enviar
                  </button>
                </div>

                {/* Enviar el ticket en PDF (documento) por WhatsApp */}
                <button
                  onClick={handleSendPdf}
                  disabled={pdfBusy}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  {pdfBusy ? <Loader2 size={15} className="animate-spin" /> : <FilePdfPh size={15} weight="bold" />}
                  {pdfBusy ? 'Generando PDF…' : 'Enviar ticket en PDF'}
                </button>

                {/* Copia para el dueño del negocio */}
                <label className={`flex items-start gap-2 ${myWhatsapp ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
                  <input
                    type="checkbox"
                    checked={copyToMe && !!myWhatsapp}
                    disabled={!myWhatsapp}
                    onChange={(e) => { setCopyToMe(e.target.checked); saveCopyToMe(e.target.checked); }}
                    className="mt-0.5 w-4 h-4 accent-emerald-600 shrink-0"
                  />
                  <span className="text-[12px] font-semibold text-slate-700 leading-snug">
                    Recibir una copia en mi WhatsApp
                    {myWhatsapp
                      ? <span className="font-mono text-slate-500"> ({formatPhoneForDisplay(myWhatsapp)})</span>
                      : <span className="text-amber-600"> — configurá tu número en Configuración</span>}
                  </span>
                </label>

                {/* Número destino real (normalizado) */}
                {customerPhone.trim() && isValidPhone(customerPhone) && (
                  <p className="text-[12px] font-semibold text-slate-600">
                    Se va a enviar a <span className="font-mono font-bold text-emerald-700">{formatPhoneForDisplay(customerPhone)}</span>
                  </p>
                )}

                {!isMobileDevice() && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      onClick={() => handleWhatsAppSend(undefined, 'universal')}
                      className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer text-left flex items-center gap-1"
                    >
                      <DesktopPh size={12} /> ¿Tenés WhatsApp Desktop? Abrir la app
                    </button>
                    <button
                      onClick={openWhatsAppWebLogin}
                      className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer text-left flex items-center gap-1"
                    >
                      <SignInPh size={12} /> Iniciar sesión en WhatsApp Web
                    </button>
                  </div>
                )}

                {whatsappError
                  ? <p className="text-[12px] font-semibold text-red-600">{whatsappError}</p>
                  : (
                    <p className="text-[12px] text-slate-500 font-medium">
                      {isMobileDevice()
                        ? 'Formato: 549 + área + número, sin 0, sin 15, sin +. Se abre WhatsApp y vos confirmás.'
                        : 'En la PC se abre WhatsApp Web: la primera vez tenés que iniciar sesión (web.whatsapp.com). Podés pegar el ticket con "Copiar texto".'}
                    </p>
                  )}
                <button
                  onClick={handleCopyTicket}
                  className="w-full py-2.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <CopyPh size={15} weight="bold" /> {copiedOk ? '¡Copiado! Pegalo en WhatsApp' : 'Copiar texto para pegar manual'}
                </button>
                <p className="text-[11px] font-semibold text-slate-400 text-center">
                  Podés mandarlo por WhatsApp, imprimirlo, o hacer las dos cosas.
                </p>
              </div>
            </div>

            {/* Footer moderno - muestra Phosphor */}
            <div className="no-print flex gap-3 p-4 border-t bg-white shrink-0" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <button
                onClick={() => window.print()}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <PrinterPh size={17} weight="bold" /> Imprimir
              </button>
              <button
                onClick={() => { setSuccessSale(null); setWhatsappError(''); setCopiedOk(false); }}
                className="flex-[2] py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-[14px] font-extrabold shadow cursor-pointer transition"
              >
                Nueva Venta →
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Keyboard Shortcuts Overlay */}
      {showShortcuts && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowShortcuts(false)}>
          <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white mb-4">⌨️ Atajos de Teclado</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between items-center p-2 rounded-xl bg-slate-50 dark:bg-[#232323]">
                <span className="text-slate-600 dark:text-slate-300">Buscar por código de barras</span>
                <kbd className="px-2 py-0.5 bg-white dark:bg-[#2A2A2A] rounded border text-xs font-bold">Enter</kbd>
              </div>
              <div className="flex justify-between items-center p-2 rounded-xl bg-slate-50 dark:bg-[#232323]">
                <span className="text-slate-600 dark:text-slate-300">Cerrar modal de éxito</span>
                <kbd className="px-2 py-0.5 bg-white dark:bg-[#2A2A2A] rounded border text-xs font-bold">Esc</kbd>
              </div>
              <div className="flex justify-between items-center p-2 rounded-xl bg-slate-50 dark:bg-[#232323]">
                <span className="text-slate-600 dark:text-slate-300">Mostrar/ocultar esta ayuda</span>
                <kbd className="px-2 py-0.5 bg-white dark:bg-[#2A2A2A] rounded border text-xs font-bold">Ctrl+H</kbd>
              </div>
              <div className="flex justify-between items-center p-2 rounded-xl bg-slate-50 dark:bg-[#232323]">
                <span className="text-slate-600 dark:text-slate-300">Poner en espera carrito</span>
                <kbd className="px-2 py-0.5 bg-white dark:bg-[#2A2A2A] rounded border text-xs font-bold">P</kbd>
              </div>
              <div className="flex justify-between items-center p-2 rounded-xl bg-slate-50 dark:bg-[#232323]">
                <span className="text-slate-600 dark:text-slate-300">Cobrar la venta</span>
                <kbd className="px-2 py-0.5 bg-white dark:bg-[#2A2A2A] rounded border text-xs font-bold">F12</kbd>
              </div>
            </div>
            <button onClick={() => setShowShortcuts(false)} className="w-full mt-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold cursor-pointer">Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
