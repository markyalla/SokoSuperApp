import { apiClient } from './client';
import { CreateDeliveryResponse, PaymentResponse, VehicleType } from '../types/delivery';

export interface RiderRequest {
  order_id?: string;
  item_name: string;
  vehicle_type: VehicleType;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  // From the phone's own OS-level geocoder (Google/Apple), captured alongside
  // pickup_address — lets the backend trust this for trip-scope classification
  // instead of re-deriving it from a separate OpenStreetMap reverse-geocode,
  // which has sparser coverage of Ghanaian towns and can disagree (e.g.
  // resolving to a small suburb instead of the town the customer sees).
  pickup_town?: string;
  pickup_region?: string;
  pickup_country?: string;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  // Structured dropoff — lets the backend run a scoped geocode (city/state/
  // country) instead of guessing from dropoff_address text. dropoff_landmark
  // is the specific suburb/street/compound within dropoff_town, if known —
  // more precise when it resolves, but town is the reliable fallback anchor.
  dropoff_landmark?: string;
  dropoff_town?: string;
  dropoff_region?: string;
  dropoff_country?: string;
  package_description: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_specific_location: string;
  payer_type: 'sender' | 'receiver';
}

export const deliveryApi = {
  requestRider: async (token: string, payload: RiderRequest): Promise<CreateDeliveryResponse> => {
    const res = await apiClient.post<CreateDeliveryResponse>('/delivery/request', payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  getDeliveryDetail: async (token: string, deliveryId: string): Promise<any> => {
    const res = await apiClient.get<any>(`/delivery/parcel/${deliveryId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data;
  },

  listUserDeliveries: async (token: string): Promise<any[]> => {
    const res = await apiClient.get<any>('/delivery/user/deliveries', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data;
  },

  listReceiverDeliveries: async (token: string): Promise<any[]> => {
    const res = await apiClient.get<any>('/delivery/receiver/deliveries', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data;
  },

  initiatePayment: async (token: string, deliveryId: string): Promise<PaymentResponse> => {
    const res = await apiClient.post<PaymentResponse>(`/delivery/parcel/${deliveryId}/pay`, {}, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  verifyPayment: async (token: string, reference: string): Promise<{ payment_status: string }> => {
    const res = await apiClient.get<{ payment_status: string }>('/delivery/verify-payment', {
      params: { reference },
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data;
  },

  getPriceEstimate: async (
    vehicleType: VehicleType,
    pickupLat: number, pickupLng: number,
    dropoffLat: number, dropoffLng: number,
  ) => {
    const res = await apiClient.get('/delivery/estimate', {
      params: { vehicle_type: vehicleType, pickup_lat: pickupLat, pickup_lng: pickupLng, dropoff_lat: dropoffLat, dropoff_lng: dropoffLng },
    });
    return res.data;
  },
};
