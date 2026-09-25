export type ArtisanApplicationStatus = 'pending' | 'approved' | 'rejected';
export type PortfolioStatus = 'pending' | 'approved' | 'rejected';
export type SokoIndexBookingStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'awaiting_confirmation'
  | 'completed'
  | 'cancelled';
export type ContactPaymentStatus = 'pending' | 'paid' | 'bypassed';

export interface ArtisanProfile {
  id: string;
  user_id: string;
  display_name: string;
  bio: string;
  trade_category: string;
  country?: string;
  location_text: string;
  location_lat: number;
  location_lng: number;
  profile_image_path: string;
  avg_rating: number;
  rating_count: number;
  recommendation_count: number;
  is_published: boolean;
  is_suspended: boolean;
  suspension_reason?: string;
  joining_fee_paid: boolean;
  contact_unlock_paid: boolean;
  created_at: string;
  updated_at: string;
}

export interface Portfolio {
  id: string;
  artisan_id: string;
  title: string;
  description: string;
  image_path_1: string;
  image_path_2?: string;
  image_path_3?: string;
  image_path_4?: string;
  status: PortfolioStatus;
  rejection_reason?: string;
  created_at: string;
}

export interface SokoIndexBooking {
  id: string;
  customer_id: string;
  artisan_id: string;
  description: string;
  status: SokoIndexBookingStatus;
  rejection_reason?: string;
  contact_unlocked: boolean;
  contact_payment_status: ContactPaymentStatus;
  created_at: string;
  updated_at: string;
  artisan_phone?: string;
  /** Present on the artisan-view response: whether the paywall is on and this artisan has paid to unlock incoming jobs. */
  contact_unlock_required?: boolean;
  artisan_unlocked?: boolean;
  artisan?: {
    id: string;
    display_name: string;
    trade_category: string;
    location_text: string;
    profile_image_path: string;
  };
  /** Full contact fields are only present once the artisan has unlocked incoming jobs (or the paywall is off) — otherwise only full_name is included. */
  customer?: {
    full_name: string;
    phone_number?: string;
    email?: string;
    profile_image_url?: string;
    location_text?: string;
  };
}

export interface ApplyArtisanRequest {
  bio: string;
  trade_category: string;
  location_text?: string;
  location_lat?: number;
  location_lng?: number;
}

export interface SokoIndexMeResponse {
  is_artisan: boolean;
  has_applied?: boolean;
  status?: ArtisanApplicationStatus;
  rejection_reason?: string;
  profile?: ArtisanProfile;
  customer_unlock_required?: boolean;
  customer_unlocked?: boolean;
  artisan_unlock_required?: boolean;
  artisan_unlocked?: boolean;
}

export interface SokoIndexFeatureFlags {
  contact_unlock_enabled: boolean;
  joining_fee_enabled: boolean;
  customer_unlock_fee_ghs: number;
  artisan_unlock_fee_ghs: number;
  joining_fee_ghs: number;
}
