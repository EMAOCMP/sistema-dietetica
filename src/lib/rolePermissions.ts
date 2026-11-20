import type { UserRole } from '../types';
import {
  canAccessTab,
  canAnnulSales,
  canCancelIntake,
  canChangeRoles,
  canCloseCash,
  canDeactivateProducts,
  canDeleteExpenses,
  canDeleteProducts,
  canManageLocations,
  canManageSettings,
  canRecordExpenses,
  canTransferStock,
  canViewReports,
  canViewUsers,
} from './permissions';

/**
 * Catálogo de permisos del sistema, en lenguaje de negocio.
 *
 * Cada capacidad se evalúa con el MISMO helper que usa la UI para mostrar u
 * ocultar la función (`permissions.ts`), y esos helpers espejan las RLS de
 * `supabase/roles_permisos.sql`. Así, lo que ve el administrador en
 * "Gestión de Usuarios y Permisos" no puede desincronizarse del código.
 */

export type CapabilityGroup = 'Operación' | 'Gestión' | 'Administración';

export interface Capability {
  id: string;
  /** Nombre completo (modal / matriz). */
  label: string;
  /** Etiqueta corta para los chips de la tabla. */
  short: string;
  /** Explicación en una línea de qué habilita. */
  desc: string;
  group: CapabilityGroup;
  allowed: (role: UserRole | null | undefined) => boolean;
}

export const CAPABILITY_GROUPS: CapabilityGroup[] = ['Operación', 'Gestión', 'Administración'];

export const SYSTEM_CAPABILITIES: Capability[] = [
  // ── Operación: todo el personal ──────────────────────────────────
  {
    id: 'pos',
    label: 'Vender y cobrar',
    short: 'Ventas',
    desc: 'Registrar ventas desde el módulo de Ventas, aplicar descuentos y cobrar en cualquier medio.',
    group: 'Operación',
    allowed: (role) => canAccessTab(role, 'pos'),
  },
  {
    id: 'products',
    label: 'Productos y stock',
    short: 'Productos',
    desc: 'Ver catálogo, precios y stock; dar de alta productos y editar los activos.',
    group: 'Operación',
    allowed: (role) => canAccessTab(role, 'products'),
  },
  {
    id: 'intake',
    label: 'Ingreso de mercadería',
    short: 'Ingresos',
    desc: 'Cargar y confirmar ingresos de mercadería.',
    group: 'Operación',
    allowed: (role) => canAccessTab(role, 'intake'),
  },
  {
    id: 'purchase-orders',
    label: 'Órdenes de compra',
    short: 'Órdenes',
    desc: 'Armar órdenes de reposición para proveedores.',
    group: 'Operación',
    allowed: (role) => canAccessTab(role, 'purchaseorders'),
  },
  {
    id: 'history',
    label: 'Historial de pedidos',
    short: 'Historial',
    desc: 'Consultar ventas. El vendedor solo ve las propias; gestión ve todas.',
    group: 'Operación',
    allowed: (role) => canAccessTab(role, 'history'),
  },
  {
    id: 'own-activity',
    label: 'Mi actividad',
    short: 'Mi actividad',
    desc: 'Ver las propias ventas y movimientos de stock.',
    group: 'Operación',
    allowed: (role) => canAccessTab(role, 'activity'),
  },
  {
    id: 'transfer-stock',
    label: 'Transferencias de stock',
    short: 'Transferencias',
    desc: 'Mover stock entre depósitos y sucursales.',
    group: 'Operación',
    allowed: canTransferStock,
  },

  // ── Gestión: admin + supervisor ──────────────────────────────────
  {
    id: 'reports',
    label: 'Reportes de ganancias',
    short: 'Reportes',
    desc: 'Ver ventas, gastos y ganancia neta del período.',
    group: 'Gestión',
    allowed: canViewReports,
  },
  {
    id: 'cash-close',
    label: 'Cierre de caja',
    short: 'Cierre de caja',
    desc: 'Comparar lo esperado con el cajón y guardar el cierre del día.',
    group: 'Gestión',
    allowed: canCloseCash,
  },
  {
    id: 'expenses',
    label: 'Registrar gastos',
    short: 'Gastos',
    desc: 'Cargar gastos del negocio para el reporte de ganancias.',
    group: 'Gestión',
    allowed: canRecordExpenses,
  },
  {
    id: 'annul-sales',
    label: 'Anular ventas',
    short: 'Anular ventas',
    desc: 'Cancelar una venta y devolver el stock al catálogo.',
    group: 'Gestión',
    allowed: canAnnulSales,
  },
  {
    id: 'cancel-intake',
    label: 'Cancelar ingresos',
    short: 'Cancelar ingresos',
    desc: 'Cancelar un ingreso de mercadería ya cargado.',
    group: 'Gestión',
    allowed: canCancelIntake,
  },
  {
    id: 'users',
    label: 'Usuarios y actividad del equipo',
    short: 'Usuarios',
    desc: 'Ver el padrón y la actividad de cada persona. Cambiar roles es solo del admin.',
    group: 'Gestión',
    allowed: canViewUsers,
  },
  {
    id: 'settings',
    label: 'Configuración del negocio',
    short: 'Configuración',
    desc: 'Datos del negocio, ticket, medios de pago y preferencias.',
    group: 'Gestión',
    allowed: canManageSettings,
  },

  // ── Administración: solo admin ───────────────────────────────────
  {
    id: 'product-status',
    label: 'Dar de baja / reactivar productos',
    short: 'Baja de productos',
    desc: 'Desactivar un producto para que no se venda y volver a activarlo.',
    group: 'Administración',
    allowed: canDeactivateProducts,
  },
  {
    id: 'product-delete',
    label: 'Borrar productos',
    short: 'Borrar productos',
    desc: 'Eliminar definitivamente un producto del catálogo.',
    group: 'Administración',
    allowed: canDeleteProducts,
  },
  {
    id: 'locations',
    label: 'Administrar ubicaciones',
    short: 'Ubicaciones',
    desc: 'Crear, editar y borrar depósitos y sucursales de stock.',
    group: 'Administración',
    allowed: canManageLocations,
  },
  {
    id: 'expense-delete',
    label: 'Borrar gastos',
    short: 'Borrar gastos',
    desc: 'Eliminar un gasto cargado por error.',
    group: 'Administración',
    allowed: canDeleteExpenses,
  },
  {
    id: 'roles',
    label: 'Cambiar roles del equipo',
    short: 'Cambiar roles',
    desc: 'Promover o degradar usuarios entre administrador, supervisor y vendedor.',
    group: 'Administración',
    allowed: canChangeRoles,
  },
];

/** Permisos concretos que tiene un rol, en el orden del catálogo. */
export function capabilitiesFor(role: UserRole | null | undefined): Capability[] {
  return SYSTEM_CAPABILITIES.filter((c) => c.allowed(role));
}

export function capabilityGroupsFor(
  role: UserRole | null | undefined
): { group: CapabilityGroup; items: Capability[] }[] {
  return CAPABILITY_GROUPS.map((group) => ({
    group,
    items: SYSTEM_CAPABILITIES.filter((c) => c.group === group && c.allowed(role)),
  })).filter((g) => g.items.length > 0);
}
