export type UserRole = 'admin' | 'supervisor' | 'vendedor';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  category: string | null;
  unit_type: 'unit' | 'kg';
  cost_price: number;
  wholesale_price: number;
  retail_price: number;
  stock_quantity: number;
  min_stock: number;
  is_active: boolean;
  created_at: string;
  expiry_date?: string | null;
  supplier_id?: string | null;
  image_url?: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
  /** Días que tarda en llegar el pedido. Se usa para el mínimo de alerta. */
  lead_time_days?: number | null;
}

export interface CartItem {
  product: Product;
  quantity: number;
  priceType: 'wholesale' | 'retail';
  discount: number;
}

export interface PurchaseOrderItem {
  id: string;
  order_id: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  qty_replenish: number;
  qty_suggested: number;
  unit_cost: number | null;
  received_quantity: number;
}

export interface PurchaseOrder {
  id: string;
  order_number: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  status: 'draft' | 'sent' | 'received' | 'cancelled';
  notes: string | null;
  total_cost: number;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  receipt_id: string | null;
  items_count?: number;
  total_qty?: number;
  items?: PurchaseOrderItem[];
  /** Número y total real del ingreso vinculado (solo lectura, para comparar). */
  receipt_number?: string | null;
  receipt_total?: number | null;
}

export interface ReplenishmentRow {
  product_id: string;
  product_name: string;
  supplier_id: string | null;
  stock: number;
  min_stock: number;
  avg_daily: number;
  sigma_daily: number;
  lead_time_days: number;
  safety_stock: number;
  rop: number;
  order_up_to: number;
  suggested: number;
  replenish: number;
  has_history: boolean;
}
