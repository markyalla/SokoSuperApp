import { apiClient } from './client';
import type { LatLng, Place, PlaceSuggestion, RoutesResponse, TravelMode, WeatherReport } from '../types/geo';

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

// All Google calls go through the Soko API — no provider keys live in the app.
export const weatherApi = {
  current: async (token: string, lat: number, lng: number): Promise<WeatherReport> => {
    const res = await apiClient.get<WeatherReport>('/weather/current', {
      headers: authHeader(token),
      params: { lat, lng },
      timeout: 15000,
    });
    return res.data;
  },
};

export const trafficApi = {
  autocomplete: async (
    token: string,
    q: string,
    opts: { near?: LatLng | null; session?: string; signal?: AbortSignal } = {},
  ): Promise<PlaceSuggestion[]> => {
    const res = await apiClient.get<{ suggestions: PlaceSuggestion[] }>('/traffic/places/autocomplete', {
      headers: authHeader(token),
      params: {
        q,
        session: opts.session,
        ...(opts.near ? { lat: opts.near.lat, lng: opts.near.lng } : {}),
      },
      signal: opts.signal,
    });
    return res.data.suggestions ?? [];
  },

  placeDetails: async (token: string, placeId: string, session?: string): Promise<Place> => {
    const res = await apiClient.get<Place>(`/traffic/places/${encodeURIComponent(placeId)}`, {
      headers: authHeader(token),
      params: { session },
    });
    return res.data;
  },

  routes: async (token: string, origin: LatLng, destination: LatLng, travelMode: TravelMode): Promise<RoutesResponse> => {
    const res = await apiClient.post<RoutesResponse>(
      '/traffic/routes',
      { origin, destination, travel_mode: travelMode },
      { headers: authHeader(token), timeout: 20000 },
    );
    return res.data;
  },
};
