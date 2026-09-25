import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';

type NotificationsModule = typeof import('expo-notifications');

// Expo Go on Android throws as soon as expo-notifications is imported (push
// support was removed from Expo Go), which takes down every layout that
// imports it. Load it lazily and expose null there so the rest of the app can
// still be tested in Expo Go; development/production builds get the real module.
export const Notifications: NotificationsModule | null =
  Platform.OS === 'android' && isRunningInExpoGo() ? null : require('expo-notifications');
