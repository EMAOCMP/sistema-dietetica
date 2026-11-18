import { Fragment } from 'react';
import { CheckCircle2, X, Shield, ChevronRight, Lock, Info } from 'lucide-react';
import type { UserRole } from '../../types';
import {
  CAPABILITY_GROUPS,
  SYSTEM_CAPABILITIES,
  capabilitiesFor,
  type Capability,
} from '../../lib/rolePermissions';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
};

const ROLE_TONE: Record<UserRole, string> = {
  admin: 'text-purple-500 dark:text-purple-400',
  supervisor: 'text-sky-500 dark:text-sky-400',
  vendedor: 'text-emerald-500 dark:text-emerald-400',
};

/** Orden de columnas de la matriz: el vendedor primero, que es el caso a revisar. */
const MATRIX_ROLES: UserRole[] = ['vendedor', 'supervisor', 'admin'];

/** Chips compactos para la columna "Permisos del Sistema" de la tabla de usuarios. */
export function PermissionChips({
  role,
  onOpen,
  max = 3,
}: {
  role: UserRole;
  onOpen: () => void;
  max?: number;
}) {
  const allowed = capabilitiesFor(role);
  const shown = allowed.slice(0, max);
  const rest = allowed.length - shown.length;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <span
            key={c.id}
            title={c.desc}
            className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400 border border-slate-200/60 dark:border-white/5"
          >
            {c.short}
          </span>
        ))}
        {rest > 0 && (
          <span
            title={allowed.slice(max).map((c) => c.label).join(' · ')}
            className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-brand-500/10 text-brand-600 dark:text-brand-300 border border-brand-500/20"
          >
            +{rest}
          </span>
        )}
        {allowed.length === 0 && <span className="text-xs text-slate-400">—</span>}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 hover:underline cursor-pointer"
      >
        Ver detalle ({allowed.length})
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

function MatrixCell({ allowed, label }: { allowed: boolean; label: string }) {
  return (
    <td className="px-3 py-3 text-center align-middle">
      {allowed ? (
        <>
          <CheckCircle2 size={16} className="inline text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
          <span className="sr-only">{label}: sí</span>
        </>
      ) : (
        <>
          <X size={16} className="inline text-slate-300 dark:text-slate-600" aria-hidden="true" />
          <span className="sr-only">{label}: no</span>
        </>
      )}
    </td>
  );
}

/** Matriz comparativa: qué puede hacer cada rol, agrupado por tipo de permiso. */
export function RolePermissionsMatrix() {
  return (
    <div className="glass-card rounded-3xl overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-slate-200/60 dark:border-white/5">
        <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center shrink-0">
            <Shield size={18} className="text-brand-500 dark:text-brand-400" />
          </div>
          Permisos del sistema por rol
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
          Qué puede hacer cada rol dentro de la app. El vendedor <strong className="text-slate-700 dark:text-slate-200">no</strong> accede
          a Gestión de Usuarios y Permisos, reportes, cierre de caja ni configuración.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[540px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-widest text-slate-400 dark:text-slate-500 border-b border-slate-200/60 dark:border-white/5">
              <th className="px-5 py-3.5 font-bold">Permiso</th>
              {MATRIX_ROLES.map((role) => (
                <th key={role} className="px-3 py-3.5 font-bold text-center w-24">
                  <span className={ROLE_TONE[role]}>{ROLE_LABEL[role]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-sm">
            {CAPABILITY_GROUPS.map((group) => (
              <Fragment key={group}>
                <tr className="bg-slate-50/80 dark:bg-white/[0.03]">
                  <td colSpan={MATRIX_ROLES.length + 1} className="px-5 py-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      {group}
                    </span>
                  </td>
                </tr>
                {SYSTEM_CAPABILITIES.filter((c) => c.group === group).map((cap) => (
                  <tr
                    key={cap.id}
                    className="border-b border-slate-100/80 last:border-0 dark:border-white/5 hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition"
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{cap.label}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">{cap.desc}</p>
                    </td>
                    {MATRIX_ROLES.map((role) => (
                      <MatrixCell key={role} allowed={cap.allowed(role)} label={`${cap.label} para ${ROLE_LABEL[role]}`} />
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CapabilityRow({ cap, allowed }: { cap: Capability; allowed: boolean }) {
  return (
    <li className={`flex items-start gap-2.5 py-2 ${allowed ? '' : 'opacity-60'}`}>
      {allowed ? (
        <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
      ) : (
        <X size={16} className="shrink-0 mt-0.5 text-slate-300 dark:text-slate-600" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${allowed ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
          {cap.label}
          <span className="sr-only">{allowed ? ' — permitido' : ' — denegado'}</span>
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">{cap.desc}</p>
      </div>
    </li>
  );
}

/** Detalle completo de un rol: permite y no permite, agrupado. */
export function RolePermissionsModal({ role, onClose }: { role: UserRole; onClose: () => void }) {
  const allowedCount = capabilitiesFor(role).length;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="glass-card rounded-3xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Permisos del rol ${ROLE_LABEL[role]}`}
      >
        <div className="flex justify-between items-start border-b border-slate-200/60 dark:border-white/5 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-brand-500/15 flex items-center justify-center shrink-0">
              <Shield size={20} className="text-brand-500 dark:text-brand-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                Permisos del {ROLE_LABEL[role].toLowerCase()}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {allowedCount} de {SYSTEM_CAPABILITIES.length} permisos habilitados
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-1"
            aria-label="Cerrar"
          >
            <X size={22} />
          </button>
        </div>

        {CAPABILITY_GROUPS.map((group) => (
          <div key={group}>
            <p className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">
              {group}
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {SYSTEM_CAPABILITIES.filter((c) => c.group === group).map((cap) => (
                <CapabilityRow key={cap.id} cap={cap} allowed={cap.allowed(role)} />
              ))}
            </ul>
          </div>
        ))}

        {role === 'vendedor' && (
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
            <Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              El vendedor no puede ver la gestión de usuarios, cambiar roles, ver reportes de ganancias,
              hacer el cierre de caja ni entrar a configuración.
            </span>
          </p>
        )}

        {role === 'supervisor' && (
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-sky-600 dark:text-sky-400 bg-sky-500/10 border border-sky-500/25 rounded-xl p-3">
            <Lock size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>Gestiona el negocio y ve usuarios, pero solo el administrador puede cambiar roles.</span>
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/15 text-white rounded-2xl text-sm font-bold cursor-pointer transition"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
