// Extends app.json. The Google Maps keys come from environment variables (EAS
// environment variables for cloud builds) so they aren't committed:
//   GOOGLE_MAPS_API_KEY      — Android Maps SDK key (required for any map on Android)
//   GOOGLE_MAPS_IOS_API_KEY  — optional iOS Maps SDK key; when set, iOS maps
//                              render with Google instead of Apple Maps, which
//                              SokoTraffic needs to draw Google route content.
// Without a key, react-native-maps crashes on Android the moment a map renders
// — so `extra.googleMapsEnabled` / `extra.googleMapsIosEnabled` tell the
// screens whether they may render a MapView or should fall back to
// "Open in Google Maps".
module.exports = ({ config }) => {
  const androidKey = process.env.GOOGLE_MAPS_API_KEY;
  const iosKey = process.env.GOOGLE_MAPS_IOS_API_KEY;

  const mapsPluginProps = {
    ...(androidKey ? { androidGoogleMapsApiKey: androidKey } : {}),
    ...(iosKey ? { iosGoogleMapsApiKey: iosKey } : {}),
  };

  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      ...(androidKey || iosKey ? [['react-native-maps', mapsPluginProps]] : []),
    ],
    extra: {
      ...(config.extra || {}),
      googleMapsEnabled: Boolean(androidKey),
      googleMapsIosEnabled: Boolean(iosKey),
    },
  };
};
