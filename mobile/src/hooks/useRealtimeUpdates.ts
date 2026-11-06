import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { wsService, RealtimeEvent } from '../services/websocket';

const ORDER_MESSAGES: Record<string, string> = {
  payment_confirmed:  'Payment confirmed! Your order is being prepared 💰',
  preparing:          'Your order is being prepared 👨‍🍳',
  ready_for_pickup:   'Order ready — waiting for driver pickup 🛍️',
  assigned_to_driver: 'A driver has been assigned to your order 🚗',
  picked_up:          'Driver picked up your order 📦',
  in_transit:         'Your order is on the way! 🚗',
  delivered:          'Your order has been delivered! ✅',
  cancelled:          'Your order has been cancelled ❌',
};

const DELIVERY_MESSAGES: Record<string, string> = {
  accepted:            'Driver accepted your delivery request 🎉',
  arrived_at_vendor:   'Driver arrived at pickup location 📍',
  picked_up:           'Your package has been picked up 📦',
  in_transit:          'Your package is on the way 🚗',
  arrived_at_customer: 'Driver arrived at your location 🏠',
  delivered:           'Your package has been delivered! ✅',
  failed:              'Delivery could not be completed ❌',
};

export interface ToastState {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function useRealtimeUpdates() {
  const tokens = useAuthStore((s) => s.tokens);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '' });
  const listeners = useRef<Array<() => void>>([]);

  const showToast = (message: string, actionLabel?: string, onAction?: () => void) => {
    setToast({ visible: true, message, actionLabel, onAction });
  };

  const hideToast = () => setToast({ visible: false, message: '' });

  useEffect(() => {
    if (!tokens?.access) {
      wsService.disconnect();
      return;
    }

    wsService.connect(tokens.access);

    const unsub = wsService.addHandler((event: RealtimeEvent) => {
      if (event.type === 'order_status') {
        const msg = ORDER_MESSAGES[event.data.status];
        if (msg) showToast(msg, 'View Orders', () => {
          hideToast();
          // Navigation happens via the action prop passed to the Toast in the layout
          listeners.current.forEach((l) => l());
        });
      } else if (event.type === 'delivery_status') {
        const msg = DELIVERY_MESSAGES[event.data.status];
        if (msg) showToast(msg, 'View Deliveries', () => {
          hideToast();
          listeners.current.forEach((l) => l());
        });
      }
    });

    return () => {
      unsub();
    };
  }, [tokens?.access]);

  return { toast, hideToast };
}
