# Prueba desde cero — procedimiento completo

Prueba integral de la app antes de usarla en producción. Duración estimada:
**90 minutos**. Se hace una vez con datos de demo, se verifica que los números
cierren y recién después se cargan los datos reales.

> **Cuenta única:** `nekrok22k@gmail.com` (rol **admin**).
> Estado de partida: base operativa vacía, configuración cargada y numeración
> en 1. Si algo se desordena, se vuelve al bloque 0.

---

## 0. Preparación (10 min)

### 0.1 Limpieza

1. En la app: **cerrar sesión**.
2. DevTools (F12) → Application → **Clear site data**.
   Esto borra IndexedDB `dietetica-offline`: si quedó una venta en cola, no se
   reenvía después del reset.
3. SQL Editor → pegar y ejecutar `supabase/reset_app_prueba.sql`.
4. SQL Editor → pegar y ejecutar `supabase/dejar_solo_admin.sql`.
5. SQL Editor → pegar y ejecutar `supabase/verificar_arranque.sql`.

Esperado en el paso 5 (una sola tabla):

| Chequeo | Valor |
|---|---|
| usuarios | 1 |
| perfiles admin | 1 |
| email admin | nekrok22k@gmail.com |
| ubicaciones | 1 (`Local principal`) |
| medios de pago | 3 |
| productos / ventas / ingresos / OC | 0 |
| stock desincronizado | 0 |
| próximo ticket / OC / ingreso | 1 |

> Si `usuarios` no es 1 o `email admin` no es el tuyo, **parar acá** y revisar
> Authentication → Users antes de seguir.

### 0.2 Entrada

1. Abrir la app y entrar con `nekrok22k@gmail.com`.
2. Confirmar que arriba a la derecha figura el rol **admin**.
3. `Ctrl+Shift+R` para descartar el bundle viejo del service worker.
4. Si aparece el tour de bienvenida, decidir: hacerlo o saltearlo. Para
   repetirlo más adelante: consola → 
   `localStorage.removeItem('dv-onboarding-progress-v1')`.

### 0.3 Catálogo de demo (opcional, recomendado)

Para que los números de esta guía coincidan, cargar el catálogo de prueba:

- SQL Editor → `supabase/demo_catalogo.sql`.

Crea el proveedor **Distribuidora del Norte** y 7 productos con stock 0.
Después, en la Fase 2, se da de alta un producto a mano para probar ese flujo.

> Si preferís probar con tus productos reales, salteá este paso y usá tus
> propios números. El resto del procedimiento es igual.

---

## 1. Configuración (10 min)

**Pantalla:** Configuración (solo admin).

| Campo | Qué probar | Resultado esperado |
|---|---|---|
| Nombre / CUIT / Dirección / Teléfono | Guardar datos del negocio | Se guardan y sobreviven a un refresh |
| WhatsApp del negocio | `5491123456789` | Se usa para enviar copia de tickets |
| Pie del ticket | Texto libre | Aparece en el ticket impreso |
| Punto de venta | `0001` | Se usa en la numeración del comprobante |
| Meta diaria de ventas | Ej. `150000` | El Panel muestra el avance de la meta |
| Horario de la meta | Apertura / cierre | El Panel calcula el ritmo del día |
| Mercado Pago (opcional) | Access Token / Public Key | Si no lo vas a usar, dejar vacío |

**Verificación:** recargar la página (F5) y comprobar que los datos siguen.

> Mercado Pago y la terminal Point se prueban aparte, con credenciales reales.
> Si no están configuradas, el POS sigue funcionando con efectivo,
> transferencia y tarjeta manual.

---

## 2. Catálogo y stock inicial (20 min)

### 2.1 Proveedores

**Pantalla:** Productos / Stock → Proveedores.

1. Crear un proveedor nuevo: nombre, teléfono y **días de entrega** (ej. 5).
2. Verificar que aparece en la lista y que se puede editar.

Los días de entrega se usan para el mínimo de alerta y la urgencia de la OC.

### 2.2 Alta manual de producto

**Pantalla:** Productos / Stock → **Nuevo Producto**.

Cargar:

| Campo | Valor |
|---|---|
| Nombre | `Crema de Maní 500 g` |
| Código de barras | `7790001000080` |
| Categoría | `Frutos Secos` |
| Tipo de venta | `Por Unidad` |
| Costo | `3800` |
| Mayorista | `5500` |
| Minorista | `7200` |
| Stock inicial | `0` |
| Stock objetivo (mínimo) | `4` |
| Proveedor | `Distribuidora del Norte` |

**Resultado esperado:** el producto se crea con **stock 0** y etiqueta de sin
stock. Es intencional: el stock entra por un ingreso, no por el formulario.

> El campo **Stock objetivo (mínimo)** cumple dos funciones: es el umbral de
> alerta (`stock <= mínimo` → crítico) y el nivel al que se quiere volver al
> reponer. Elegí un número que cubra los días de entrega del proveedor.

### 2.3 Ingreso de mercadería

**Pantalla:** Ingreso Mercadería → **Nuevo ingreso**.

1. Proveedor: `Distribuidora del Norte`.
2. Agregar las 7 líneas con cantidad y costo.
3. **Confirmar**.

| Producto | Cantidad | Costo unitario | Subtotal |
|---|---:|---:|---:|
| Almendras Non Pareil | 6 kg | 9.000 | 54.000 |
| Nueces Mariposa | 5 kg | 11.000 | 55.000 |
| Maní Salado | 7 kg | 3.500 | 24.500 |
| Girasol Pelado | 5 kg | 2.800 | 14.000 |
| Lentejas | 7 kg | 2.400 | 16.800 |
| Avena Instantánea | 7 kg | 1.900 | 13.300 |
| Miel Pura 500 g | 13 u | 4.200 | 54.600 |
| **Total** | | | **255.000** |

**Resultado esperado:**

- Queda `ING-000001` **confirmado**.
- El stock se suma recién ahora.
- `products.cost_price` queda con el costo real ingresado.
- En Productos: 8 productos, **0 bajo mínimo**.

> Probar también el borrador: crear un ingreso, agregar una línea y **no
> confirmar**. Debe quedar como borrador y no tocar el stock hasta confirmar.

---

## 3. Punto de venta (20 min)

**Pantalla:** Venta Rápida (POS). Hacer estas cuatro ventas en orden.

| # | Carrito | Pago | Total | Detalle |
|---|---|---|---:|---|
| 1 | 3 kg Almendras + 1 Miel | Efectivo | 52.800 | paga con 55.000 → vuelto 2.200 |
| 2 | 2 kg Nueces + 2 kg Maní | Transferencia | 49.000 | banco + titular + nº de operación |
| 3 | 1 Miel | Tarjeta | 7.800 | **anular después** |
| 4 | 0,350 kg Girasol | Efectivo | 1.820 | venta por peso |

### Qué mirar en cada venta

- **Búsqueda:** por nombre y por código de barras + Enter.
- **Peso:** en un producto por kg, tocar la cantidad y escribir `0.35`.
- **Descuento:** aplicar un 5 % en una venta y verificar el total.
- **Ticket:** se abre la vista de cobro con número, detalle, vendedor y pago.
- **WhatsApp:** enviar el ticket a un número de prueba (o mostrar el texto
  generado si no querés abrir WhatsApp).
- **Imprimir / PDF:** imprimir o descargar el comprobante.
- **Multiticket:** dejar una venta “en espera”, iniciar otra y recuperarla.
- **Atajos:** `Ctrl+H` muestra la ayuda; `F8` lector físico, `F9` balanza,
  `F12` cobrar.
- **Escáner:** si tenés cámara, escanear un código y ver que suma al carrito.

### Anular la venta 3

En “Últimos tickets” → **anular**. La venta queda como anulada (no se borra),
devuelve el stock y sale de los totales del día.

**Verificación:**

- Tickets 1, 2 y 4 completados; ticket 3 anulado.
- Almendras 3 kg (mínimo 5), Nueces 3 kg (mínimo 4), Maní 5 kg (mínimo 6):
  los tres quedan en alerta.
- Miel vuelve a 12 unidades.

---

## 4. Cierre de caja (5 min)

**Pantalla:** Cierre de Caja → fecha de hoy.

| Concepto | Valor esperado |
|---|---:|
| Ventas | 3 |
| Total | 103.620 |
| Efectivo esperado | 54.620 |
| Transf. + Tarjeta + MP | 49.000 |

1. Tocar **Usar esperado** o escribir `54620` como contado real.
2. Guardar el cierre.
3. **Diferencia: $0 · Cuadra.**

**Probar el descuadre:** cambiar el contado a `54000`, guardar y ver que la
diferencia figure en ámbar (faltante). Después corregir a `54620` y volver a
guardar: debe actualizar el mismo cierre del día, no crear otro.

---

## 5. Compras: OC → envío → recepción con faltante (15 min)

**Pantalla:** Ordenes de Compra.

1. **Generar orden**: el modal lista los productos bajo objetivo.
2. Marcar Almendras, Nueces y Maní.
3. Usar el modo **Manual** y escribir: Almendras `2`, Nueces `1`, Maní `1`.
   Total estimado: **32.500**.
4. **Generar orden** → `OC-000001` en borrador.
5. **Enviar** → abre WhatsApp con el detalle para el proveedor.
6. **Recibir** → crea el borrador de ingreso y navega a Ingreso Mercadería.
7. En el borrador, bajar **Almendras de 2 a 1** (llegó menos).
8. **Confirmar** el ingreso.

**Resultado esperado:**

- `ING-000002` confirmado.
- La OC queda **recibida** y muestra el comparativo `32.500 → 23.500` en
  ámbar (salió más barato que lo estimado).
- Tarjeta de faltante: **faltaron 1 kg ($9.000)**.
- Por línea: Almendras pedido 2 / recibido 1 / faltante 1.
- El costo real del ingreso reemplaza al estimado en `products.cost_price`.

**Verificación en SQL Editor:**

- `supabase/verificar_faltantes.sql` → una fila de Almendras con
  `pedido 2 / recibido 1 / faltante 1 / costo_faltante 9000`.
- `supabase/verificar_demo.sql` → `OC estimado 32500`, `OC real 23500`,
  `faltante 1`.

**Stock final:** Almendras 4, Nueces 4, Maní 6. Los tres quedan justo en el
umbral de alerta. Eso es correcto: el sistema no “arregla” el faltante solo.

---

## 6. Ajustes y transferencias (5 min)

### 6.1 Ajuste de stock

En Productos → menú del producto → **Ajuste de stock**.

1. Ajustar Girasol en `-0.5` con motivo “Merma”.
2. Verificar: stock 4,15 y movimiento con el motivo.

Probar también un ajuste positivo y uno a cero (debe rechazarse).

### 6.2 Transferencia entre ubicaciones

Solo si hay 2 ubicaciones cargadas (Configuración → Ubicaciones).

1. Ingreso Mercadería → **Transferir**.
2. Origen `Local principal`, destino la otra ubicación, cantidad `1`.
3. Verificar: baja en origen, alta en destino, dos movimientos
   (`transfer_out` / `transfer_in`).

Si tenés una sola ubicación, este paso se saltea.

---

## 7. Historial y reportes (10 min)

### 7.1 Pedidos & Historial

- Filtrar por fecha, medio de pago, estado y vendedor.
- Buscar por `#ticket`, cliente, producto o monto.
- Ver la venta anulada y reimprimir un ticket.
- Exportar el listado (Excel/CSV).
- Abrir el detalle de una venta y ver el desglose de pago.

### 7.2 Reportes de Ganancias

Rango de hoy:

| Concepto | Valor esperado |
|---|---:|
| Tickets | 3 |
| Facturación | 103.620 |
| Costo | 61.180 |
| Ganancia bruta | 42.440 |
| Margen bruto | ≈ 41 % |

1. Cargar un gasto de prueba: `10.000`, descripción “Prueba”.
2. Verificar: ganancia neta `32.440` y margen neto ≈ 31 %.
3. Exportar **CSV** y **PDF**.
4. Eliminar el gasto de prueba.

### 7.3 Panel Principal

- KPIs del día: tickets, facturación, ganancia.
- Meta diaria: avance y ritmo.
- Stock crítico: debe listar Almendras, Nueces y Maní.
- Accesos rápidos y checklist de inicio.

---

## 8. Usuarios y roles (5 min)

**Objetivo:** probar que un vendedor no puede hacer tareas de admin.

1. Cerrar sesión → **Crear cuenta** con un correo de prueba.
   > Si Supabase pide confirmación por email, confirmala desde
   > Authentication → Users antes de entrar.
2. Entrar con esa cuenta: el perfil se crea como **vendedor**.
3. Verificar que **no** ve Configuración, Usuarios ni Reportes.
4. Volver a entrar como admin → Usuarios y Actividad:
   - cambiar el rol del usuario de prueba a **supervisor** y después a
     **vendedor**;
   - abrir “Actividad” y ver sus ventas/movimientos.
5. Probar que un vendedor **no** puede borrar productos ni cambiar roles.

**Al terminar:** ejecutar `supabase/dejar_solo_admin.sql` para borrar el
usuario de prueba y dejar únicamente `nekrok22k@gmail.com` como admin.

---

## 9. Modo offline (opcional, 5 min)

1. Entrar al POS con los productos ya cargados.
2. DevTools → Network → **Offline**.
3. Hacer una venta en efectivo.
4. Verificar: la venta queda en cola y aparece el indicador de sincronización.
5. Volver a **Online** y esperar: la venta se sincroniza y descuenta stock.
6. Repetir la venta **no** debe duplicarse (idempotencia).

> Si algo falla acá, anotarlo: el modo offline es el punto más delicado y no
> bloquea el uso online.

---

## 10. Cierre de la prueba

### 10.1 Verificación final

SQL Editor → `supabase/verificar_demo.sql`. Esperado:

| Chequeo | Valor |
|---|---|
| ventas completadas | 3 |
| ventas anuladas | 1 |
| total vendido | 103620.00 |
| efectivo | 54620.00 |
| transferencia | 49000.00 |
| tarjeta | 0.00 |
| productos | 8 |
| bajo mínimo | 3 |
| stock desincronizado | **0** |
| última OC | OC-000001 · received |
| OC estimado → real | 32500 → 23500 |
| OC faltante | 1 |

Si `stock desincronizado` no es 0, **no tocar nada**: avisar y revisar antes
de seguir.

### 10.2 Dos caminos

**A. Si la prueba salió bien y vas a cargar datos reales:**

1. Cerrar sesión y limpiar site data.
2. `supabase/reset_app_prueba.sql`.
3. `supabase/dejar_solo_admin.sql`.
4. Seguir `docs/PUESTA_EN_MARCHA.md` (orden de carga real).

**B. Si querés repetir la prueba:**

1. `supabase/reset_app_prueba.sql`.
2. `supabase/demo_catalogo.sql`.
3. Volver a la Fase 1.

> A partir de la carga real **no** volver a correr `reset_app_prueba.sql`,
> `reset_modulo_compras.sql`, `limpiar_*` ni `prueba_compras_cleanup.sql`.

---

## Anexo: registro de resultados

Copiá esta tabla y anotá cada bloque. Sirve para saber dónde falló sin
repetir todo.

| Fase | Resultado | Observaciones |
|---|---|---|
| 0. Preparación | ✅ / ❌ | |
| 1. Configuración | ✅ / ❌ | |
| 2. Catálogo y stock | ✅ / ❌ | |
| 3. POS | ✅ / ❌ | |
| 4. Caja | ✅ / ❌ | |
| 5. Compras + faltante | ✅ / ❌ | |
| 6. Ajustes / transferencias | ✅ / ❌ | |
| 7. Historial y reportes | ✅ / ❌ | |
| 8. Usuarios y roles | ✅ / ❌ | |
| 9. Offline | ✅ / ❌ / no probado | |
| 10. Verificación final | ✅ / ❌ | |

## Anexo: problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Email not confirmed` | Usuario sin confirmar | `dejar_solo_admin.sql` o confirmar en Authentication |
| Entra como vendedor | Perfil desactualizado | `UPDATE profiles SET role='admin' WHERE email=...` |
| Aparecen ventas viejas | Cola en IndexedDB | Clear site data y volver a entrar |
| El POS no deja cobrar | Stock insuficiente | Cargar ingreso o ajustar stock |
| La OC no muestra el faltante | Ingreso sin confirmar | Confirmar el ingreso |
| Números que no coinciden | Se saltó un paso | No improvisar: revisar `verificar_demo.sql` y resetear |
