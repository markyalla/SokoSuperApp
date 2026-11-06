import { apiClient } from './client';
import { Category, Restaurant, MenuItem, CreateOrderRequest, OrderResponse, OrderDetailResponse, PaymentResponse } from '../types/shopper';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

export const shopperApi = {
  getCategories: async (token: string): Promise<Category[]> => {
    const response = await apiClient.get<Category[]>('/shopper/categories', {
      headers: authHeader(token),
    });
    return response.data;
  },

  getShops: async (token: string): Promise<Restaurant[]> => {
    const response = await apiClient.get<Restaurant[]>('/shopper/stores', {
      headers: authHeader(token),
    });
    return response.data;
  },

  getMenuItems: async (token: string, shopId: string): Promise<MenuItem[]> => {
    const response = await apiClient.get<MenuItem[]>(`/shopper/stores/${shopId}/products`, {
      headers: authHeader(token),
    });
    return response.data;
  },

  getProductsByCategory: async (token: string, categoryId: string): Promise<MenuItem[]> => {
    const response = await apiClient.get<MenuItem[]>(`/shopper/categories/${categoryId}/products`, {
      headers: authHeader(token),
    });
    return response.data;
  },

  createOrder: async (token: string, order: CreateOrderRequest): Promise<OrderResponse> => {
    const response = await apiClient.post<OrderResponse>('/shopper/orders', order, {
      headers: authHeader(token),
    });
    return response.data;
  },

  getOrders: async (token: string): Promise<OrderResponse[]> => {
    const response = await apiClient.get<OrderResponse[]>('/shopper/orders', {
      headers: authHeader(token),
    });
    return response.data;
  },

  getOrder: async (token: string, orderId: string): Promise<OrderDetailResponse> => {
    const response = await apiClient.get<OrderDetailResponse>(`/shopper/orders/${orderId}`, {
      headers: authHeader(token),
    });
    return response.data;
  },

  payOrder: async (token: string, orderId: string): Promise<PaymentResponse> => {
    const response = await apiClient.post<PaymentResponse>(`/shopper/orders/${orderId}/pay`, {
      payment_method: 'paystack',
    }, {
      headers: authHeader(token),
    });
    return response.data;
  },

  getDriverOrderDeliveries: async (token: string): Promise<any> => {
    const response = await apiClient.get<any>('/delivery/driver/order-deliveries', {
      headers: authHeader(token),
    });
    return response.data;
  },

  getDriverOrderDeliveryDetail: async (token: string, id: string): Promise<any> => {
    const response = await apiClient.get<any>(`/delivery/driver/order-deliveries/${id}`, {
      headers: authHeader(token),
    });
    return response.data;
  },

  updateOrderTracking: async (token: string, orderId: string, data: { status?: string; lat?: number; lng?: number }): Promise<any> => {
    const response = await apiClient.patch<any>(`/delivery/driver/orders/${orderId}/tracking`, data, {
      headers: authHeader(token),
    });
    return response.data;
  },
};
