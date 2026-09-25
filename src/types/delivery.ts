export type VehicleType = 'bicycle' | 'motorbike' | 'car' | 'van' | 'truck';
export type PayerType = 'sender' | 'receiver';

export interface VehicleRate {
  base_fee: number;
  per_km_rate: number;
}

export const VEHICLE_RATES: Record<VehicleType, VehicleRate> = {
  bicycle:   { base_fee: 5.00,  per_km_rate: 1.50 },
  motorbike: { base_fee: 10.00, per_km_rate: 2.50 },
  car:       { base_fee: 25.00, per_km_rate: 4.00 },
  van:       { base_fee: 40.00, per_km_rate: 6.00 },
  truck:     { base_fee: 80.00, per_km_rate: 10.00 },
};

export type TripScope = 'same_town' | 'same_region' | 'cross_region' | 'cross_country' | 'unknown';

// Human-readable summary of what a trip's distance/fee is actually based on —
// pickup is reverse-geocoded from GPS, dropoff comes from the customer's own
// Country/Region/Town form input. Shared between the booking screen (index.tsx)
// and the tracking detail modal (track.tsx) so the wording stays consistent.
export function describeTripScope(
  scope: TripScope | undefined,
  pickupTown?: string, pickupRegion?: string,
  dropoffTown?: string, dropoffRegion?: string,
): string | null {
  // pickup_region/pickup_town come raw from reverse-geocoding (e.g. Nominatim
  // often returns "Eastern Region"), while dropoff_region/dropoff_town are the
  // customer's own clean picker values (e.g. "Eastern") — strip the suffix so
  // the two don't read inconsistently when mixed in one message.
  const clean = (s?: string) => s?.replace(/\s+Region$/i, '');
  const pRegion = clean(pickupRegion);
  const dRegion = clean(dropoffRegion);

  switch (scope) {
    case 'same_town':
      return `📍 Within ${dropoffTown || pickupTown}, ${dRegion || pRegion} Region`;
    case 'same_region':
      return `📍 Within ${dRegion || pRegion} Region (${pickupTown} → ${dropoffTown})`;
    case 'cross_region':
      return `🗺️ Cross-region trip: ${pRegion} → ${dRegion}`;
    case 'cross_country':
      return `🌍 Cross-border trip`;
    default:
      return null;
  }
}

export interface DeliveryOrderItem {
  id: string;
  status: string;
  payment_status: string;
  payer_type: PayerType;
  total_amount: number;
  distance_km: number;
  vehicle_type: VehicleType;
  description: string;
  pickup_address: string;
  dropoff_address: string;
  receiver_name: string;
  receiver_phone?: string;
  receiver_user_id?: string;
  rider_name?: string;
  rider_phone?: string;
  rider_profile_image?: string;
  created_at: string;
  customer_rating?: number;
  pickup_region?: string;
  pickup_town?: string;
  dropoff_region?: string;
  dropoff_town?: string;
  trip_scope?: TripScope;
}

export interface CreateDeliveryResponse {
  delivery_id: string;
  estimated_price: number;
  distance_km: number;
  payer_type: PayerType;
  status: string;
  checkout_url?: string;
  reference?: string;
  receiver_notified?: boolean;
  pickup_region?: string;
  pickup_town?: string;
  dropoff_region?: string;
  dropoff_town?: string;
  trip_scope?: TripScope;
}

export interface PaymentResponse {
  delivery_id: string;
  checkout_url: string;
  reference: string;
  amount: number;
}
