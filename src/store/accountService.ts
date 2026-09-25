import { apiClient } from '../api/client';
import { AuthResponse, KYCSubmissionRequest } from '../types/accountService';

// Plain object interface — screen passes this, service builds FormData internally
export interface RegisterRequest {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
  phone_number: string;
  country?: string;
  gender?: string;
  date_of_birth?: string;
  profile_image?: {
    uri: string;
    name: string;
    type: string;
  };
}

export const accountService = {
  ping: async () => {
    return apiClient.get('/health');
  },

  login: async (identifier: string, password: string): Promise<AuthResponse> => {
    const response = await apiClient.post<AuthResponse>('/auth/login', {
      identifier,
      password,
    });
    return response.data;
  },

  register: async (data: RegisterRequest): Promise<AuthResponse> => {
    const formData = new FormData();

    formData.append('full_name', data.full_name);
    formData.append('email', data.email);
    formData.append('password', data.password);
    formData.append('confirm_password', data.confirm_password);
    formData.append('phone_number', data.phone_number);
    if (data.country) {
      formData.append('country', data.country);
    }
    formData.append('gender', data.gender ?? 'other');

    if (data.date_of_birth) {
      formData.append('date_of_birth', data.date_of_birth);
    }

    if (data.profile_image) {
      // React Native requires this blob-like shape for file uploads
      formData.append('profile_image', {
        uri: data.profile_image.uri,
        name: data.profile_image.name,
        type: data.profile_image.type,
      } as any);
    }

    try {
      const response = await apiClient.post<AuthResponse>('/auth/register', formData, {
        headers: {
          // Explicitly set multipart so Axios includes the boundary.
          // This overrides any default 'application/json' on the apiClient instance.
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error: any) {
      console.error('Registration failed', {
        url: error?.config?.url,
        baseURL: apiClient.defaults.baseURL,
        message: error?.message,
        data: error?.response?.data,
      });
      throw error;
    }
  },

  submitKYC: async (token: string, data: KYCSubmissionRequest): Promise<any> => {
    return apiClient.post('/account/kyc', data, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },
};