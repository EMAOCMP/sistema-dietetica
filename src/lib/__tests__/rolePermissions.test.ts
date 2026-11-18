import { describe, it, expect } from 'vitest';
import type { UserRole } from '../../types';
import {
  CAPABILITY_GROUPS,
  SYSTEM_CAPABILITIES,
  capabilitiesFor,
  capabilityGroupsFor,
} from '../rolePermissions';
import { canAccessTab } from '../permissions';

const idsFor = (role: UserRole) => capabilitiesFor(role).map((c) => c.id).sort();

describe('catálogo de permisos del sistema', () => {
  it('no repite ids ni etiquetas cortas y todos tienen grupo válido', () => {
    const ids = SYSTEM_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const cap of SYSTEM_CAPABILITIES) {
      expect(CAPABILITY_GROUPS).toContain(cap.group);
      expect(cap.label.length).toBeGreaterThan(0);
      expect(cap.desc.length).toBeGreaterThan(0);
    }
  });

  it('el vendedor solo tiene los permisos operativos', () => {
    expect(idsFor('vendedor')).toEqual(
      [
        'history',
        'intake',
        'own-activity',
        'pos',
        'products',
        'purchase-orders',
        'transfer-stock',
      ].sort()
    );
  });

  it('el vendedor no tiene ningún permiso de gestión ni administración', () => {
    const allowed = capabilitiesFor('vendedor');
    expect(allowed.some((c) => c.group === 'Gestión')).toBe(false);
    expect(allowed.some((c) => c.group === 'Administración')).toBe(false);
    expect(allowed.some((c) => c.id === 'users')).toBe(false);
    expect(allowed.some((c) => c.id === 'reports')).toBe(false);
    expect(allowed.some((c) => c.id === 'roles')).toBe(false);
  });

  it('el supervisor gestiona pero no administra', () => {
    const allowed = capabilitiesFor('supervisor');
    expect(allowed.some((c) => c.id === 'users')).toBe(true);
    expect(allowed.some((c) => c.id === 'reports')).toBe(true);
    expect(allowed.some((c) => c.group === 'Administración')).toBe(false);
    expect(allowed.some((c) => c.id === 'roles')).toBe(false);
  });

  it('el admin tiene todos los permisos del catálogo', () => {
    expect(capabilitiesFor('admin')).toHaveLength(SYSTEM_CAPABILITIES.length);
  });

  it('un rol desconocido no tiene permisos (privilegio mínimo)', () => {
    expect(capabilitiesFor(null)).toHaveLength(0);
    expect(capabilitiesFor('otro' as UserRole)).toHaveLength(0);
  });

  it('cada permiso de navegación coincide con canAccessTab', () => {
    const tabByCapability: Record<string, string> = {
      pos: 'pos',
      products: 'products',
      intake: 'intake',
      'purchase-orders': 'purchaseorders',
      history: 'history',
      'own-activity': 'activity',
      reports: 'reports',
      'cash-close': 'cashclose',
      users: 'users',
      settings: 'settings',
    };

    for (const [capId, tab] of Object.entries(tabByCapability)) {
      const cap = SYSTEM_CAPABILITIES.find((c) => c.id === capId);
      expect(cap, `falta la capacidad ${capId}`).toBeTruthy();
      for (const role of ['admin', 'supervisor', 'vendedor'] as UserRole[]) {
        expect(cap!.allowed(role), `${capId} / ${role}`).toBe(canAccessTab(role, tab));
      }
    }
  });

  it('agrupa solo los permisos permitidos y omite grupos vacíos', () => {
    const groups = capabilityGroupsFor('vendedor');
    expect(groups.map((g) => g.group)).toEqual(['Operación']);
    expect(groups[0].items.length).toBe(capabilitiesFor('vendedor').length);
  });
});
