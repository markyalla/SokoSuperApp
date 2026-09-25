import { apiClient } from '../api/client';

// ── Response & Request Types ──────────────────────────────────────────────────

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  profile_image_url?: string;
  country?: string;
  roles?: string[];
}

export type KYCStatus = 'pending' | 'submitted' | 'approved' | 'rejected';

export interface AuthResponse {
  message?: string;
  kyc_status: KYCStatus;
  tokens: AuthTokens;
  user: AuthUser;
}

export interface RegisterRequest {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
  phone_number: string;
  gender?: string;
  date_of_birth?: string;
}

export interface KYCSubmissionRequest {
  id_type: 'national_id' | 'nhia_id' | 'voter_id' | 'tin' | 'passport' | 'drivers_license';
  id_number: string;
  id_image_url?: string;
  address?: string;
  city?: string;
  country?: string;
  id_mismatch?: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const accountService = {

  ping: async () => {
    return apiClient.get('/health');
  },

  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    try {
      const response = await apiClient.post<AuthResponse>('/auth/register', {
        full_name: data.full_name,
        email: data.email,
        password: data.password,
        confirm_password: data.confirm_password,
        phone_number: data.phone_number,
        ...(data.gender && { gender: data.gender }),
        ...(data.date_of_birth && { date_of_birth: data.date_of_birth }),
      });
      return response.data;
    } catch (error: any) {
      console.error('Registration failed', {
        url: `${apiClient.defaults.baseURL}/auth/register`,
        message: error?.message,
        data: error?.response?.data || 'No response from server',
      });
      throw error;
    }
  },

  login: async (identifier: string, password: string): Promise<AuthResponse> => {
    try {
      const response = await apiClient.post<AuthResponse>('/auth/login', {
        identifier,
        password,
      });
      return response.data;
    } catch (error: any) {
      console.error('Login failed', {
        baseURL: apiClient.defaults.baseURL,
        message: error?.message,
        responseData: error?.response?.data,
      });
      throw error;
    }
  },

  submitKYC: async (token: string, data: KYCSubmissionRequest): Promise<any> => {
    try {
      const response = await apiClient.post('/account/kyc', data, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return response.data;
    } catch (error: any) {
      console.error('KYC submission failed', {
        message: error?.message,
        responseData: error?.response?.data,
      });
      throw error;
    }
  },

  refresh: async (refreshToken: string): Promise<AuthTokens> => {
    const response = await apiClient.post<{ tokens: AuthTokens }>('/auth/refresh', {
      refresh_token: refreshToken,
    });
    return response.data.tokens;
  },

  logout: async (refreshToken: string): Promise<void> => {
    await apiClient.post('/auth/logout', { refresh_token: refreshToken });
  },

};