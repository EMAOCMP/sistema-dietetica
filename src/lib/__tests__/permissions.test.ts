import { describe, it, expect } from 'vitest';
import {
  canAccessTab,
  canChangeRoles,
  canViewUsers,
  canViewReports,
  canCloseCash,
  canManageSettings,
} from '../permissions';

describe('permisos de gestión', () => {
  it('el vendedor no ve usuarios, reportes, caja ni configuración', () => {
    expect(canViewUsers('vendedor')).toBe(false);
    expect(canViewReports('vendedor')).toBe(false);
    expect(canCloseCash('vendedor')).toBe(false);
    expect(canManageSettings('vendedor')).toBe(false);
  });

  it('el supervisor gestiona pero no cambia roles', () => {
    expect(canViewUsers('supervisor')).toBe(true);
    expect(canChangeRoles('supervisor')).toBe(false);
  });

  it('solo el admin cambia roles', () => {
    expect(canChangeRoles('admin')).toBe(true);
  });
});

describe('canAccessTab', () => {
  it('el vendedor entra a las secciones operativas', () => {
    for (const tab of ['dashboard', 'pos', 'products', 'intake', 'history', 'activity']) {
      expect(canAccessTab('vendedor', tab)).toBe(true);
    }
  });

  it('el vendedor no entra a las secciones de gestión', () => {
    for (const tab of ['users', 'reports', 'cashclose', 'settings']) {
      expect(canAccessTab('vendedor', tab)).toBe(false);
    }
  });

  it('el supervisor entra a gestión pero no cambia roles por pestaña', () => {
    expect(canAccessTab('supervisor', 'users')).toBe(true);
    expect(canAccessTab('supervisor', 'reports')).toBe(true);
    expect(canAccessTab('supervisor', 'settings')).toBe(true);
  });

  it('el admin entra a todo', () => {
    for (const tab of ['dashboard', 'pos', 'products', 'users', 'reports', 'cashclose', 'settings']) {
      expect(canAccessTab('admin', tab)).toBe(true);
    }
  });

  it('un rol desconocido no accede a nada (privilegio mínimo)', () => {
    expect(canAccessTab(null, 'dashboard')).toBe(false);
    expect(canAccessTab(undefined, 'pos')).toBe(false);
    expect(canAccessTab('otro', 'dashboard')).toBe(false);
  });
});
