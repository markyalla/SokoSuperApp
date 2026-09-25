import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { updateDriverLocation } from '../api';

export const LOCATION_TASK_NAME = 'driver-background-location';

// Defined at module scope so it's registered before the app mounts, letting
// expo-location deliver samples here even while backgrounded. apiClient's
// request interceptor reads the access token straight from SecureStore, so
// this task doesn't need any React/store wiring to authenticate its calls.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error.message);
    return;
  }
  const { locations } = (data as { locations: Location.LocationObject[] }) ?? { locations: [] };
  const last = locations?.[locations.length - 1];
  if (!last) return;

  try {
    await updateDriverLocation(last.coords.latitude, last.coords.longitude);
  } catch (e: any) {
    console.error('Background location update failed:', e.message);
  }
});
