# Arranque en el local

Estado de la base al momento de este documento: **catálogo cargado, todo lo demás en cero**.

| Dato | Estado |
|---|---|
| Productos | 8 (con precios y costos de demo) |
| Stock | 0 en los 8 |
| Ventas / caja / compras / ingresos / gastos | 0 |
| Próximo ticket | `0001-00000001` |
| Próximo ingreso | `ING-000001` |
| Próxima orden | `OC-000001` |
| Usuarios | Administrador + EMANUEL (supervisor) |

El respaldo de la demo del 13/11 está en
`Desktop\Dietetica\Dietetica-Extras\respaldo-demo-13-11.json`.

---

## Antes de abrir el local

1. **Precios y costos reales** — Productos → editar cada uno.
   El costo es lo que usan los reportes para calcular ganancia: si queda el de demo, la ganancia es ficticia.
2. **Stock inicial** — Ingreso Mercadería → nuevo ingreso → contar lo que hay → confirmar.
   Ese ingreso queda como `ING-000001` y deja el stock real.
3. **Fondo inicial de caja** — el cierre compara contra **ventas en efectivo**, sin fondo.
   Si arrancás con $X en el cajón, al cerrar restá ese fondo del contado (o pedí el módulo de apertura/retiros).
4. **Usuarios** — cada vendedor con su cuenta. Así "Mi actividad" y la auditoría muestran quién hizo qué.
5. **Impresión** — probar el ticket desde el POS y el comprobante A4 del cierre.

---

## Rutina diaria

1. Vender en el POS (funciona sin internet; sincroniza al volver).
2. Registrar gastos del día en Reporte de Ganancias.
3. Cerrar caja: contar el cajón, cargar el contado y guardar.
4. Si el cierre no cuadra, revisar las notas y los gastos en efectivo del día.

---

## Controles

```powershell
node scripts/db.mjs --file supabase/verificar_demo.sql --limit 20
```

Tiene que dar **stock desincronizado = 0** y **stock negativo = 0**.

---

## Pendientes conocidos (no bloquean la operación)

- El cierre no descuenta gastos en efectivo, retiros ni fondo inicial.
- Una venta offline sincronizada después de medianoche queda con la fecha de sincronización.
- Una OC recibida con faltante queda como "recibida"; el faltante se ve por línea.
