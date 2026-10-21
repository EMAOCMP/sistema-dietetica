import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../types';
import { loadBusiness, saveBusiness, type BusinessSettings } from '../../lib/businessSettings';
import { loadMercadoPagoSettings, saveMercadoPagoSettings, checkMpFunction, type MercadoPagoSettings } from '../../lib/mercadoPagoService';
import { downloadCsv, stampName } from '../../lib/exportCsv';
import { getIvaRate } from '../../lib/tax';
import { loadMetaSchedule, saveMetaSchedule, isValidTime, hoursOf } from '../../lib/metaSchedule';
import { SelectMenu } from '../ui/SelectMenu';
import { Shield, Save, Loader2, Plus, Trash2, MapPin, Store, Percent, ReceiptText, Download, Clock, Sparkles } from 'lucide-react';
import { useOnboarding } from '../../features/onboarding';

interface LocationRow {
  id: string;
  name: string;
  type: string | null;
  active: boolean | null;
}

/**
 * Configuración (solo admin): datos del negocio + ubicaciones de stock.
 */
export function SettingsView({ currentUser, showToast }: {
  currentUser: Profile | null;
  showToast?: (msg: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const { openGuide } = useOnboarding();
  const notify = (msg: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    if (showToast) showToast(msg, kind);
  };

  const [biz, setBiz] = useState<BusinessSettings>(() => loadBusiness());
  const [ivaRate, setIvaRate] = useState(() => {
    try { return localStorage.getItem('dv-iva-rate') || String(getIvaRate()); }
    catch { return '0.21'; }
  });
  const [puntoVenta, setPuntoVenta] = useState(() => {
    try { return localStorage.getItem('dv-punto-venta') || '0001'; }
    catch { return '0001'; }
  });
  const [targetMargin, setTargetMargin] = useState(() => {
    try { return localStorage.getItem('dv-target-margin') || '40'; }
    catch { return '40'; }
  });
  const [mpSettings, setMpSettings] = useState<MercadoPagoSettings>(() => loadMercadoPagoSettings());
  const [metaOpen, setMetaOpen] = useState(() => loadMetaSchedule().open);
  const [metaClose, setMetaClose] = useState(() => loadMetaSchedule().close);
  const [mpTesting, setMpTesting] = useState(false);
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loadingLoc, setLoadingLoc] = useState(true);
  const [newLocName, setNewLocName] = useState('');
  const [newLocType, setNewLocType] = useState('store');
  const [savingLoc, setSavingLoc] = useState(false);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    setLoadingLoc(true);
    try {
      const { data, error } = await supabase.from('locations').select('*').order('name');
      if (error) throw error;
      setLocations((data || []) as LocationRow[]);
    } catch (e: any) {
      notify(`Error cargando ubicaciones: ${e?.message || e}`, 'error');
    } finally {
      setLoadingLoc(false);
    }
  };

  const handleSaveBiz = () => {
    saveBusiness(biz);
    notify('Datos del negocio guardados. Se usan en los tickets.', 'success');
  };

  const handleSaveFiscal = () => {
    try {
      localStorage.setItem('dv-iva-rate', ivaRate);
      localStorage.setItem('dv-punto-venta', puntoVenta.padStart(4, '0').slice(-4));
      localStorage.setItem('dv-target-margin', targetMargin);
    } catch { /* noop */ }
    notify('Parámetros guardados (IVA, punto de venta, margen).', 'success');
  };

  const handleSaveMp = () => {
    if (mpSettings.mpMode === 'prod' && !window.confirm('Vas a activar el modo PRODUCCIÓN: los links/QR generados cobrarán dinero real. ¿Continuar?')) {
      return;
    }
    saveMercadoPagoSettings(mpSettings);
    notify(
      mpSettings.mpMode === 'prod'
        ? 'Modo PRODUCCIÓN guardado: los cobros serán reales.'
        : 'Configuración de Mercado Pago guardada (modo prueba).',
      mpSettings.mpMode === 'prod' ? 'warning' : 'success'
    );
  };

  const handleSaveSchedule = () => {
    if (!isValidTime(metaOpen) || !isValidTime(metaClose)) {
      notify('Horario inválido. Elegí hora de apertura y cierre válidas.', 'warning');
      return;
    }
    if (hoursOf(metaClose) <= hoursOf(metaOpen)) {
      notify('El cierre debe ser posterior a la apertura.', 'warning');
      return;
    }
    saveMetaSchedule(metaOpen, metaClose);
    notify(`Horario de meta guardado: de ${metaOpen} a ${metaClose}.`, 'success');
  };

  const handleTestMp = async () => {
    setMpTesting(true);
    try {
      const err = await checkMpFunction(mpSettings.mpMode);
      const modo = mpSettings.mpMode === 'prod' ? 'producción' : 'prueba';
      if (err === null) notify(`Conexión OK (modo ${modo}): la Edge Function crea preferencias con monto exacto.`, mpSettings.mpMode === 'prod' ? 'warning' : 'success');
      else notify(`Edge Function no disponible (modo ${modo}): ${err}`, 'error');
    } finally {
      setMpTesting(false);
    }
  };

  const handleBackup = async (kind: 'products' | 'sales') => {
    setBackingUp(kind);
    try {
      if (kind === 'products') {
        const { data, error } = await supabase.from('products').select('*').order('name');
        if (error) throw error;
        downloadCsv(
          stampName('productos'),
          ['id', 'barcode', 'nombre', 'categoria', 'unidad', 'costo', 'mayorista', 'minorista', 'stock', 'minimo', 'activo'],
          (data || []).map((p: any) => [p.id, p.barcode || '', p.name, p.category || '', p.unit_type, p.cost_price, p.wholesale_price, p.retail_price, p.stock_quantity, p.min_stock, p.is_active])
        );
      } else {
        const { data, error } = await supabase.from('sales')
          .select('id, receipt_number, customer_name, total_amount, payment_method, status, created_at, user_id')
          .order('created_at', { ascending: false })
          .limit(1000);
        if (error) throw error;
        downloadCsv(
          stampName('ventas'),
          ['id', 'ticket', 'cliente', 'total', 'pago', 'estado', 'fecha', 'vendedor_id'],
          (data || []).map((s: any) => [s.id, s.receipt_number || '', s.customer_name || '', s.total_amount, s.payment_method, s.status, s.created_at, s.user_id || ''])
        );
      }
      notify('Respaldo descargado.', 'success');
    } catch (e: any) {
      notify(`Error: ${e?.message || e}`, 'error');
    } finally {
      setBackingUp(null);
    }
  };

  const handleAddLocation = async () => {
    const name = newLocName.trim();
    if (!name) return;
    setSavingLoc(true);
    try {
      const { error } = await supabase.from('locations').insert({ name, type: newLocType });
      if (error) throw error;
      setNewLocName('');
      fetchLocations();
      notify(`Ubicación "${name}" creada.`, 'success');
    } catch (e: any) {
      notify(`Error: ${e?.message || e}`, 'error');
    } finally {
      setSavingLoc(false);
    }
  };

  const handleToggleLocation = async (loc: LocationRow) => {
    try {
      const { error } = await supabase.from('locations').update({ active: !loc.active }).eq('id', loc.id);
      if (error) throw error;
      fetchLocations();
    } catch (e: any) {
      notify(`Error: ${e?.message || e}`, 'error');
    }
  };

  const handleDeleteLocation = async (loc: LocationRow) => {
    if (!confirm(`¿Eliminar la ubicación "${loc.name}"? El inventario asociado se borra en cascada.`)) return;
    try {
      const { error } = await supabase.from('locations').delete().eq('id', loc.id);
      if (error) throw error;
      fetchLocations();
      notify('Ubicación eliminada.', 'info');
    } catch (e: any) {
      notify(`Error: ${e?.message || e}`, 'error');
    }
  };

  if (!['admin', 'supervisor', 'vendedor'].includes(currentUser?.role || '')) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Shield size={48} className="mx-auto text-amber-500 mb-2" />
        <p className="text-lg font-semibold">Acceso Restringido</p>
        <p className="text-sm">Solo los administradores pueden cambiar la configuración.</p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <Store className="text-emerald-600" size={22} /> Configuración
        </h1>
        <p className="text-xs text-slate-500 font-semibold">Datos del negocio y ubicaciones de stock. Solo administradores.</p>
      </div>

      {/* Ayuda */}
      <div data-tour="settings-help" className="glass-card rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Ayuda</p>
          <p className="text-sm text-slate-600 dark:text-slate-300 font-medium mt-0.5">Volvé a ver el recorrido guiado de la app.</p>
        </div>
        <button onClick={openGuide} className="px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5 self-start sm:self-auto shrink-0">
          <Sparkles size={16} /> Ver recorrido
        </button>
      </div>

      {/* Datos del negocio */}
      <div data-tour="settings-business" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 sm:p-5 space-y-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Datos del negocio (tickets)</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-[11px] font-bold text-slate-500">Nombre
            <input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })}
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">CUIT
            <input value={biz.cuit} onChange={(e) => setBiz({ ...biz, cuit: e.target.value })}
              placeholder="30-12345678-9"
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">Dirección
            <input value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })}
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">Teléfono
            <input value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })}
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="text-[11px] font-bold text-slate-500 sm:col-span-2">Pie del ticket
            <input value={biz.footer} onChange={(e) => setBiz({ ...biz, footer: e.target.value })}
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
        </div>
        <button onClick={handleSaveBiz}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5">
          <Save size={16} /> Guardar datos
        </button>
      </div>

      {/* Fiscal y comercial */}
      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 sm:p-5 space-y-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <ReceiptText size={14} /> Fiscal y comercial
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <div className="text-[11px] font-bold text-slate-500">Alícuota IVA
            <div className="mt-0.5">
              <SelectMenu
                value={ivaRate}
                options={[
                  { value: '0.21', label: '21% general' },
                  { value: '0.105', label: '10,5% reducida' },
                  { value: '0', label: '0% / exento' },
                ]}
                onChange={(v) => setIvaRate(String(v))}
                ariaLabel="Alícuota de IVA"
                width="w-44"
                fullWidth
              />
            </div>
          </div>
          <label className="text-[11px] font-bold text-slate-500">Punto de venta
            <input value={puntoVenta} onChange={(e) => setPuntoVenta(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric" placeholder="0001"
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            <span className="flex items-center gap-1"><Percent size={11} /> Margen objetivo %</span>
            <input value={targetMargin} onChange={(e) => setTargetMargin(e.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal" placeholder="40"
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
        </div>
        <button onClick={handleSaveFiscal}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5">
          <Save size={16} /> Guardar parámetros
        </button>
      </div>

      {/* Horario de la meta diaria */}
      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 sm:p-5 space-y-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <Clock size={14} /> Horario de la meta diaria
        </p>
        <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
          Se usa en el Dashboard para calcular el <b>ritmo</b> y el <b>cierre proyectado</b> de la meta de ventas.
          Fuera de este horario no se proyecta.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="text-[11px] font-bold text-slate-500">Apertura
            <input type="time" value={metaOpen} onChange={(e) => setMetaOpen(e.target.value)}
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">Cierre
            <input type="time" value={metaClose} onChange={(e) => setMetaClose(e.target.value)}
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </label>
        </div>
        <button onClick={handleSaveSchedule}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5">
          <Save size={16} /> Guardar horario
        </button>
      </div>

      {/* Mercado Pago */}
      <div data-tour="settings-mp" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 sm:p-5 space-y-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <span>💙 Mercado Pago (Integración POS y Links de Pago)</span>
        </p>
        <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
          El link de pago se crea con la <b>Edge Function <code>mp-create-preference</code></b> (token seguro en
          Secrets de Supabase, monto exacto de la venta). En modo <b>Prueba</b> usa el secret
          <code>MP_ACCESS_TOKEN_TEST</code>; en modo <b>Producción</b> usa <code>MP_ACCESS_TOKEN</code>.
          Los campos de abajo son un respaldo opcional.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Modo</span>
          <div className="flex bg-slate-200/80 dark:bg-[#232323] p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => setMpSettings({ ...mpSettings, mpMode: 'test' })}
              className={`px-3.5 py-1.5 rounded-lg transition cursor-pointer ${mpSettings.mpMode === 'prod' ? 'text-slate-600 dark:text-zinc-400' : 'bg-sky-600 text-white shadow-sm'}`}
            >
              🧪 Prueba
            </button>
            <button
              onClick={() => setMpSettings({ ...mpSettings, mpMode: 'prod' })}
              className={`px-3.5 py-1.5 rounded-lg transition cursor-pointer ${mpSettings.mpMode === 'prod' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 dark:text-zinc-400'}`}
            >
              💰 Producción
            </button>
          </div>
        </div>
        {mpSettings.mpMode === 'prod' && (
          <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            ⚠️ Modo producción: los links/QR generados en el POS cobrarán dinero real. Usalo solo con la cuenta definitiva.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-[11px] font-bold text-slate-500">Access Token (respaldo, PROD / Test)
            <input value={mpSettings.accessToken} onChange={(e) => setMpSettings({ ...mpSettings, accessToken: e.target.value })}
              placeholder="APP_USR-..."
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">Public Key
            <input value={mpSettings.publicKey} onChange={(e) => setMpSettings({ ...mpSettings, publicKey: e.target.value })}
              placeholder="APP_USR-..."
              className="mt-0.5 w-full px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleSaveMp}
            className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5">
            <Save size={16} /> Guardar respaldo
          </button>
          <button onClick={handleTestMp} disabled={mpTesting}
            className="px-4 py-2.5 bg-white border-2 border-sky-500 text-sky-600 hover:bg-sky-50 rounded-xl text-sm font-bold transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
            {mpTesting ? <Loader2 size={16} className="animate-spin" /> : null} Probar conexión (Edge Function)
          </button>
        </div>
      </div>

      {/* Respaldo */}
      <div data-tour="settings-backup" className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 sm:p-5 space-y-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <Download size={14} /> Respaldo CSV
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => handleBackup('products')} disabled={backingUp !== null}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {backingUp === 'products' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Productos
          </button>
          <button onClick={() => handleBackup('sales')} disabled={backingUp !== null}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
            {backingUp === 'sales' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Ventas (últimas 1000)
          </button>
        </div>
      </div>

      {/* Ubicaciones */}
      <div className="bg-white dark:bg-[#1F1F1F] rounded-3xl border border-slate-200 dark:border-[#333333] p-4 sm:p-5 space-y-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
          <MapPin size={14} /> Ubicaciones de stock
        </p>
        <div className="flex gap-2">
          <input value={newLocName} onChange={(e) => setNewLocName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddLocation(); }}
            placeholder="Ej: Depósito, Sucursal centro…"
            className="flex-1 min-w-0 px-3 py-2 border-2 border-slate-200 dark:border-[#333333] rounded-xl text-sm font-semibold text-slate-900 dark:text-white bg-white dark:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <SelectMenu
            value={newLocType}
            options={[
              { value: 'store', label: 'Local' },
              { value: 'warehouse', label: 'Depósito' },
            ]}
            onChange={(v) => setNewLocType(String(v))}
            ariaLabel="Tipo de ubicación"
            width="w-32"
          />
          <button onClick={handleAddLocation} disabled={savingLoc || !newLocName.trim()}
            className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 text-white rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-40 flex items-center gap-1">
            {savingLoc ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar
          </button>
        </div>
        {loadingLoc ? (
          <p className="text-sm text-slate-400 text-center py-4">Cargando…</p>
        ) : locations.length === 0 ? (
          <p className="text-sm text-slate-400">Sin ubicaciones.</p>
        ) : (
          <div className="space-y-1.5">
            {locations.map((l) => (
              <div key={l.id} className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-[#232323] rounded-xl border border-slate-100 dark:border-[#333333] text-sm">
                <div>
                  <p className="font-bold text-slate-800 dark:text-white">{l.name}</p>
                  <p className="text-[11px] text-slate-400 font-semibold">
                    {l.type === 'warehouse' ? 'Depósito' : 'Local'} · {l.active ? 'Activa' : 'Inactiva'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => handleToggleLocation(l)} title={l.active ? 'Desactivar' : 'Activar'}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${l.active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                    {l.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button onClick={() => handleDeleteLocation(l)} title="Eliminar"
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
