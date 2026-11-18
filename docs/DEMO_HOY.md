# Demo en vivo — checklist

Objetivo: a las 10 minutos la app muestra el circuito completo con datos reales:
compra → stock → venta → gasto → cierre → reporte.

## 0. Antes de abrir

- [ ] Abrir `http://localhost:3000` y recargar con **Ctrl+F5** (si no, el service worker sirve la versión vieja).
- [ ] Login con `nekrok22k@gmail.com`.
- [ ] Tener a mano la impresora o el diálogo de impresión.

## 1. Cargar stock — Ingreso Mercadería → Nuevo ingreso

Queda como `ING-000001`. Cantidades sugeridas para el ensayo (ajustá con el conteo real si lo tenés):

| Producto | Cantidad |
|---|---|
| Almendras Non Pareil | 3 |
| Nueces Mariposa | 2,5 |
| Maní Salado | 6 |
| Avena Instantánea | 8 |
| Girasol Pelado | 5 |
| Lentejas | 7 |
| Crema de Maní 500 g | 4 |
| Miel Pura 500 g | 5 |

- Costo: el real de la factura. Si no lo tenés, el que ya figura en el producto.
- Al confirmar, el stock pasa de 0 a esas cantidades y **3 o 4 productos quedan bajo objetivo**: es lo que hace que Reposición muestre sugerencias.

**Qué mostrar:** Stock (números reales) → Reposición ("sugerido" = cuánto comprar).

## 2. Vender — POS

- Venta 1: 1 kg de Almendras + 1 Avena, **efectivo**.
- Venta 2: 1 Crema de Maní, **transferencia**.

**Qué mostrar:** el ticket impreso, el descuento de stock, y que "Mi actividad" lo registra al instante.

## 3. Gasto — Reporte de Ganancias

- Un gasto chico en **efectivo** (ej: $1.500, categoría "otro", descripción "flete").

**Qué mostrar:** cómo el gasto baja la ganancia y que va a descontarse del efectivo esperado.

## 4. Cierre de caja — Cierre de caja

- "Efectivo del día": fondo inicial $10.000 (si arrancás con plata en el cajón) → Agregar.
- El desglose tiene que decir:
  `Fondo 10.000 + Ventas (efectivo) + Ingresos 0 − Retiros 0 − Gastos 1.500 = esperado`
- Contado: botón **"Usar esperado"** (en la presentación real contás el cajón).
- Guardar → tiene que decir **"Cuadra ✓"**.
- Imprimir → comprobante A4 con logo, desglose y firma.

## 5. Reporte

- Reporte de Ganancias: ventas del día, ganancia y el gasto cargado.
- Mi actividad: filtro **Hoy**, total real y las dos ventas.

## En la presentación

Repetir solo los pasos 2 y 4: una o dos ventas y "Actualizar cierre". Al guardar de nuevo
aparece la confirmación de reemplazo y el aviso de que el esperado cambió — eso muestra
que el cierre no queda congelado.

## Si algo falla

- **"Stock insuficiente"**: el ingreso no se confirmó. Revisar Stock.
- **Pantalla vieja**: Ctrl+F5. Si sigue, DevTools → Application → Service Workers → Unregister.
- **Cierre con diferencia**: revisar los gastos en efectivo del día (se descuentan solos) y no cargarlos también como retiro.
