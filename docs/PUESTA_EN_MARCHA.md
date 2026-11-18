# Puesta en marcha — de cero a uso real

Guía para dejar la base limpia, cargar el catálogo y empezar a operar.

> Antes de cargar datos reales, hacer la prueba integral:
> `docs/PRUEBA_DESDE_CERO.md`.
> Para mostrar el sistema: `docs/GUION_PRESENTACION.md`.

---

## 1. Limpieza inicial (una sola vez)

1. Cerrar sesión en la app.
2. DevTools → Application → **Clear site data** (borra IndexedDB `dietetica-offline`).
3. SQL Editor → `supabase/reset_app_prueba.sql` → COMMIT.
4. SQL Editor → `supabase/dejar_solo_admin.sql` → debe quedar 1 usuario.
5. SQL Editor → `supabase/verificar_arranque.sql` → control.
6. Entrar con `nekrok22k@gmail.com` y hacer Ctrl+Shift+R.

Esperado en `verificar_arranque.sql`:

| Chequeo | Valor |
|---|---|
| usuarios | 1 |
| perfiles admin | 1 |
| email admin | nekrok22k@gmail.com |
| ubicaciones / medios de pago | > 0 |
| productos, ventas, ingresos, OC | 0 |
| stock desincronizado | 0 |
| próximo ticket / OC / ingreso | 1 |

> A partir de acá **no volver a correr** `reset_app_prueba.sql`,
> `reset_modulo_compras.sql`, `limpiar_*` ni `prueba_compras_cleanup.sql`.

---

## 2. Orden de carga

### Paso 1 — Proveedores

Nombre, teléfono y **demora en días** (`lead_time_days`).
La demora se usa para calcular el mínimo de alerta y la urgencia de la OC.
Cargá primero los proveedores: los productos se pueden asociar a uno.

### Paso 2 — Productos

| Campo | Qué cargar |
|---|---|
| Nombre | Como lo buscás en el POS |
| Código | Código de barras (opcional, se escanea) |
| Categoría | Para filtrar y reportar |
| Tipo | **Unidad** o **kg**. Define si acepta decimales |
| Costo | Último costo. El ingreso lo corrige con el costo real |
| Mayorista / Minorista | Precios de venta según lista |
| Stock inicial | Solo en el alta (ver Paso 3) |
| Stock objetivo (mínimo) | **Nivel al que querés volver al reponer**. También dispara la alerta de bajo stock |
| Vencimiento | Opcional, para control de lotes |

`Stock objetivo` cumple dos papeles: es el umbral de alerta **y** el nivel
objetivo. Si lo cargás como "solo alarma" (ej. 2), el sistema nunca te va a
sugerir reponer más de 2. Regla práctica: ventas por día × (días de entrega +
días entre pedidos), con un colchón del 10–20 %.

### Paso 3 — Stock inicial (dos caminos)

**A. Alta rápida** — ponés el stock en el formulario del producto.
Genera un movimiento `import` con motivo "Stock inicial". Sirve para arrancar
sin detalle de factura.

**B. Ingreso de mercadería (recomendado)** — creás el producto con stock 0 y
cargás la factura en **Ingreso de mercadería** con costo real, lote y
vencimiento. Al confirmar:

- suma stock en `inventory` y deja el movimiento `purchase`;
- actualiza `products.cost_price` con el costo real.

### Paso 4 — Clientes (opcional)

Se pueden cargar desde el POS en el momento de la venta.

### Paso 5 — Operación diaria

- **POS**: venta, ticket, medios de pago. Descuenta stock al confirmar.
- **Cierre de caja**: por día, sin apertura previa. Compara esperado vs contado.
- **Compras**: orden → enviar por WhatsApp → recibir → ingreso.

---

## 3. Prueba de humo (15 minutos, antes de cargar todo)

1. Crear producto de prueba: costo 1.000, minorista 1.500, stock 10, mínimo 3.
2. Vender 2 en el POS → stock 8 y venta en Historial.
3. Ajustar −1 con motivo → stock 7 y movimiento con la nota.
4. Cierre de caja del día → diferencia 0.
5. Crear proveedor → OC de 5 → Enviar.
6. Recibir 3 → la OC debe mostrar **faltaron 2 ($2.000,00)**.
7. `supabase/verificar_faltantes.sql` → `pedido 5 / recibido 3 / faltante 2`.
8. Borrar el producto y el proveedor de prueba desde la app.

Si los 8 pasos salen bien, ya podés cargar el catálogo real.

---

## 4. Reglas de oro

- **El stock se mueve solo desde la app**: POS, ingresos, ajustes, transferencias.
  Nunca editar `products` ni `inventory` a mano en Supabase.
- `products.stock_quantity` es **derivado** de `inventory` (trigger).
  Si dudás, `verificar_arranque.sql` → `stock desincronizado = 0`.
- El total de la **OC es estimado**; el **ingreso guarda el real** y corrige
  `products.cost_price`.
- Si falta mercadería, el borrador del ingreso se edita antes de confirmar:
  la OC queda con el faltante registrado.
- La numeración avanza y **no se reutiliza**: si cancelás una venta u OC,
  queda el hueco (es correcto).
- Un solo usuario admin (`nekrok22k@gmail.com`). Los demás usuarios se crean
  desde la app y entran como **vendedor**; el rol se cambia en Usuarios.

## 5. Respaldos

- Supabase → Database → Backups (según plan).
- Antes de cualquier cambio grande, exportar las tablas principales o sacar
  un backup manual.
- No hace falta correr `backup_automatico.sql` para operar.
