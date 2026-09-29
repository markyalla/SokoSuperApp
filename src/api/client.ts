import axios from 'axios';
import { API_BASE_URL } from '../config/api';
import { friendlyError, isTechnicalMessage } from '../utils/friendlyError';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// Screens show `error.response?.data?.error || error.message`, so clean both
// here once: raw database/validator text or axios's "Request failed with
// status code 500" never reaches the user. The original text is still logged.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error?.response?.data;
    const raw = data?.error ?? error?.message;
    const friendly = friendlyError(error);
    if (data && typeof data === 'object' && typeof data.error === 'string' && isTechnicalMessage(data.error)) {
      console.warn('[api] server error hidden from user:', data.error);
      data.error = friendly;
    }
    if (error && typeof error.message === 'string' && isTechnicalMessage(error.message)) {
      if (raw !== friendly) console.warn('[api] request failed:', error.config?.url, raw);
      error.message = friendly;
    }
    return Promise.reject(error);
  }
);
