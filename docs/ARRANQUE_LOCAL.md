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
| Usuarios | 1: `nekrok22k@gmail.com` (admin) |

El respaldo de la demo del 13/11 está en
`Desktop\Dietetica\Dietetica-Extras\respaldo-demo-13-11.json`.

---

## Antes de abrir el local

1. **Precios y costos reales** — Productos → editar cada uno.
   El costo es lo que usan los reportes para calcular ganancia: si queda el de demo, la ganancia es ficticia.
2. **Stock inicial** — Ingreso Mercadería → nuevo ingreso → contar lo que hay → confirmar.
   Ese ingreso queda como `ING-000001` y deja el stock real.
3. **Fondo inicial de caja** — Cierre de caja → "Efectivo del día" → tipo **Fondo inicial** → monto → Agregar.
   Se guarda por día y entra en el esperado. Los **retiros** y **gastos en efectivo** se descuentan solos.
4. **Usuarios** — con una sola cuenta (admin) alcanza. Si más adelante sumás vendedores, cada uno con su usuario.
5. **Impresión** — probar el ticket desde el POS y el comprobante A4 del cierre.

---

## Rutina diaria

1. Vender en el POS (funciona sin internet; sincroniza al volver y conserva la hora original de la venta).
2. Registrar gastos del día en Reporte de Ganancias (con su medio de pago).
3. Cerrar caja: registrar fondo/retiros si hubo, contar el cajón, cargar el contado y guardar.
4. Si el cierre no cuadra, revisar las notas y los gastos en efectivo del día.

---

## Controles

```powershell
node scripts/db.mjs --file supabase/verificar_demo.sql --limit 20
```

Tiene que dar **stock desincronizado = 0** y **stock negativo = 0**.

---

## Pendientes conocidos (no bloquean la operación)

- Una OC recibida con faltante queda como "recibida"; el faltante se ve por línea.
- Si cargás un gasto en efectivo después de guardar el cierre, volvé a guardarlo para actualizar el esperado.
