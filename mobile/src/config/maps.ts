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

// SokoTraffic draws Google Routes API content, which Google's terms only allow
// on a Google map. Android maps are always Google; on iOS react-native-maps
// defaults to Apple Maps, so the route map is only shown there when the app
// was built with GOOGLE_MAPS_IOS_API_KEY (provider="google"). Otherwise the
// screen lists routes and hands off to the Google Maps app.
export const googleRouteMapAvailable: boolean =
  Platform.OS === 'android'
    ? mapsAvailable
    : Platform.OS === 'ios' && Constants.expoConfig?.extra?.googleMapsIosEnabled === true;
