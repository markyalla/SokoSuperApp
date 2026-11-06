import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { AuthTokens, AuthUser as User, KYCStatus } from '../types/accountService';
import { getMe } from '../api';

interface AuthState {
  tokens: AuthTokens | null;
  user: User | null;
  kycStatus: KYCStatus | null;
  loading: boolean;
  setAuth: (tokens: AuthTokens, user: User, kycStatus: KYCStatus) => Promise<void>;
  clearAuth: () => Promise<void>;
  setKycStatus: (status: KYCStatus) => Promise<void>;
  updateUser: (partial: Record<string, any>) => Promise<void>;
  refreshUser: () => Promise<void>;
  loadStoredAuth: () => Promise<void>;
  // Cart state
  cart: Record<string, any>;
  cartTotal: number;
  cartCount: number;
  addToCart: (item: any) => void;
  updateQuantity: (id: string | number, quantity: number) => void;
  clearCart: () => void;
}

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const USER_KEY = 'user';
const KYC_STATUS_KEY = 'kycStatus';

export const useAuthStore = create<AuthState>((set, get) => ({
  tokens: null,
  user: null,
  kycStatus: null,
  loading: true,
  cart: {},
  cartTotal: 0,
  cartCount: 0,

  setAuth: async (tokens, user, kycStatus) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.access);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    await SecureStore.setItemAsync(KYC_STATUS_KEY, kycStatus);
    set({ tokens, user, kycStatus, loading: false });
  },
  clearAuth: async () => {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    await SecureStore.deleteItemAsync(KYC_STATUS_KEY);
    set({ tokens: null, user: null, kycStatus: null, loading: false, cart: {}, cartTotal: 0, cartCount: 0 });
  },

  addToCart: (item) => set((state) => {
    const newCart = { ...state.cart };
    const existing = newCart[String(item.id)];

    if (existing) {
      newCart[String(item.id)] = { ...existing, quantity: existing.quantity + (item.quantity || 1) };
    } else {
      newCart[String(item.id)] = item;
    }

    const items = Object.values(newCart);
    return {
      cart: newCart,
      cartCount: items.reduce((acc, i) => acc + i.quantity, 0),
      cartTotal: items.reduce((acc, i) => acc + (i.price * i.quantity), 0),
    };
  }),

  updateQuantity: (id, quantity) => set((state) => {
    const newCart = { ...state.cart };
    if (quantity <= 0) {
      delete newCart[String(id)];
    } else if (newCart[String(id)]) {
      newCart[String(id)] = { ...newCart[String(id)], quantity };
    }

    const items = Object.values(newCart);
    return {
      cart: newCart,
      cartCount: items.reduce((acc, i) => acc + i.quantity, 0),
      cartTotal: items.reduce((acc, i) => acc + (i.price * i.quantity), 0),
    };
  }),

  clearCart: () => set({ cart: {}, cartTotal: 0, cartCount: 0 }),

  setKycStatus: async (status: KYCStatus) => {
    await SecureStore.setItemAsync(KYC_STATUS_KEY, status);
    set((state) => ({ ...state, kycStatus: status }));
  },

  // Merges partial fields into the stored user profile (e.g. after a profile
  // photo upload) and persists them, without needing a full re-login.
  // Handles both shapes seen in the wild: { ...user } and { user: {...} }.
  updateUser: async (partial: Record<string, any>) => {
    const current = get().user as any;
    if (!current) return;

    const newUser = current.user
      ? { ...current, user: { ...current.user, ...partial } }
      : { ...current, ...partial };

    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(newUser));
    set({ user: newUser });
  },

  // Refetches the current user from the server (e.g. driver_profile.rating,
  // which only changes server-side) and merges it in, since setAuth only
  // happens at login/register/refresh and the cached user otherwise goes
  // stale for the rest of the session.
  refreshUser: async () => {
    try {
      const res = await getMe();
      await get().updateUser(res.data.user);
      if (res.data.kyc_status) {
        await get().setKycStatus(res.data.kyc_status);
      }
    } catch {
      // Silent — background freshness refetch, keep showing the cached user.
    }
  },
  loadStoredAuth: async () => {
    const access = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    const refresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    const userData = await SecureStore.getItemAsync(USER_KEY);
    const kycStatus = (await SecureStore.getItemAsync(KYC_STATUS_KEY)) as KYCStatus | null;

    if (access && refresh && userData) {
      const user = JSON.parse(userData) as User;
      set({ tokens: { access, refresh }, user, kycStatus, loading: false });
      return;
    }

    set({ tokens: null, user: null, kycStatus: null, loading: false });
  },
}));
