// Extends app.json. The Google Maps key comes from the GOOGLE_MAPS_API_KEY
// environment variable (an EAS environment variable for cloud builds) so it
// isn't committed. Without a key, react-native-maps crashes on Android the
// moment a map renders — so `extra.googleMapsEnabled` tells the screens whether
// they may render a MapView or should fall back to "Open in Google Maps".
module.exports = ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      ...(apiKey ? [['react-native-maps', { androidGoogleMapsApiKey: apiKey }]] : []),
    ],
    extra: {
      ...(config.extra || {}),
      googleMapsEnabled: Boolean(apiKey),
    },
  };
};
