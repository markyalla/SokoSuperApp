// Contracts for the Soko API weather + SokoTraffic endpoints
// (sokoApp/internal/weather and sokoApp/internal/traffic).

export interface WeatherHour {
  time: string;
  temp_c: number;
  condition: string;
  condition_type: string;
  icon_url?: string;
  precip_chance: number;
}

export interface WeatherReport {
  time: string;
  time_zone?: string;
  is_daytime: boolean;
  temp_c: number;
  feels_like_c: number;
  condition: string;
  condition_type: string;
  icon_url?: string;
  humidity_pct: number;
  precip_chance: number;
  precip_type?: string;
  wind_kph: number;
  uv_index: number;
  hourly: WeatherHour[];
  source: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type TravelMode = 'DRIVE' | 'TWO_WHEELER' | 'WALK';

export interface RouteStep {
  instruction: string;
  maneuver?: string;
  distance_meters: number;
  duration_seconds: number;
}

export interface TrafficSegment {
  start_index: number;
  end_index: number;
  speed: 'NORMAL' | 'SLOW' | 'TRAFFIC_JAM' | string;
}

export interface TrafficRoute {
  id: string;
  description?: string;
  distance_meters: number;
  duration_seconds: number;
  static_duration_seconds: number;
  delay_seconds: number;
  polyline: string;
  traffic_segments: TrafficSegment[];
  steps: RouteStep[];
  is_fastest: boolean;
  is_shortest: boolean;
  is_default: boolean;
}

export interface RoutesResponse {
  travel_mode: TravelMode;
  routes: TrafficRoute[];
  source: string;
  computed_at: string;
}

export interface PlaceSuggestion {
  place_id: string;
  main_text: string;
  secondary_text: string;
}

export interface Place {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}
