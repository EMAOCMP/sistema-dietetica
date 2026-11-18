# Estructura: Nueva Orden de Compra (Manual)

Diseño propuesto para agregar la creación manual de una orden de compra (además de la generación automática por reposición), reutilizando las tablas y RPCs ya existentes en Supabase.

## 1. Modelo de Datos (ya existente — no requiere cambios SQL)

### `purchase_orders`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID PK | |
| `order_number` | TEXT UNIQUE | Numeración automática (secuencia `purchase_order_seq`) |
| `supplier_id` | UUID FK → suppliers | Null = "Sin proveedor" |
| `supplier_name` | TEXT | Denormalizado para mostrar sin join |
| `status` | TEXT | `draft` / `sent` / `received` / `cancelled` |
| `expected_date` | DATE | Fecha esperada de entrega (opcional) |
| `notes` | TEXT | Observaciones |
| `total_cost` | NUMERIC(12,2) | Suma de `quantity * unit_cost` |
| `created_by` | UUID FK → auth.users | |
| `created_at` / `updated_at` / `sent_at` / `received_at` | TIMESTAMPTZ | |
| `receipt_id` | UUID FK → stock_receipts | Se completa al recibir |

### `purchase_order_items`
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID PK | |
| `order_id` | UUID FK → purchase_orders (CASCADE) | |
| `product_id` | UUID FK → products | |
| `quantity` | NUMERIC(12,3) > 0 | Cantidad a pedir |
| `qty_replenish` / `qty_suggested` | NUMERIC | Solo informativos (auto) |
| `unit_cost` | NUMERIC(12,2) | Costo unitario estimado |
| `received_quantity` | NUMERIC(12,3) | Se actualiza al recibir |

RLS: select a usuarios autenticados; insert/update/delete solo `admin` y `supervisor`.

## 2. RPCs disponibles (supabase/purchase_orders.sql)

- `create_purchase_order(p_supplier_id UUID, p_supplier_name TEXT, p_notes TEXT, p_items JSONB)` → crea en `draft` con items y `total_cost` calculado.
- `update_purchase_order(p_order_id UUID, p_notes TEXT, p_items JSONB)` → reemplaza items y recalcula total (solo `draft`).
- `send_purchase_order(p_order_id UUID)` → pasa a `sent`, setea `sent_at`.
- `cancel_purchase_order(p_order_id UUID)` → pasa a `cancelled`.
- `convert_purchase_order_to_receipt(p_order_id UUID)` → genera `stock_receipt` (recepción) y marca `received`.
- `mark_purchase_order_received(p_order_id UUID, p_receipt_id UUID)` → marca recibida con receipt asociado.

`p_items` es un array JSONB: `[{ product_id, quantity, qty_replenish?, qty_suggested?, unit_cost? }]`.

## 3. UI propuesta: Modal "Nueva orden de compra"

### Ubicación
Botón `+ Nueva orden` en la cabecera de `PurchaseOrdersView`, junto a "Generar por reposición". Abre un modal (`ModalShell`).

### Layout del modal
1. **Cabecera**: título "Nueva orden de compra" + botón cerrar.
2. **Proveedor** (SelectMenu, con opción "Sin proveedor"): al seleccionar, filtrar productos por `supplier_id` si existe; si no, mostrar todos.
3. **Fecha esperada** (input date, opcional).
4. **Tabla de ítems** (editable):
   - Columna Producto (buscador + lista filtrada, como en StockIntake).
   - Cantidad (numérico, respeta unidad: `unit` entero, `kg` 2 decimales).
   - Costo unitario (numérico, pre-cargado desde `products.cost_price`, editable).
   - Subtotal (`quantity * unit_cost`).
   - Acción: quitar fila.
   - Botón "+ Agregar producto".
5. **Notas** (textarea).
6. **Footer**: Total estimado + botones:
   - "Guardar borrador" → `create_purchase_order` con status draft.
   - "Guardar y enviar" → crear draft + `send_purchase_order` + abrir WhatsApp (si hay teléfono).
   - "Cancelar".

### Validaciones
- Al menos 1 ítem con cantidad > 0.
- No duplicar el mismo producto en la orden (sumar o bloquear).
- Proveedor opcional; si se elige, sugerir sus productos primero.

## 4. Estado y datos necesarios (frontend)

- `suppliers` (activos) — ya se cargan en `PurchaseOrdersView`.
- `products` activos con `id, name, unit_type, cost_price, stock_quantity, supplier_id` (fetch on demand).
- `costMap` / `unitMap` ya existen; reutilizar.

### Nuevo estado sugerido en `PurchaseOrdersView`
```ts
const [showNewOrder, setShowNewOrder] = useState(false);
const [newOrderSupplier, setNewOrderSupplier] = useState<string | null>(null);
const [newOrderExpected, setNewOrderExpected] = useState('');
const [newOrderNotes, setNewOrderNotes] = useState('');
const [newOrderItems, setNewOrderItems] = useState<Array<{
  product_id: string; product_name: string; unit_type: string;
  quantity: number; unit_cost: number | null;
}>>([]);
const [savingNewOrder, setSavingNewOrder] = useState(false);
const [productSearch, setProductSearch] = useState('');
```

## 5. Flujo de creación

```
1. Usuario abre modal "Nueva orden".
2. Selecciona proveedor (opcional) y fecha esperada.
3. Busca/agrega productos → filas con cantidad y costo.
4. Click "Guardar borrador":
   a. Llama create_purchase_order({ p_supplier_id, p_supplier_name, p_notes, p_items })
   b. Cierra modal, notify éxito, fetchOrders().
5. Click "Guardar y enviar":
   a. Igual que (4) para crear draft.
   b. Llama send_purchase_order({ p_order_id }).
   c. Si el proveedor tiene teléfono, abre WhatsApp con el detalle.
   d. fetchOrders().
```

## 6. Integración con la vista existente

- Reutilizar `SelectMenu` (ya creado) para el selector de proveedor y el buscador de productos (patrón de `StockIntakeView`).
- Reutilizar `ModalShell` para el modal.
- Tras crear, la orden aparece en la lista con status `draft` y se puede editar/enviar/recibir con los handlers ya existentes (`handleSend`, `handleReceive`, etc.).
- Si el usuario ya tenía el modal de "Generar por reposición", ambos conviven: el botón "+ Nueva orden" es manual, "Generar por reposición" es automático.

## 7. Archivos a tocar (cuando se implemente)

- `src/components/views/PurchaseOrdersView.tsx` — agregar estado, handlers `handleCreateManualOrder`, y JSX del modal.
- `src/components/ui/ModalShell.tsx` — reutilizar (sin cambios).
- `src/components/ui/SelectMenu.tsx` — reutilizar.
- `src/types.ts` — sin cambios (tipos ya existen).
- SQL: sin cambios (tablas y RPCs ya existen).

## 8. Consideraciones

- Validar que `quantity > 0` y `unit_cost >= 0`.
- Redondeo: `unit` → `Math.ceil`, `kg` → 2 decimales (igual que `roundQtyForUnit`).
- Si no hay proveedor, `supplier_id = null` y `supplier_name = 'Sin proveedor'`.
- El `total_cost` lo calcula el RPC; no enviarlo desde el frontend.
- Mantener la preferencia de "proveedor por defecto" en localStorage (opcional, como `dv-po-prefs`).
