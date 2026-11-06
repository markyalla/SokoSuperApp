import { useEffect } from 'react';
import { Notifications } from '../services/notifications';
import { useAuthStore } from '../store/authStore';
import { useOrderAssignmentStore } from '../store/orderAssignmentStore';
import { wsService, RealtimeEvent } from '../services/websocket';

// Mounted once at the (main) layout level so a driver sees the incoming-order
// popup no matter which screen they're on, instead of only while the driver
// dashboard screen itself is focused. Covers both the live WebSocket push
// (app foregrounded/backgrounded but not killed) and the Expo push
// notification the backend also sends (app backgrounded or killed).
export function useDriverAssignmentAlerts() {
  const tokens = useAuthStore((s) => s.tokens);
  const user = useAuthStore((s) => s.user) as any;
  const userData = user?.user || user;
  const roles: string[] = userData?.roles || [];
  const isDriver = roles.includes('driver');
  const setAssignment = useOrderAssignmentStore((s) => s.setAssignment);

  useEffect(() => {
    if (!tokens?.access || !isDriver) return;

    wsService.connect(tokens.access);

    return wsService.addHandler((event: RealtimeEvent) => {
      // Only 'assigned' means "new order awaiting response" — later statuses
      // (accepted, picked_up, in_transit, delivered) reuse this same event
      // type and must not reopen the incoming-order popup.
      if (event.type === 'driver_assignment' && event.data.status === 'assigned') {
        setAssignment({
          assignmentId: event.data.assignment_id,
          orderId: event.data.order_id,
          status: event.data.status,
          assignedAt: new Date().toISOString(),
        });
      }
    });
  }, [tokens?.access, isDriver]);

  useEffect(() => {
    if (!isDriver || !Notifications) return;

    const fromNotification = (data: any) => {
      if (!data?.assignment_id && !data?.order_id) return;
      if (data.status !== 'assigned') return;
      setAssignment({
        assignmentId: data.assignment_id,
        orderId: data.order_id,
        status: data.status,
        assignedAt: new Date().toISOString(),
      });
    };

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      fromNotification(notification.request.content.data);
    });
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      fromNotification(response.notification.request.content.data);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [isDriver]);
}
