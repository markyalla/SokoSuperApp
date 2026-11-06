import { create } from 'zustand';
import * as Location from 'expo-location';
import { Notifications } from '../services/notifications';
import Constants from 'expo-constants';
import { updateDriverLocation, toggleDriverOnlineStatus, registerPushToken } from '../api';
import { LOCATION_TASK_NAME } from '../services/locationTask';

// Best-effort push-token registration so the backend can wake the driver's
// app with a system notification when they're assigned an order while
// backgrounded/killed — failure here must not block location sharing itself.
async function registerForPushNotifications() {
  if (!Notifications) return;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushToken(token);
  } catch (e: any) {
    console.error('Push token registration failed:', e.message);
  }
}

interface DriverLocationState {
  isSharing: boolean;
  driverLocation: { lat: number; lng: number } | null;
  starting: boolean;
  foregroundSubscription: Location.LocationSubscription | null;
  startSharing: () => Promise<boolean>;
  stopSharing: () => Promise<void>;
}

export const useDriverLocationStore = create<DriverLocationState>((set, get) => ({
  isSharing: false,
  driverLocation: null,
  starting: false,
  foregroundSubscription: null,

  // Starts a foreground watcher (immediate UI feedback) AND registers the
  // background task (so sampling continues once the app is backgrounded or
  // killed) — both write to the same backend endpoint, so there's no
  // duplication concern beyond normal update-cadence overlap.
  startSharing: async () => {
    if (get().isSharing || get().starting) return get().isSharing;
    set({ starting: true });
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') return false;

      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') {
        console.warn('Background location permission not granted — sharing will pause when backgrounded.');
      }

      await toggleDriverOnlineStatus(true);
      registerForPushNotifications();

      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (location) => {
          const { latitude, longitude } = location.coords;
          set({ driverLocation: { lat: latitude, lng: longitude } });
          updateDriverLocation(latitude, longitude).catch((e) =>
            console.error('Location update failed:', e.message)
          );
        }
      );
      set({ foregroundSubscription: subscription });

      if (bg.status === 'granted') {
        const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
        if (!alreadyRunning) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 10,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'SokoApp Driver',
              notificationBody: 'Sharing your live location while you’re online.',
            },
          });
        }
      }

      set({ isSharing: true });
      return true;
    } finally {
      set({ starting: false });
    }
  },

  stopSharing: async () => {
    get().foregroundSubscription?.remove();

    const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
    if (running) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
    }
    set({ isSharing: false, driverLocation: null, foregroundSubscription: null });
    try {
      await toggleDriverOnlineStatus(false);
    } catch {
      // non-fatal, mirrors prior toggleLocationSharing behavior
    }
  },
}));
