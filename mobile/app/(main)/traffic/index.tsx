import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, Linking, Platform, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { useAuthStore } from '../../../src/store/authStore';
import { trafficApi } from '../../../src/api/geo';
import { googleRouteMapAvailable } from '../../../src/config/maps';
import { decodePolyline, formatDistance, formatDuration } from '../../../src/utils/polyline';
import type { LatLng, PlaceSuggestion, TrafficRoute, TravelMode } from '../../../src/types/geo';

type Endpoint = LatLng & { label: string; fromGps?: boolean };
type Field = 'origin' | 'destination';

const MODES: { key: TravelMode; label: string; icon: string; gmaps: string }[] = [
  { key: 'DRIVE', label: 'Car', icon: 'car-outline', gmaps: 'driving' },
  { key: 'TWO_WHEELER', label: 'Motorbike', icon: 'bicycle-outline', gmaps: 'two-wheeler' },
  { key: 'WALK', label: 'Walk', icon: 'walk-outline', gmaps: 'walking' },
];

const TRAFFIC_COLORS: Record<string, string> = {
  NORMAL: '#2563eb',
  SLOW: '#f59e0b',
  TRAFFIC_JAM: '#dc2626',
};
const ALT_COLOR = '#9ca3af';

// Places sessions group the keystrokes + the final details call into one
// billed session. Google wants a URL-safe token of at most 36 characters.
const newSession = () =>
  Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');

function trafficLabel(r: TrafficRoute): { text: string; color: string } | null {
  // Only label traffic when the provider actually returned traffic data.
  if (!r.traffic_segments?.length) return null;
  const jam = r.traffic_segments.some((s) => s.speed === 'TRAFFIC_JAM');
  const slow = r.traffic_segments.some((s) => s.speed === 'SLOW');
  if (jam) return { text: 'Heavy traffic', color: TRAFFIC_COLORS.TRAFFIC_JAM };
  if (slow) return { text: 'Some slow traffic', color: TRAFFIC_COLORS.SLOW };
  return { text: 'Traffic is normal', color: '#16a34a' };
}

export default function SokoTrafficScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAuthStore() as any;
  const token: string = tokens?.access;

  const [origin, setOrigin] = useState<Endpoint | null>(null);
  const [destination, setDestination] = useState<Endpoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [permState, setPermState] = useState<'unknown' | 'granted' | 'ask' | 'blocked'>('unknown');
  const [gpsError, setGpsError] = useState('');

  const [activeField, setActiveField] = useState<Field | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const session = useRef(newSession());
  const abortRef = useRef<AbortController | null>(null);

  const [mode, setMode] = useState<TravelMode>('DRIVE');
  const [routes, setRoutes] = useState<TrafficRoute[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [computedAt, setComputedAt] = useState<string>('');
  const [showSteps, setShowSteps] = useState(false);

  const mapRef = useRef<MapView>(null);

  // ---------- origin from GPS ----------
  const locate = useCallback(async () => {
    setGpsError('');
    setLocating(true);
    try {
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((r) => setTimeout(() => r(null), 15000)),
      ]);
      const coords = pos?.coords ?? (await Location.getLastKnownPositionAsync())?.coords;
      if (!coords) {
        setGpsError("We couldn't get a GPS fix. Move to an open area or search for your starting point.");
        return;
      }
      let label = 'Current location';
      try {
        const [p] = await Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude });
        const parts = [p?.name || p?.street, p?.district || p?.city].filter(Boolean);
        if (parts.length) label = `Current location · ${parts.join(', ')}`;
      } catch {}
      setOrigin({ lat: coords.latitude, lng: coords.longitude, label, fromGps: true });
    } catch {
      setGpsError("We couldn't get your location. Search for your starting point instead.");
    } finally {
      setLocating(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        setPermState('granted');
        locate();
      } else {
        setPermState(perm.canAskAgain ? 'ask' : 'blocked');
      }
    })();
  }, [locate]);

  const allowLocation = async () => {
    const res = await Location.requestForegroundPermissionsAsync();
    if (res.status === 'granted') {
      setPermState('granted');
      locate();
    } else {
      setPermState(res.canAskAgain ? 'ask' : 'blocked');
    }
  };

  // ---------- destination / origin search ----------
  useEffect(() => {
    if (!activeField) return;
    const q = query.trim();
    abortRef.current?.abort();
    if (q.length < 2) {
      setSuggestions([]);
      setSearching(false);
      setSearchError('');
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await trafficApi.autocomplete(token, q, {
          near: origin ? { lat: origin.lat, lng: origin.lng } : null,
          session: session.current,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        setSuggestions(res);
        setSearchError(res.length ? '' : 'No places found. Try a different name or add the town.');
      } catch (e: any) {
        if (ctrl.signal.aborted || e?.name === 'CanceledError') return;
        setSuggestions([]);
        setSearchError(e?.response?.data?.error || e?.message || 'Search failed. Please try again.');
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => { clearTimeout(handle); ctrl.abort(); };
  }, [query, activeField, token]);

  const startSearch = (field: Field) => {
    setActiveField(field);
    setQuery('');
    setSuggestions([]);
    setSearchError('');
  };

  const pickSuggestion = async (s: PlaceSuggestion) => {
    const field = activeField;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const place = await trafficApi.placeDetails(token, s.place_id, session.current);
      const ep: Endpoint = { lat: place.lat, lng: place.lng, label: place.name || s.main_text };
      if (field === 'origin') setOrigin(ep);
      else setDestination(ep);
      setActiveField(null);
      setQuery('');
      setSuggestions([]);
      setRoutes([]);
      setSelectedId(null);
    } catch (e: any) {
      setSearchError(e?.response?.data?.error || 'That place could not be loaded. Please pick another.');
    } finally {
      session.current = newSession(); // a session ends with the details call
      setSearching(false);
    }
  };

  // ---------- routes ----------
  const findRoutes = useCallback(async (m: TravelMode = mode) => {
    if (!origin || !destination) return;
    setLoadingRoutes(true);
    setRouteError('');
    setShowSteps(false);
    try {
      const res = await trafficApi.routes(token, origin, destination, m);
      const list = res.routes || [];
      setRoutes(list);
      setComputedAt(res.computed_at);
      const best = list.find((r) => r.is_fastest) || list[0];
      setSelectedId(best?.id ?? null);
    } catch (e: any) {
      setRoutes([]);
      setSelectedId(null);
      setRouteError(e?.response?.data?.error || e?.message || "We couldn't find a route. Please try again.");
    } finally {
      setLoadingRoutes(false);
    }
  }, [origin, destination, mode, token]);

  // Recalculate automatically only when the trip itself changes.
  useEffect(() => {
    if (origin && destination) findRoutes(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, mode]);

  const decoded = useMemo(() => {
    const out: Record<string, { latitude: number; longitude: number }[]> = {};
    for (const r of routes) out[r.id] = r.polyline ? decodePolyline(r.polyline) : [];
    return out;
  }, [routes]);

  const selected = routes.find((r) => r.id === selectedId) || null;

  // Fit the map to the selected route.
  useEffect(() => {
    if (!selected || !googleRouteMapAvailable) return;
    const pts = decoded[selected.id];
    if (!pts?.length) return;
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: true,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [selected?.id, decoded]);

  const openInGoogleMaps = () => {
    if (!origin || !destination) return;
    const travelmode = MODES.find((m) => m.key === mode)?.gmaps || 'driving';
    const url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${origin.lat},${origin.lng}` +
      `&destination=${destination.lat},${destination.lng}` +
      `&travelmode=${travelmode}&dir_action=navigate`;
    Linking.openURL(url);
  };

  const swap = () => {
    if (!origin || !destination) return;
    setOrigin(destination);
    setDestination(origin);
  };

  // ---------- render helpers ----------
  const renderTrafficLines = (r: TrafficRoute) => {
    const pts = decoded[r.id] || [];
    if (pts.length < 2) return null;
    const lines = [
      <Polyline key={`${r.id}_base`} coordinates={pts} strokeColor={TRAFFIC_COLORS.NORMAL} strokeWidth={6} zIndex={2} />,
    ];
    r.traffic_segments
      .filter((s) => s.speed === 'SLOW' || s.speed === 'TRAFFIC_JAM')
      .forEach((s, i) => {
        const seg = pts.slice(s.start_index, s.end_index + 1);
        if (seg.length >= 2) {
          lines.push(
            <Polyline key={`${r.id}_seg_${i}`} coordinates={seg} strokeColor={TRAFFIC_COLORS[s.speed]} strokeWidth={6} zIndex={3} />,
          );
        }
      });
    return lines;
  };

  const tl = selected ? trafficLabel(selected) : null;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>SokoTraffic</Text>
          <Text style={styles.headerSub}>Compare live-traffic routes</Text>
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {/* Trip card */}
        <View style={styles.tripCard}>
          <View style={styles.tripRow}>
            <View style={[styles.dot, { backgroundColor: '#16a34a' }]} />
            <TouchableOpacity style={styles.tripField} onPress={() => startSearch('origin')}>
              <Text style={styles.tripLabel}>From</Text>
              {locating ? (
                <Text style={styles.tripValueMuted}>Finding your location…</Text>
              ) : (
                <Text style={origin ? styles.tripValue : styles.tripValueMuted} numberOfLines={1}>
                  {origin?.label || 'Choose a starting point'}
                </Text>
              )}
            </TouchableOpacity>
            {permState === 'granted' && !origin?.fromGps && !locating && (
              <TouchableOpacity onPress={locate} hitSlop={8} accessibilityLabel="Use my location">
                <Ionicons name="locate-outline" size={20} color="#FF8000" />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.tripDivider}>
            <View style={styles.tripLine} />
            {origin && destination ? (
              <TouchableOpacity onPress={swap} style={styles.swapBtn} accessibilityLabel="Swap start and destination">
                <Ionicons name="swap-vertical" size={16} color="#555" />
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.tripRow}>
            <View style={[styles.dot, { backgroundColor: '#dc2626' }]} />
            <TouchableOpacity style={styles.tripField} onPress={() => startSearch('destination')}>
              <Text style={styles.tripLabel}>To</Text>
              <Text style={destination ? styles.tripValue : styles.tripValueMuted} numberOfLines={1}>
                {destination?.label || 'Where are you going?'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Location permission explanation */}
        {(permState === 'ask' || permState === 'blocked') && !origin && (
          <View style={styles.infoCard}>
            <Ionicons name="navigate-circle-outline" size={26} color="#FF8000" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.infoTitle}>Start from where you are</Text>
              <Text style={styles.infoBody}>
                SokoTraffic uses your location only while you plan a route, to start it from where you are. It isn't
                stored or tracked. You can also search for a starting point instead.
              </Text>
              <TouchableOpacity
                style={styles.infoBtn}
                onPress={permState === 'ask' ? allowLocation : () => Linking.openSettings()}
              >
                <Text style={styles.infoBtnText}>{permState === 'ask' ? 'Use my location' : 'Open settings'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {!!gpsError && <Text style={styles.errorText}>{gpsError}</Text>}

        {/* Search panel */}
        {activeField && (
          <View style={styles.searchCard}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color="#888" />
              <TextInput
                style={styles.searchInput}
                autoFocus
                placeholder={activeField === 'origin' ? 'Search starting point' : 'Search destination'}
                placeholderTextColor="#aaa"
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
              />
              {searching ? <ActivityIndicator size="small" color="#FF8000" /> : null}
              <TouchableOpacity onPress={() => setActiveField(null)} hitSlop={8}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
            {suggestions.map((s) => (
              <TouchableOpacity key={s.place_id} style={styles.suggestion} onPress={() => pickSuggestion(s)}>
                <Ionicons name="location-outline" size={18} color="#FF8000" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.sugMain} numberOfLines={1}>{s.main_text}</Text>
                  {!!s.secondary_text && <Text style={styles.sugSub} numberOfLines={1}>{s.secondary_text}</Text>}
                </View>
              </TouchableOpacity>
            ))}
            {!!searchError && !searching && <Text style={styles.searchHint}>{searchError}</Text>}
            <Text style={styles.poweredBy}>Search powered by Google</Text>
          </View>
        )}

        {/* Travel mode */}
        <View style={styles.modes}>
          {MODES.map((m) => (
            <TouchableOpacity
              key={m.key}
              style={[styles.modeChip, mode === m.key && styles.modeChipActive]}
              onPress={() => setMode(m.key)}
            >
              <Ionicons name={m.icon as any} size={16} color={mode === m.key ? '#fff' : '#555'} />
              <Text style={[styles.modeText, mode === m.key && styles.modeTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Map */}
        {routes.length > 0 && googleRouteMapAvailable && origin && destination && (
          <View style={styles.mapWrap}>
            <MapView
              ref={mapRef}
              provider={Platform.OS === 'ios' ? PROVIDER_GOOGLE : undefined}
              style={StyleSheet.absoluteFill}
              initialRegion={{ latitude: origin.lat, longitude: origin.lng, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
              showsCompass={false}
              toolbarEnabled={false}
              showsTraffic={false}
            >
              {routes.filter((r) => r.id !== selectedId).map((r) => (
                <Polyline
                  key={r.id}
                  coordinates={decoded[r.id] || []}
                  strokeColor={ALT_COLOR}
                  strokeWidth={5}
                  tappable
                  onPress={() => setSelectedId(r.id)}
                  zIndex={1}
                />
              ))}
              {selected && renderTrafficLines(selected)}
              <Marker coordinate={{ latitude: origin.lat, longitude: origin.lng }} title="Start" pinColor="green" />
              <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} title={destination.label} pinColor="red" />
            </MapView>
          </View>
        )}
        {routes.length > 0 && !googleRouteMapAvailable && (
          <Text style={styles.noMap}>The route map isn't available in this version of the app — use "Start in Google Maps" below.</Text>
        )}

        {/* Routes */}
        {loadingRoutes && (
          <View style={styles.center}>
            <ActivityIndicator color="#FF8000" />
            <Text style={styles.muted}>Checking traffic…</Text>
          </View>
        )}
        {!!routeError && !loadingRoutes && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{routeError}</Text>
            <TouchableOpacity onPress={() => findRoutes()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
        {!loadingRoutes && !origin && !destination && !activeField && (
          <Text style={styles.empty}>Choose where you're going to compare routes with live traffic.</Text>
        )}

        {!loadingRoutes && routes.map((r, idx) => {
          const active = r.id === selectedId;
          return (
            <TouchableOpacity
              key={r.id}
              style={[styles.routeCard, active && styles.routeCardActive]}
              onPress={() => setSelectedId(r.id)}
              activeOpacity={0.85}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.badges}>
                  {r.is_fastest && <Text style={[styles.badge, styles.badgeFast]}>Fastest</Text>}
                  {r.is_shortest && <Text style={[styles.badge, styles.badgeShort]}>Shortest</Text>}
                  {!r.is_fastest && !r.is_shortest && <Text style={[styles.badge, styles.badgeAlt]}>Option {idx + 1}</Text>}
                </View>
                <Text style={styles.routeEta}>{formatDuration(r.duration_seconds)}</Text>
                <Text style={styles.routeMeta} numberOfLines={1}>
                  {formatDistance(r.distance_meters)}{r.description ? ` · via ${r.description}` : ''}
                </Text>
                {mode !== 'WALK' && r.delay_seconds >= 60 && (
                  <Text style={styles.delay}>+{formatDuration(r.delay_seconds)} due to traffic</Text>
                )}
              </View>
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? '#FF8000' : '#bbb'} />
            </TouchableOpacity>
          );
        })}

        {selected && !loadingRoutes && (
          <View style={styles.actions}>
            {tl && (
              <View style={styles.trafficRow}>
                <View style={[styles.trafficDot, { backgroundColor: tl.color }]} />
                <Text style={styles.trafficText}>{tl.text} on this route</Text>
              </View>
            )}
            <TouchableOpacity style={styles.primary} onPress={openInGoogleMaps}>
              <Ionicons name="navigate" size={18} color="#fff" />
              <Text style={styles.primaryText}>Start in Google Maps</Text>
            </TouchableOpacity>
            <Text style={styles.footnote}>Google Maps gives voice directions and may adjust the route as traffic changes.</Text>

            <View style={styles.secondaryRow}>
              <TouchableOpacity style={styles.secondary} onPress={() => setShowSteps((v) => !v)}>
                <Ionicons name="list-outline" size={16} color="#FF8000" />
                <Text style={styles.secondaryText}>{showSteps ? 'Hide directions' : 'Directions'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => findRoutes()}>
                <Ionicons name="refresh" size={16} color="#FF8000" />
                <Text style={styles.secondaryText}>Refresh traffic</Text>
              </TouchableOpacity>
            </View>

            {showSteps && (
              <View style={styles.steps}>
                {selected.steps.length === 0 && <Text style={styles.muted}>No step-by-step directions for this route.</Text>}
                {selected.steps.map((s, i) => (
                  <View key={i} style={styles.step}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stepText}>{s.instruction || 'Continue'}</Text>
                      <Text style={styles.stepMeta}>{formatDistance(s.distance_meters)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
            {!!computedAt && (
              <Text style={styles.footnote}>
                Estimates, not guarantees · updated {new Date(computedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · Routes by Google
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F8' },
  header: { backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  backBtn: { padding: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12 },

  tripCard: { backgroundColor: '#fff', margin: 16, marginBottom: 8, borderRadius: 16, padding: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tripField: { flex: 1, paddingVertical: 4 },
  tripLabel: { fontSize: 11, color: '#888', fontWeight: '600' },
  tripValue: { fontSize: 15, color: '#111', fontWeight: '600', marginTop: 1 },
  tripValueMuted: { fontSize: 15, color: '#aaa', marginTop: 1 },
  tripDivider: { flexDirection: 'row', alignItems: 'center', marginLeft: 4, height: 22 },
  tripLine: { width: 2, height: '100%', backgroundColor: '#e5e7eb' },
  swapBtn: { marginLeft: 'auto', padding: 4, backgroundColor: '#f3f4f6', borderRadius: 12 },

  infoCard: { flexDirection: 'row', backgroundColor: '#FFF4E8', marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 14 },
  infoTitle: { fontSize: 15, fontWeight: '700', color: '#111' },
  infoBody: { fontSize: 13, color: '#444', marginTop: 4, lineHeight: 18 },
  infoBtn: { alignSelf: 'flex-start', backgroundColor: '#FF8000', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, marginTop: 10 },
  infoBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  searchCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingBottom: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#111', paddingVertical: 6 },
  cancel: { color: '#FF8000', fontWeight: '600', fontSize: 14 },
  suggestion: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  sugMain: { fontSize: 14.5, color: '#111', fontWeight: '600' },
  sugSub: { fontSize: 12, color: '#888', marginTop: 1 },
  searchHint: { fontSize: 13, color: '#888', paddingVertical: 12, textAlign: 'center' },
  poweredBy: { fontSize: 10.5, color: '#aaa', textAlign: 'right', marginTop: 8 },

  modes: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  modeChipActive: { backgroundColor: '#FF8000', borderColor: '#FF8000' },
  modeText: { fontSize: 13, fontWeight: '600', color: '#555' },
  modeTextActive: { color: '#fff' },

  mapWrap: { height: 280, marginHorizontal: 16, marginTop: 14, borderRadius: 16, overflow: 'hidden', backgroundColor: '#e5e7eb' },
  noMap: { fontSize: 12.5, color: '#888', marginHorizontal: 16, marginTop: 14, textAlign: 'center' },

  center: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  muted: { fontSize: 13, color: '#888' },
  empty: { fontSize: 14, color: '#888', textAlign: 'center', marginHorizontal: 32, marginTop: 28 },
  errorText: { fontSize: 13, color: '#b91c1c', marginHorizontal: 16, marginTop: 8 },
  errorCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 14, borderRadius: 14, padding: 16, alignItems: 'center' },
  errorTitle: { fontSize: 14, color: '#333', textAlign: 'center' },
  retryBtn: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#FFF4E8' },
  retryText: { color: '#FF8000', fontWeight: '700' },

  routeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 10, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: 'transparent' },
  routeCardActive: { borderColor: '#FF8000' },
  badges: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  badge: { fontSize: 10.5, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  badgeFast: { backgroundColor: '#dcfce7', color: '#15803d' },
  badgeShort: { backgroundColor: '#dbeafe', color: '#1d4ed8' },
  badgeAlt: { backgroundColor: '#f3f4f6', color: '#555' },
  routeEta: { fontSize: 20, fontWeight: '800', color: '#111' },
  routeMeta: { fontSize: 13, color: '#666', marginTop: 1 },
  delay: { fontSize: 12, color: '#b45309', marginTop: 3, fontWeight: '600' },

  actions: { marginHorizontal: 16, marginTop: 14 },
  trafficRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  trafficDot: { width: 10, height: 10, borderRadius: 5 },
  trafficText: { fontSize: 13, color: '#333', fontWeight: '600' },
  primary: { flexDirection: 'row', gap: 8, backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  footnote: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 8 },
  secondaryRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondary: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: '#FFE0C2' },
  secondaryText: { color: '#FF8000', fontWeight: '700', fontSize: 13 },
  steps: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginTop: 12 },
  step: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#f0f0f0' },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFF4E8', color: '#FF8000', fontWeight: '700', fontSize: 12, textAlign: 'center', lineHeight: 22, overflow: 'hidden' },
  stepText: { fontSize: 13.5, color: '#222' },
  stepMeta: { fontSize: 11.5, color: '#999', marginTop: 1 },
});
