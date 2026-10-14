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
}

export interface CartItem {
  product: Product;
  quantity: number;
  priceType: 'wholesale' | 'retail';
  discount: number;
}
