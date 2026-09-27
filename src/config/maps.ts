import Constants from 'expo-constants';
import { Platform } from 'react-native';

// On Android, react-native-maps needs a Google Maps API key built into the app
// (set via GOOGLE_MAPS_API_KEY in app.config.js). Without one the native map
// crashes the app as soon as it renders, so screens check this before showing
// a MapView and otherwise offer "Open in Google Maps" instead.
// Expo Go ships its own key, so maps always work there.
export const mapsAvailable: boolean =
  Platform.OS !== 'android' ||
  Constants.executionEnvironment === 'storeClient' ||
  Constants.expoConfig?.extra?.googleMapsEnabled === true;
