import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { router } from 'expo-router';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth header to every request
apiClient.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Guests (KYC not approved) are blocked server-side from placing orders,
// booking artisans, joining susu groups, and booking deliveries. Surface
// that block as a popup here once, instead of in every screen that calls
// one of those endpoints.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403 && error.response?.data?.code === 'kyc_required') {
      const kycStatus = error.response.data.kyc_status;
      const isPending = kycStatus === 'submitted' || kycStatus === 'under_review';
      Alert.alert(
        'Verification Required',
        isPending
          ? "Your profile verification is still under review. You'll be able to use this feature once it's approved."
          : 'Complete your profile verification to place orders, book artisans, join susu groups, or book deliveries.',
        isPending
          ? [{ text: 'OK' }]
          : [
              { text: 'Not now', style: 'cancel' },
              { text: 'Complete Profile', onPress: () => router.push('/(auth)/kyc' as any) },
            ]
      );
    }
    return Promise.reject(error);
  }
);

// --- SHOPPER MODULE ---

export const getCategories = () => apiClient.get('/shopper/categories');

export const getDeliveryFee = (lat?: number, lng?: number, storeId?: string) =>
  apiClient.get('/shopper/delivery-fee', { params: { lat, lng, store_id: storeId } });

export const getStores = () => apiClient.get('/shopper/stores');

export const getStore = (storeId: string) => 
  apiClient.get(`/shopper/stores/${storeId}`);

export const getStoreProducts = (storeId: string) => 
  apiClient.get(`/shopper/stores/${storeId}/products`);

export const createOrder = (orderData: any) => 
  apiClient.post('/shopper/orders', orderData);

export const cancelOrder = (orderId: string) =>
  apiClient.patch(`/shopper/orders/${orderId}/cancel`);

export const requestRefund = (orderId: string) =>
  apiClient.post(`/shopper/orders/${orderId}/refund`);

export const deleteOrder = (orderId: string) =>
  apiClient.delete(`/shopper/orders/${orderId}`);

export const payOrder = (orderId: string, method: 'paystack' | 'sokopay') => 
  apiClient.post(`/shopper/orders/${orderId}/pay`, { payment_method: method });

export const getOrders = () => apiClient.get('/shopper/orders');

// --- DRIVER / DELIVERY MODULE ---

export const getDriverDeliveries = () => apiClient.get('/delivery/driver/deliveries');

export const getDeliveryDetail = (deliveryId: string) =>
  apiClient.get(`/delivery/driver/deliveries/${deliveryId}`);

export const getDriverDeliveryDetail = getDeliveryDetail;

export const getDriverOrderDeliveries = () => apiClient.get('/delivery/driver/order-deliveries');

export const getDriverOrderDeliveryDetail = (id: string) =>
  apiClient.get(`/delivery/driver/order-deliveries/${id}`);

export const getOrderDetail = (orderId: string) => 
  apiClient.get(`/shopper/orders/${orderId}`);

export const updateOrderTracking = (orderId: string, status: string) =>
  apiClient.patch(`/delivery/driver/orders/${orderId}/tracking`, { status });

export const generateDeliveryOTP = (deliveryId: string) =>
  apiClient.post(`/delivery/driver/deliveries/${deliveryId}/otp/generate`);

export const generateOrderOTP = (id: string) =>
  apiClient.post(`/delivery/driver/order-deliveries/${id}/otp/generate`);

export const verifyDeliveryOTP = (deliveryId: string, otp: string) =>
  apiClient.post(`/delivery/driver/deliveries/${deliveryId}/otp/verify`, { otp });

export const verifyOrderOTP = (id: string, otp: string) =>
  apiClient.post(`/delivery/driver/order-deliveries/${id}/otp/verify`, { otp });

export const applyDriver = (data: any) =>
  apiClient.post('/account/driver-application', data);

export const verifyPayment = (reference: string, orderId: number | string) =>
  apiClient.get(`/webhooks/paystack/verify`, { params: { reference, order_id: orderId } });

export const updateProfile = (data: any) =>
  apiClient.patch('/auth/me', data);

export const getMe = () =>
  apiClient.get('/auth/me');

// Permanently deletes the signed-in user's account (password required).
export const deleteAccount = (password: string) =>
  apiClient.delete('/auth/me', { data: { password } });

export const acceptDelivery = (deliveryId: string | number) =>
  apiClient.post(`/delivery/driver/deliveries/${deliveryId}/accept`, {});

export const updateDeliveryStatus = (deliveryId: string | number, status: string) =>
  apiClient.patch(`/delivery/driver/deliveries/${deliveryId}/status`, { status });

export const updateDriverLocation = (lat: number, lng: number) =>
  apiClient.post('/delivery/driver/location', { lat, lng });

export const toggleDriverOnlineStatus = (isOnline: boolean) =>
  apiClient.put('/delivery/driver/online-status', { is_online: isOnline });

export const registerPushToken = (expoPushToken: string) =>
  apiClient.post('/delivery/driver/push-token', { expo_push_token: expoPushToken });

export const getDriverEarnings = () =>
  apiClient.get('/delivery/driver/earnings');

export const requestDriverCashout = (amount: number, method: 'momo' | 'bank') =>
  apiClient.post('/delivery/driver/cashout', { amount, method });

export const rateParcelDelivery = (deliveryOrderId: string, rating: number, review?: string) =>
  apiClient.post(`/delivery/parcel/${deliveryOrderId}/rate`, { rating, review });

export const rateOrderDelivery = (orderId: string, rating: number, review?: string) =>
  apiClient.post(`/shopper/orders/${orderId}/rate`, { rating, review });

export const fileOrderComplaint = (orderId: string, category: string, description: string) =>
  apiClient.post(`/shopper/orders/${orderId}/complaints`, { category, description });

export const fileParcelComplaint = (deliveryOrderId: string, category: string, description: string) =>
  apiClient.post(`/delivery/parcel/${deliveryOrderId}/complaints`, { category, description });

interface DriverDetails {
  id: string;
  full_name: string;
  profile_image_url?: string; // New field for the driver's profile image
  phone_number?: string;
  vehicle_name?: string;
  vehicle_plate_number?: string;
  current_lat?: number;
  current_lng?: number;
}

export interface OrderTrackingResponse {
  delivery_id: string;
  order_id: string;
  status: string;
  driver?: DriverDetails; // Optional driver details, including profile_image_url
  customer_lat?: number;
  customer_lng?: number;
  driver_lat?: number;
  driver_lng?: number;
}

export const getDeliveryLocation = (deliveryId: string | number) =>
  apiClient.get<OrderTrackingResponse>(`/shopper/orders/${deliveryId}/tracking`);

export const getCustomerOrderOTP = (orderId: string | number) =>
  apiClient.get(`/shopper/orders/${orderId}/otp`);

export const getCustomerOTP = (deliveryId: string | number) =>
  apiClient.get(`/delivery/parcel/${deliveryId}/otp`);

// --- SUSU MODULE ---

export const listMyGroups = () =>
  apiClient.get('/susu/groups');

export const discoverGroups = () =>
  apiClient.get('/susu/groups/discover');

export const createSusuGroup = (data: {
  name: string;
  contribution_amount: number;
  cycle_period: string;
  max_members: number;
}) => apiClient.post('/susu/groups', data);

export const getSusuGroup = (groupId: string) =>
  apiClient.get(`/susu/groups/${groupId}`);

export const joinSusuGroup = (groupId: string) =>
  apiClient.post(`/susu/groups/${groupId}/join`);

export const listJoinRequests = (groupId: string) =>
  apiClient.get(`/susu/groups/${groupId}/join-requests`);

export const approveJoinRequest = (groupId: string, requestId: string) =>
  apiClient.post(`/susu/groups/${groupId}/join-requests/${requestId}/approve`);

export const rejectJoinRequest = (groupId: string, requestId: string) =>
  apiClient.post(`/susu/groups/${groupId}/join-requests/${requestId}/reject`);

export const contributeToGroup = (groupId: string, cycleNumber: number, transactionId?: string) =>
  apiClient.post(`/susu/groups/${groupId}/contribute`, {
    cycle_number: cycleNumber,
    ...(transactionId ? { transaction_id: transactionId } : {}),
  });

export const listGroupContributions = (groupId: string) =>
  apiClient.get(`/susu/groups/${groupId}/contributions`);

export const listGroupPayouts = (groupId: string) =>
  apiClient.get(`/susu/groups/${groupId}/payouts`);

// --- SOKOINDEX MODULE ---

export const applyAsArtisan = (data: import('../types/sokoindex').ApplyArtisanRequest) =>
  apiClient.post('/sokoindex/apply', data);

export const getArtisanApplicationStatus = () =>
  apiClient.get('/sokoindex/application/status');

export const getSokoIndexMe = () =>
  apiClient.get<import('../types/sokoindex').SokoIndexMeResponse>('/sokoindex/me');

export const getSokoIndexFeatureFlags = () =>
  apiClient.get<import('../types/sokoindex').SokoIndexFeatureFlags>('/sokoindex/feature-flags');

export const browseArtisans = (params?: { trade_category?: string; location?: string; q?: string; page?: number }) =>
  apiClient.get('/sokoindex/artisans', { params });

export const getArtisanDetail = (artisanId: string) =>
  apiClient.get(`/sokoindex/artisans/${artisanId}`);

export const getMyArtisanProfile = () =>
  apiClient.get('/sokoindex/profile');

export const updateMyArtisanProfile = (data: any) =>
  apiClient.put('/sokoindex/profile', data);

export const createPortfolioItem = (data: {
  title: string; description: string; image_path_1: string; image_path_2?: string; image_path_3?: string; image_path_4?: string;
}) => apiClient.post('/sokoindex/portfolio', data);

export const updatePortfolioItem = (portfolioId: string, data: {
  title: string; description: string; image_path_1: string; image_path_2?: string; image_path_3?: string; image_path_4?: string;
}) => apiClient.put(`/sokoindex/portfolio/${portfolioId}`, data);

export const listMyPortfolio = () =>
  apiClient.get('/sokoindex/portfolio');

export const createSokoIndexBooking = (
  artisanId: string,
  description: string,
  location?: { location_text?: string; location_lat?: number; location_lng?: number }
) =>
  apiClient.post('/sokoindex/bookings', { artisan_id: artisanId, description, ...location });

export const listMySokoIndexBookings = (status?: string) =>
  apiClient.get('/sokoindex/bookings', { params: status ? { status } : undefined });

export const getSokoIndexBooking = (bookingId: string) =>
  apiClient.get(`/sokoindex/bookings/${bookingId}`);

export const cancelSokoIndexBooking = (bookingId: string) =>
  apiClient.put(`/sokoindex/bookings/${bookingId}/cancel`);

export const confirmSokoIndexBookingCompletion = (bookingId: string) =>
  apiClient.put(`/sokoindex/bookings/${bookingId}/confirm-completion`);

export const rateSokoIndexBooking = (bookingId: string, score: number, comment?: string) =>
  apiClient.post(`/sokoindex/bookings/${bookingId}/rate`, { score, comment });

export const recommendArtisanForBooking = (bookingId: string, note?: string) =>
  apiClient.post(`/sokoindex/bookings/${bookingId}/recommend`, { note });

export const fileSokoIndexComplaint = (bookingId: string, category: string, description: string) =>
  apiClient.post(`/sokoindex/bookings/${bookingId}/complaints`, { category, description });

export const listIncomingSokoIndexBookings = (status?: string) =>
  apiClient.get('/sokoindex/artisan/bookings', { params: status ? { status } : undefined });

export const acceptSokoIndexBooking = (bookingId: string) =>
  apiClient.put(`/sokoindex/artisan/bookings/${bookingId}/accept`);

export const rejectSokoIndexBooking = (bookingId: string, reason: string) =>
  apiClient.put(`/sokoindex/artisan/bookings/${bookingId}/reject`, { reason });

export const completeSokoIndexBooking = (bookingId: string) =>
  apiClient.put(`/sokoindex/artisan/bookings/${bookingId}/complete`);

export const listMySokoIndexRatings = () =>
  apiClient.get('/sokoindex/artisan/ratings');

export const initializeSokoIndexPayment = (type: 'contact_unlock' | 'artisan_unlock' | 'joining_fee', entityId?: string) =>
  apiClient.post('/sokoindex/payments/initialize', { type, entity_id: entityId });

export const verifySokoIndexPayment = (reference: string) =>
  apiClient.get('/sokoindex/payments/verify', { params: { reference } });

export default apiClient;