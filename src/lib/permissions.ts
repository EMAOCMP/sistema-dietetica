import type { UserRole } from '../types';

/**
 * Permisos de UI alineados con las RLS de `supabase/roles_permisos.sql`.
 *
 * Regla: si la base bloquea la operación, la UI no debe prometerla.
 * Cada helper devuelve false cuando el rol es desconocido (privilegio mínimo).
 */

export const ALL_ROLES: UserRole[] = ['admin', 'supervisor', 'vendedor'];

export function hasRole(role: string | null | undefined, allowed: UserRole[]): boolean {
  return !!role && allowed.includes(role as UserRole);
}

/** Solo administradores. */
export const isAdmin = (role: string | null | undefined) => hasRole(role, ['admin']);

/** Administradores y supervisores (los que pueden operar la gestión). */
export const isManager = (role: string | null | undefined) => hasRole(role, ['admin', 'supervisor']);

/** Cuentas de caja: no gestionan el negocio. */
export const isSeller = (role: string | null | undefined) => hasRole(role, ['vendedor']);

/** Ver el reporte de ganancias (RLS: el vendedor solo lee sus propias ventas). */
export const canViewReports = (role: string | null | undefined) => isManager(role);

/** Registrar gastos del negocio (RLS expenses_insert: admin + supervisor). */
export const canRecordExpenses = (role: string | null | undefined) => isManager(role);

/** Eliminar gastos (RLS expenses_delete: solo admin). */
export const canDeleteExpenses = (role: string | null | undefined) => isAdmin(role);

/** Guardar el cierre de caja (RLS cash_closes_update: admin + supervisor). */
export const canCloseCash = (role: string | null | undefined) => isManager(role);

/** Ver la gestión de usuarios y la actividad del equipo. */
export const canViewUsers = (role: string | null | undefined) => isManager(role);

/** Cambiar roles (RLS profiles_update_admin: solo admin). */
export const canChangeRoles = (role: string | null | undefined) => isAdmin(role);

/** Configuración del negocio y ubicaciones de stock. */
export const canManageSettings = (role: string | null | undefined) => isManager(role);

/** Dar de baja / reactivar productos (RLS products_delete: solo admin). */
export const canDeactivateProducts = (role: string | null | undefined) => isAdmin(role);

/** Anular ventas (RPC cancel_sale: admin + supervisor). */
export const canAnnulSales = (role: string | null | undefined) => isManager(role);

/** Cancelar borradores de ingreso de mercadería (RLS: el vendedor no puede cancelar). */
export const canCancelIntake = (role: string | null | undefined) => isManager(role);

/** Transferir stock entre ubicaciones (RPC transfer_stock: cualquier autenticado). */
export const canTransferStock = (role: string | null | undefined) => hasRole(role, ALL_ROLES);
