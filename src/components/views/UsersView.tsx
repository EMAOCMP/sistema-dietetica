import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Profile, UserRole } from '../../types';
import {
  Shield, Mail, Award, CheckCircle, X, Activity, Loader2,
  Crown, Eye, ShoppingCart, Users, RefreshCw, ChevronDown,
} from 'lucide-react';
import { EmptyState } from '../../features/onboarding';

interface UsersViewProps {
  currentUser: Profile | null;
}

const ROLE_META: Record<UserRole, { label: string; icon: typeof Crown; chip: string; dot: string }> = {
  admin: {
    label: 'Administrador',
    icon: Crown,
    chip: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
    dot: 'bg-purple-400',
  },
  supervisor: {
    label: 'Supervisor',
    icon: Eye,
    chip: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
    dot: 'bg-sky-400',
  },
  vendedor: {
    label: 'Vendedor',
    icon: ShoppingCart,
    chip: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
};

const ROLE_OPTIONS: { value: UserRole; label: string; desc: string }[] = [
  { value: 'admin', label: 'Administrador (Total)', desc: 'Acceso completo' },
  { value: 'supervisor', label: 'Supervisor (Control)', desc: 'Stock y reportes' },
  { value: 'vendedor', label: 'Vendedor (Caja/POS)', desc: 'Solo ventas' },
];

const PERMISSIONS: Record<UserRole, string[]> = {
  admin: ['Productos', 'Costos', 'Usuarios', 'Reportes', 'Caja'],
  supervisor: ['Stock', 'Alertas', 'Reportes', 'Ventas'],
  vendedor: ['Caja / POS'],
};

export function UsersView({ currentUser }: UsersViewProps) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activityUser, setActivityUser] = useState<Profile | null>(null);
  const [activitySales, setActivitySales] = useState<any[]>([]);
  const [activityMoves, setActivityMoves] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [openRoleMenu, setOpenRoleMenu] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name');

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setOpenRoleMenu(null);
    if (currentUser?.id === userId && newRole !== 'admin') {
      alert('No puedes quitarte el rol de Administrador a ti mismo.');
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;
      setSuccessMsg('¡Rol actualizado con éxito!');
      fetchUsers();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert('Error al actualizar rol: ' + err.message);
    }
  };

  const openActivity = async (u: Profile) => {
    setActivityUser(u);
    setActivitySales([]);
    setActivityMoves([]);
    setLoadingActivity(true);
    try {
      const [salesRes, movesRes] = await Promise.all([
        supabase.from('sales')
          .select('id, receipt_number, total_amount, payment_method, status, created_at')
          .eq('user_id', u.id)
          .order('created_at', { ascending: false }),
        supabase.from('inventory_movements')
          .select('id, type, quantity, previous_quantity, new_quantity, reference_type, product_id, created_at')
          .eq('user_id', u.id)
          .order('created_at', { ascending: false }),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (movesRes.error) throw movesRes.error;
      setActivitySales(salesRes.data || []);
      const pids = [...new Set((movesRes.data || []).map((m: any) => m.product_id).filter(Boolean))];
      let prodNames: Record<string, string> = {};
      if (pids.length) {
        const { data: prods } = await supabase.from('products').select('id, name').in('id', pids);
        prodNames = Object.fromEntries((prods || []).map((p: any) => [p.id, p.name]));
      }
      setActivityMoves((movesRes.data || []).map((m: any) => ({
        ...m,
        product_name: prodNames[m.product_id] || m.product_id?.slice(0, 8) || '—',
      })));
    } catch (err: any) {
      alert('Error al cargar actividad: ' + err.message);
      setActivityUser(null);
    } finally {
      setLoadingActivity(false);
    }
  };

  if (!['admin', 'supervisor', 'vendedor'].includes(currentUser?.role || '')) {
    return (
      <div className="p-8 text-center">
        <div className="glass-card rounded-3xl p-10 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
            <Shield size={32} className="text-amber-400" />
          </div>
          <p className="text-lg font-bold text-slate-800 dark:text-white">Acceso Restringido</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            No tenés permisos para ver usuarios y actividad.
          </p>
        </div>
      </div>
    );
  }

  const canChangeRoles = ['admin', 'supervisor', 'vendedor'].includes(currentUser?.role || '');
  const roleCounts = {
    admin: users.filter((u) => u.role === 'admin').length,
    supervisor: users.filter((u) => u.role === 'supervisor').length,
    vendedor: users.filter((u) => u.role === 'vendedor').length,
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center">
              <Users size={18} className="text-brand-400" />
            </div>
            Gestión de Usuarios y Permisos
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {canChangeRoles
              ? 'Administra los roles del personal y revisa su actividad.'
              : 'Consulta el equipo y su actividad (solo el admin cambia roles).'}
          </p>
        </div>
        <button
          onClick={fetchUsers}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-brand-500/25 transition cursor-pointer"
        >
          <RefreshCw size={15} />
          Actualizar Lista
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {([
          { key: 'admin' as const, label: 'Admins', icon: Crown, color: 'text-purple-400', bg: 'bg-purple-500/10' },
          { key: 'supervisor' as const, label: 'Supervisores', icon: Eye, color: 'text-sky-400', bg: 'bg-sky-500/10' },
          { key: 'vendedor' as const, label: 'Vendedores', icon: ShoppingCart, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        ]).map((s) => (
          <div key={s.key} className="glass-card rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center shrink-0`}>
              <s.icon size={18} className={s.color} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-extrabold tnum text-slate-900 dark:text-white leading-none">
                {roleCounts[s.key]}
              </p>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mt-1 truncate">
                {s.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {successMsg && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-2xl text-sm flex items-center gap-2.5">
          <CheckCircle size={18} className="shrink-0" />
          <span className="font-semibold">{successMsg}</span>
        </div>
      )}

      <div data-tour="users-list" className="glass-card rounded-3xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
            <Loader2 size={28} className="animate-spin text-brand-400" />
            <p className="text-sm font-medium">Cargando usuarios...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="p-4 sm:p-8">
            <EmptyState
              icon={<Users size={28} />}
              title="No hay usuarios registrados"
              description="Cuando alguien cree una cuenta aparecerá acá con su rol y actividad."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-200/60 dark:border-white/5">
                  <th className="px-5 py-4 font-bold">Usuario</th>
                  <th className="px-5 py-4 font-bold">Correo Electrónico</th>
                  <th className="px-5 py-4 font-bold">Rol Asignado</th>
                  <th className="px-5 py-4 font-bold">Permisos del Sistema</th>
                  <th className="px-5 py-4 font-bold text-center">Actividad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 text-sm">
                {users.map((u) => {
                  const meta = ROLE_META[u.role] || ROLE_META.vendedor;
                  const RoleIcon = meta.icon;
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.03] transition">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-sm shrink-0 ${
                            u.role === 'admin'
                              ? 'bg-purple-500/15 text-purple-400'
                              : u.role === 'supervisor'
                                ? 'bg-sky-500/15 text-sky-400'
                                : 'bg-emerald-500/15 text-emerald-400'
                          }`}>
                            {u.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 dark:text-white truncate">{u.full_name}</p>
                            {isSelf && (
                              <span className="text-[10px] font-bold uppercase tracking-wide text-brand-500 dark:text-brand-400">
                                Tú
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                          <Mail size={14} className="text-slate-400 shrink-0" />
                          <span className="truncate">{u.email}</span>
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {canChangeRoles ? (
                          <div className="relative">
                            <button
                              onClick={() => setOpenRoleMenu(openRoleMenu === u.id ? null : u.id)}
                              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${meta.chip}`}
                              aria-haspopup="listbox"
                              aria-expanded={openRoleMenu === u.id}
                            >
                              <RoleIcon size={13} />
                              {meta.label}
                              <ChevronDown size={13} className={`transition-transform ${openRoleMenu === u.id ? 'rotate-180' : ''}`} />
                            </button>
                            {openRoleMenu === u.id && (
                              <div className="absolute left-0 top-full mt-2 z-50 w-64 glass-card rounded-2xl p-1.5 shadow-2xl origin-top animate-in fade-in-0 zoom-in-95 duration-150"
                                   role="listbox" aria-label={`Cambiar rol de ${u.full_name}`}>
                                {ROLE_OPTIONS.map((opt) => {
                                  const m = ROLE_META[opt.value];
                                  const active = u.role === opt.value;
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => handleRoleChange(u.id, opt.value)}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${
                                        active
                                          ? 'bg-brand-500/15 text-brand-600 dark:text-brand-300'
                                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'
                                      }`}
                                      role="option"
                                      aria-selected={active}
                                    >
                                      <m.icon size={15} className={active ? 'text-brand-500' : 'text-slate-400'} />
                                      <span className="flex-1 min-w-0">
                                        <span className="block text-xs font-bold">{opt.label}</span>
                                        <span className="block text-[10px] text-slate-400 dark:text-slate-500">{opt.desc}</span>
                                      </span>
                                      {active && <CheckCircle size={15} className="text-brand-500 shrink-0" />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border ${meta.chip}`}>
                            <RoleIcon size={13} />
                            {meta.label}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {PERMISSIONS[u.role]?.map((p) => (
                            <span
                              key={p}
                              className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400 border border-slate-200/60 dark:border-white/5"
                            >
                              {p}
                            </span>
                          )) || (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <button
                          onClick={() => openActivity(u)}
                          title={`Ver actividad de ${u.full_name}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-700 dark:bg-white/10 dark:hover:bg-white/15 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                        >
                          <Activity size={14} />
                          Ver
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-3xl p-6 bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow-brand relative overflow-hidden">
        <Shield className="absolute -right-4 -bottom-4 text-white/5 transform -rotate-12" size={110} />
        <h3 className="text-lg font-extrabold flex items-center gap-2.5 relative">
          <Shield className="text-emerald-300" size={20} />
          Guía de Roles y Permisos
        </h3>
        <ul className="text-sm text-brand-100 space-y-1.5 list-disc list-inside mt-3 relative">
          <li><strong className="text-white">Administrador:</strong> Acceso total a productos, precios de costo, gestión de usuarios, reportes y caja.</li>
          <li><strong className="text-white">Supervisor:</strong> Control de stock, alertas críticas, reportes y supervisión de ventas.</li>
          <li><strong className="text-white">Vendedor:</strong> Acceso exclusivo a Caja / POS para registrar ventas y cobrar.</li>
        </ul>
      </div>

      {activityUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setActivityUser(null)}>
          <div
            className="glass-card rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`Actividad de ${activityUser.full_name}`}
          >
            <div className="flex justify-between items-start border-b border-slate-200/60 dark:border-white/5 pb-4">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-extrabold ${
                  activityUser.role === 'admin'
                    ? 'bg-purple-500/15 text-purple-400'
                    : activityUser.role === 'supervisor'
                      ? 'bg-sky-500/15 text-sky-400'
                      : 'bg-emerald-500/15 text-emerald-400'
                }`}>
                  {activityUser.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white">{activityUser.full_name}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{activityUser.email}</p>
                  <span className={`inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide border ${ROLE_META[activityUser.role]?.chip}`}>
                    <Award size={10} />
                    {ROLE_META[activityUser.role]?.label}
                  </span>
                </div>
              </div>
              <button onClick={() => setActivityUser(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1" aria-label="Cerrar">
                <X size={22} />
              </button>
            </div>
            {loadingActivity ? (
              <p className="text-sm text-slate-400 text-center py-8 flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin" /> Cargando actividad...
              </p>
            ) : (
              <>
                <div>
                  <p className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                    Últimas ventas ({activitySales.length})
                  </p>
                  {activitySales.length === 0 ? (
                    <p className="text-sm text-slate-400">Sin ventas registradas.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {activitySales.map((s) => (
                        <div key={s.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200/60 dark:border-white/5 text-sm">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 dark:text-white font-mono text-xs truncate">{s.receipt_number || s.id.slice(0, 8)}</p>
                            <p className="text-[11px] text-slate-400 tnum">
                              {new Date(s.created_at).toLocaleString('es-AR')} · {s.payment_method} · {s.status}
                            </p>
                          </div>
                          <span className="font-extrabold text-emerald-600 dark:text-emerald-400 tnum shrink-0">
                            ${Number(s.total_amount).toLocaleString('es-AR')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                    Movimientos de stock ({activityMoves.length})
                  </p>
                  {activityMoves.length === 0 ? (
                    <p className="text-sm text-slate-400">Sin movimientos registrados.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {activityMoves.map((m) => (
                        <div key={m.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-white/5 rounded-xl border border-slate-200/60 dark:border-white/5 text-sm">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 dark:text-white text-xs truncate">{m.product_name}</p>
                            <p className="text-[11px] text-slate-400 tnum">
                              {m.type}{m.reference_type ? ` · ${m.reference_type}` : ''}
                              {m.previous_quantity != null ? ` (${m.previous_quantity} → ${m.new_quantity})` : ''}
                              {' · '}{new Date(m.created_at).toLocaleString('es-AR')}
                            </p>
                          </div>
                          <span className={`font-extrabold tnum shrink-0 ${Number(m.quantity) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {Number(m.quantity) > 0 ? `+${m.quantity}` : m.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <button
              onClick={() => setActivityUser(null)}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/15 text-white rounded-2xl text-sm font-bold cursor-pointer transition"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}