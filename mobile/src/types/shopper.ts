export interface Category {
  id: string;
  name: string;
  image_url?: string;
}
export interface Restaurant {
  id: string;
  name: string;
  description?: string;
  logo_url?: string;
  cover_image_url?: string;
  rating: number;
  delivery_fee: number;
  min_order_amount: number;
  is_open: boolean;
  country?: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  base_price: number;
  is_available?: boolean;
  prep_minutes?: number;
  store_id?: string;
  store_name?: string;
  store_logo?: string;
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
}

export interface ShopOrder {
  items: CartItem[];
  delivery_address: string;
  delivery_instructions?: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
}

export interface OrderItemRequest {
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  special_note?: string;
}

export interface CreateOrderRequest {
  restaurant_id: string;
  items: OrderItemRequest[];
  delivery_address: string;
  delivery_instructions?: string;
  delivery_fee?: number;
}

export interface OrderResponse {
  order_id: string;
  status: string;
  total_amount: number;
  delivery_fee: number;
}

export interface OrderItemResponse {
  id: string;
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  special_note?: string;
}

export interface OrderDetailResponse {
  order_id: string;
  status: string;
  subtotal: number;
  delivery_fee: number;
  total_amount: number;
  delivery_address: string;
  delivery_instructions?: string;
  created_at: string;
  items: OrderItemResponse[];
  paystack_reference?: string;
  paystack_url?: string;
}

export interface PaymentResponse {
  order_id: string;
  reference: string;
  checkout_url: string;
  payment_method: string;
}

export interface DeliveryOrderRequest {
  order_id: string;
  item_name: string;
  pickup_address: string;
  dropoff_address: string;
  package_description: string;
  vehicle_type: 'motorbike' | 'car' | 'bicycle';
}

export interface DeliveryAssignmentResponse {
  delivery_id: string;
  checkout_url: string;
  paystack_reference: string;
  status: string;
  rider_name?: string;
  vehicle_type?: string;
  eta_minutes?: number;
  current_location?: string;
}
