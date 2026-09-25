import { Notifications } from './notifications';

// Registered at module scope (imported once from app/_layout.tsx) so a
// driver_assignment push still shows as a system notification even while the
// app is foregrounded, not just backgrounded/killed.
Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});
