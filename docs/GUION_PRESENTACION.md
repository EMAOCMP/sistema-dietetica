# Guion de presentación — Dietética Vishal

Demo del circuito real: **comprar → stock → vender → cobrar → reponer**.
El objetivo no es mostrar pantallas: es que los números cierren en vivo.

- **Versión corta: 12 minutos** (la que se usa si hay poco tiempo).
- **Versión completa: 25–30 minutos** (actos 1 a 6).
- **Audiencia:** dueño/a del local y personas que van a usar la app.
- **Cuenta:** `nekrok22k@gmail.com` (admin).

> Antes de presentar, hacer la prueba completa una vez con
> `docs/PRUEBA_DESDE_CERO.md` y después resetear. Nunca presentar con datos
> de una prueba a medio hacer.

---

## Checklist 20 minutos antes

- [ ] `npm run dev` levantado, o el deploy abierto y logueado.
- [ ] Login con `nekrok22k@gmail.com` y **cerrar sesión de otras pestañas**.
- [ ] Base reseteada + `supabase/demo_catalogo.sql` aplicado.
- [ ] Pantalla en 100 % de zoom, tema claro, notificaciones de Windows en
      “No molestar”.
- [ ] WhatsApp Web abierto en otra pestaña (para el paso “Enviar”).
- [ ] Este guion y la tabla de números a mano.
      Versión de una página para imprimir: `docs/HOJA_DEMO.pdf`
      (o abrir `docs/HOJA_DEMO.html` y Ctrl + P).
- [ ] Tour de bienvenida: decidir si se muestra o se saltea
      (`localStorage.removeItem('dv-onboarding-progress-v1')`).

**Datos que tienen que existir antes de empezar:** 7 productos de demo con
stock 0, 1 proveedor (`Distribuidora del Norte`) y los medios de pago
Efectivo / Transferencia / Tarjeta.

---

## Modo “mostrar la jornada ya cargada” (datos del 13/11)

Alternativa a hacer todo en vivo: se presenta la jornada que ya está
registrada y se recorre lo que quedó guardado. Sirve cuando no querés tocar
datos antes de la reunión.

**Regla:** los filtros de fecha abren en **hoy**, así que hay que llevar cada
pantalla al **13/11/2026**.

| Pantalla | Filtro a elegir | Tiene que mostrar |
|---|---|---|
| Cierre de caja | fecha **13/11/2026** | 3 ventas · 103.620 · contado 54.620 · diferencia **0** |
| Pedidos & Historial | **Mes** (o Personalizado 13/11 → 13/11) | 4 tickets, uno **anulado** |
| Reportes | **Día 13/11** (o **Mes** de noviembre) | 3 tickets · 103.620 · ganancia 42.440 · margen 41 % |
| Órdenes de Compra | sin filtro de fecha | `OC-000001` recibida · 32.500 · `OC-000002` recibida con faltante · real 23.500 |
| Ingreso Mercadería | sin filtro de fecha | `ING-000001` 255.000 · `ING-000002` 32.500 · `ING-000003` 23.500 |
| Productos / Stock | — | 3 bajo objetivo: Almendras 3/5, Nueces 3/4, Maní 5/6 |
| Panel Principal | **Mes** | facturación, ganancia y stock del período |

**Qué sí se puede hacer en vivo sin romper el cierre:** generar una orden de
compra nueva (`OC-000003`), enviarla y recibirla con faltante. Eso mueve
stock, no caja. Ya quedan dos órdenes de ejemplo: `OC-000001` recibida
completa y `OC-000002` recibida con faltante de 1 unidad.

**Qué NO conviene hacer en vivo:** ventas nuevas. Quedan con fecha de hoy y no
entran en el cierre del 13/11, que ya está guardado; el “esperado” de la caja
deja de coincidir con lo que se muestra.

**Decir al abrir cada pantalla:**
> “Esto es una jornada real del local: entró mercadería, se vendió por tres
> medios, se cerró la caja y se repuso lo que faltaba. Miren los números.”

---

## Versión de 12 minutos

| Min | Acto | Qué se muestra | Números |
|---:|---|---|---|
| 0–1 | Apertura | Panel Principal | Todo en 0: es una base nueva |
| 1–4 | Entra mercadería | Alta de producto + ingreso confirmado | `ING-000001` · total 255.000 |
| 4–8 | Se vende y se cobra | 3 ventas: efectivo, transferencia, peso | 103.620 cobrados |
| 8–9 | Cierra la caja | Esperado vs contado | Diferencia 0 |
| 9–11 | Se repone | OC → recibir con faltante | 32.500 → 23.500 · faltan 9.000 |
| 11–12 | Cierre | Reportes + Panel | Ganancia 42.440 · margen 41 % |

**Regla de oro de la versión corta:** una venta por cada medio de pago, una
recepción con faltante y el reporte. Nada más.

---

## Acto 0 · Apertura (1 min)

**Pantalla:** Panel Principal.

**Decir:**
> “Esto no es un sistema de facturación con un stock pegado al costado.
> Es el negocio en una pantalla: qué entró, qué salió, qué falta comprar y
> cuánta plata debería haber en la caja. Lo vamos a recorrer en el mismo
> orden en que pasa en el local.”

**Mostrar:** los KPIs en 0, la lista de stock bajo (todos sin stock) y los
accesos rápidos. No tocar el checklist: se completa solo a medida que se
recorren las secciones.

---

## Acto 1 · La mercadería entra (3 min)

### 1.1 Alta de producto

**Pantalla:** Productos / Stock → **Nuevo Producto**.

Cargar `Crema de Maní 500 g` (código `7790001000080`, costo 3.800,
mayorista 5.500, minorista 7.200, mínimo 4, proveedor Distribuidora del
Norte). Guardar.

**Decir:**
> “El alta no carga stock. El stock no es un número que se escribe: es la
> consecuencia de un ingreso. Por eso recién creado figura en cero.”

**Mostrar:** el producto aparece con stock 0 y etiqueta de “sin stock”.

### 1.2 Ingreso de mercadería

**Pantalla:** Ingreso Mercadería → **Nuevo ingreso**.

1. Proveedor: Distribuidora del Norte.
2. Agregar estas líneas (para la demo alcanza con 3 o 4; el total completo
   es el de la tabla).
3. **Confirmar**.

| Producto | Cantidad | Costo | Subtotal |
|---|---:|---:|---:|
| Almendras | 6 kg | 9.000 | 54.000 |
| Nueces | 5 kg | 11.000 | 55.000 |
| Maní | 7 kg | 3.500 | 24.500 |
| Girasol | 5 kg | 2.800 | 14.000 |
| Lentejas | 7 kg | 2.400 | 16.800 |
| Avena | 7 kg | 1.900 | 13.300 |
| Miel 500 g | 13 u | 4.200 | 54.600 |
| Crema de Maní | 6 u | 3.800 | 22.800 |
| **Total** | | | **255.000** |

**Decir:**
> “Mientras está en borrador no toca el stock: se puede revisar. Al
> confirmar, en una sola operación se suma el stock, se registra el
> movimiento y se actualiza el costo real del producto. Queda `ING-000001`.”

**Mostrar:** volver a Productos y ver el stock ya cargado.

---

## Acto 2 · La mercadería sale (4 min)

**Pantalla:** Venta Rápida (POS).

### Venta 1 — efectivo, con vuelto

3 kg de Almendras + 1 Miel = **52.800**. Pago efectivo, paga con 55.000,
vuelto 2.200. Cobrar.

**Decir:**
> “El ticket sale con el detalle, el vendedor y el medio de pago. El stock
> baja en el momento, no en un cierre posterior.”

### Venta 2 — transferencia

2 kg Nueces + 2 kg Maní = **49.000**. Transferencia, con banco y número de
operación.

**Decir:**
> “Los datos del pago quedan guardados con la venta. El cierre de caja no
> depende de que alguien se acuerde cuánto entró por transferencia.”

### Venta 3 — por peso

0,350 kg de Girasol = **1.820**, efectivo.

**Decir:**
> “Granel se vende por kilo, con decimales. No hay que cargar un producto
> distinto por cada peso que se corta.”

**Cierre del acto:** mostrar en Productos los tres productos en alerta
(Almendras 3, Nueces 3, Maní 5).

> Si querés mostrar la anulación: vender 1 Miel con tarjeta y anularla desde
> “Últimos tickets”. Se devuelve el stock y la venta queda en el historial
> como anulada, no se borra. Suma 1 minuto.

---

## Acto 3 · El día cierra (1 min)

**Pantalla:** Cierre de Caja → hoy.

| Concepto | Valor |
|---|---:|
| Ventas | 3 |
| Total | 103.620 |
| Efectivo esperado | 54.620 |
| Transf. + Tarjeta + MP | 49.000 |

Tocar **Usar esperado** y guardar. Diferencia **0 · Cuadra**.

**Decir:**
> “El sistema arma el esperado por medio de pago. Vos contás el efectivo y
> la diferencia queda registrada. No hay que sumar tickets a mano ni
> acordarse de la transferencia.”

---

## Acto 4 · Reposición: la compra que se sugiere (2 min)

**Pantalla:** Ordenes de Compra.

1. **Generar orden**: el modal lista lo que está bajo objetivo.
2. Marcar Almendras, Nueces y Maní.
3. Modo **Manual**: Almendras `2`, Nueces `1`, Maní `1`.
4. **Generar orden** → `OC-000003` en borrador.
5. **Enviar** → se arma el WhatsApp con el detalle para el proveedor.
6. **Recibir** → crea el ingreso y navega a Ingreso Mercadería.
7. En el borrador, bajar **Almendras de 2 a 1** (llegó menos).
8. **Confirmar**.

**Decir (mientras selecciona):**
> “El sistema ordena por urgencia: cruza stock, objetivo, demanda y demora
> del proveedor. No compra solo; propone y vos decidís. La orden queda en
> borrador hasta que la enviás.”

**Decir (al recibir con faltante):**
> “Llegó menos de lo pedido. Se carga lo que llegó de verdad, no lo que
> figuraba en la orden. Por eso la OC muestra `32.500 → 23.500` y
> `faltaron 1 kg ($9.000)`. El costo real reemplaza al estimado.”

**Mostrar:** la OC recibida con el comparativo en ámbar y la tarjeta del
faltante. Después, en Productos: los tres quedan justo en el mínimo.

**Frase de cierre del acto:**
> “El faltante no desaparece: queda visible. Es la diferencia entre un
> sistema que ‘asume que llegó todo’ y uno que muestra la verdad.”

---

## Acto 5 · Los números (1 min)

### Historial

**Pantalla:** Pedidos & Historial. Mostrar filtros por fecha/medio/estado,
la venta anulada (si se hizo) y la reimpresión del ticket.

### Reportes

**Pantalla:** Reportes de Ganancias → rango de hoy.

| Concepto | Valor |
|---|---:|
| Tickets | 3 |
| Facturación | 103.620 |
| Ganancia bruta | **42.440** |
| Margen | ≈ **41 %** |

Exportar el CSV o PDF una vez (basta con abrir el menú y mostrar que existe).

**Decir:**
> “La ganancia no es facturación menos ‘algo’: se calcula con el costo real
> de cada producto vendido. Por eso el número del reporte sirve para tomar
> decisiones y no solo para mirar.”

---

## Acto 6 · Cierre (1 min)

**Pantalla:** Panel Principal.

**Decir:**
> “Recorrimos un día completo: entró mercadería, se vendió, se cobró por
> tres medios, se cerró la caja y se repuso lo que faltaba. Todo lo que
> vieron quedó registrado, con trazabilidad de quién hizo cada cosa.”

**Cerrar con los tres diferenciales:**

1. **El stock es consecuencia de los movimientos**, no un número editable a
   mano.
2. **El costo real manda**: la OC estima, la recepción corrige.
3. **Los faltantes se ven**: no se tapan para que el número cierre.

**Próximos pasos (elegir uno):**
- Cargar el catálogo real y el stock actual con un ingreso de apertura.
- Capacitar al equipo en POS y cierre de caja.
- Implementar “Recibir faltantes” para entregas en dos tandas.

---

## Preguntas probables

**“¿Y si no tengo internet?”**
> La venta se puede seguir haciendo: la app guarda en cola y sincroniza
> cuando vuelve la conexión. El indicador de sincronización está abajo a la
> derecha.

**“¿Puedo vender sin stock?”**
> No. El POS frena el cobro si no hay disponible. Para vender, primero
> cargás el ingreso. Es una decisión para que el stock no se ensucie.

**“¿Cuántos usuarios puedo crear?”**
> Los que necesites, con roles: admin, supervisor y vendedor. Los permisos
> se configuran en Usuarios y Actividad.

**“¿Reemplaza al sistema de facturación?”**
> Hoy el ticket es interno. La integración con ARCA está prevista, pero no
> la vendamos como lista: lo que sí resuelve hoy es stock, ventas, caja y
> reposición.

**“¿Qué pasa si me equivoco en un ingreso?”**
> Si está en borrador, se corrige o se descarta. Si ya está confirmado, se
> anula el ingreso y se vuelve a cargar; queda el movimiento para auditar.

**“¿Dónde veo cuánto gané?”**
> En Reportes de Ganancias, por período, con gastos descontados. La ganancia
> bruta usa el costo real congelado al momento de cada venta.

---

## Plan B

| Si pasa esto | Hacer esto |
|---|---|
| WhatsApp no abre | Mostrar el texto generado y seguir; el envío no es bloqueante. |
| Una venta queda mal | Anularla y volver a hacerla: el stock se revierte solo. |
| El POS no deja cobrar | Falta stock de ese producto: mostrar el mensaje y cargar un ingreso. |
| Se corta internet | Seguir con el acto 4 y 5; la cola sincroniza al volver. |
| Un número no coincide | No improvisar: decir “lo verifico y te confirmo” y correr `verificar_demo.sql` al final. |
| La OC no aparece | Verificar que haya productos bajo objetivo o usar el modo Manual. |

---

## Después de la demo

1. Correr `supabase/verificar_demo.sql` y guardar el resultado.
2. Si la demo se hizo con datos de prueba, resetear con
   `supabase/reset_app_prueba.sql`.
3. Anotar las objeciones y pedidos que surgieron: son el próximo backlog.

> Si la demo se hizo ya con datos reales, **no** resetear. Solo verificar.
