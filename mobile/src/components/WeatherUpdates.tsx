import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Linking, Modal, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { Text } from './Text';
import { useAuthStore } from '../store/authStore';
import { useOrderAssignmentStore } from '../store/orderAssignmentStore';
import { weatherApi } from '../api/geo';
import type { WeatherReport } from '../types/geo';

// Foreground-only weather popup, shown at most once every five hours while the
// app is open. No background task, no stored coordinates: the phone asks for
// its location only when a popup is due, and the server rounds it to ~1 km.
//
// Cadence (see SokoApp_Weather_and_SokoTraffic_Implementation_Plan.pdf §3.4):
//  - On foreground: if 5 h have passed since the last popup for THIS account,
//    fetch and show; otherwise arm a timer for the remaining time.
//  - Timers are cleared in the background and re-checked on resume, so a
//    boundary crossed while backgrounded shows one popup on return.
//  - Never stacks over the driver order popup or payment/booking flows —
//    it waits and re-checks a minute later.

const INTERVAL_MS = 5 * 60 * 60 * 1000;
const RETRY_BUSY_MS = 60 * 1000;          // a blocking screen/popup is open
const RETRY_FAILED_MS = 15 * 60 * 1000;   // offline / provider error
// Screens where an unprompted popup would interrupt money or a live task.
const BLOCKED_PATHS = [/checkout/i, /^\/delivery\/?$/, /^\/kyc/, /^\/traffic/, /ApplyDriver/, /sokoindex\/booking/];

const lastShownKey = (uid: string) => `weather:lastShown:${uid}`;
const optOutKey = (uid: string) => `weather:optOut:${uid}`;

type Phase = 'hidden' | 'ask' | 'blocked' | 'loading' | 'ready' | 'error';

async function getCoords(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
    ]);
    if (pos) return pos.coords;
  } catch {}
  try {
    const last = await Location.getLastKnownPositionAsync();
    return last?.coords ?? null;
  } catch {
    return null;
  }
}

async function placeLabel(lat: number, lng: number): Promise<string> {
  try {
    const [p] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!p) return '';
    return [p.district || p.city || p.subregion, p.region].filter(Boolean).join(', ');
  } catch {
    return '';
  }
}

function timeLabel(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function hourLabel(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric' });
}

export default function WeatherUpdates() {
  const { tokens, user } = useAuthStore() as any;
  const token: string | undefined = tokens?.access;
  const userId: string | undefined = user?.user?.id || user?.id;
  const pendingAssignment = useOrderAssignmentStore((s) => s.pendingAssignment);
  const pathname = usePathname();

  const [phase, setPhase] = useState<Phase>('hidden');
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [place, setPlace] = useState('');
  const [errorText, setErrorText] = useState('');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const disabled = useRef(false); // server says feature is off — stop until relaunch
  // Latest values for the timer/AppState callbacks.
  const live = useRef({ token, userId, pendingAssignment, pathname, phase });
  live.current = { token, userId, pendingAssignment, pathname, phase };

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const fetchAndShow = useCallback(async (interactive: boolean) => {
    const { token: t, userId: uid } = live.current;
    if (!t || !uid) return false;
    if (interactive) setPhase('loading');
    const coords = await getCoords();
    if (!coords) {
      if (interactive) {
        setErrorText("We couldn't find your location. Check that location is on and try again.");
        setPhase('error');
      }
      return false;
    }
    try {
      const [data, label] = await Promise.all([
        weatherApi.current(t, coords.latitude, coords.longitude),
        placeLabel(coords.latitude, coords.longitude),
      ]);
      // Signed out or switched account while loading — drop the result.
      if (live.current.userId !== uid) return false;
      setReport(data);
      setPlace(label);
      setPhase('ready');
      await AsyncStorage.setItem(lastShownKey(uid), String(Date.now()));
      return true;
    } catch (e: any) {
      const code = e?.response?.data?.code;
      if (code === 'not_configured' || code === 'no_coverage') disabled.current = true;
      if (interactive) {
        setErrorText(e?.response?.data?.error || "We couldn't load the weather. Please try again.");
        setPhase('error');
      }
      return false;
    }
  }, []);

  const schedule = (ms: number) => {
    clearTimer();
    timer.current = setTimeout(() => { check(); }, Math.max(1000, ms));
  };

  const check = useCallback(async () => {
    const { token: t, userId: uid, pendingAssignment: pa, pathname: path, phase: ph } = live.current;
    if (!t || !uid || disabled.current || running.current || ph !== 'hidden') return;
    if (AppState.currentState !== 'active') return;
    running.current = true;
    try {
      if ((await AsyncStorage.getItem(optOutKey(uid))) === '1') return;

      const last = Number((await AsyncStorage.getItem(lastShownKey(uid))) || 0);
      const due = last + INTERVAL_MS - Date.now();
      if (due > 0) {
        schedule(due);
        return;
      }
      if (pa || BLOCKED_PATHS.some((re) => re.test(path || ''))) {
        schedule(RETRY_BUSY_MS);
        return;
      }

      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        // Explain first; the system prompt only appears if they tap Allow.
        setPhase(perm.canAskAgain ? 'ask' : 'blocked');
        return;
      }
      const ok = await fetchAndShow(false);
      if (!ok && !disabled.current) schedule(RETRY_FAILED_MS);
    } finally {
      running.current = false;
    }
  }, [fetchAndShow]);

  // Foreground/background handling.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
      else clearTimer();
    });
    return () => { sub.remove(); clearTimer(); };
  }, [check]);

  // First run, and whenever the signed-in account changes.
  useEffect(() => {
    clearTimer();
    setPhase('hidden');
    setReport(null);
    disabled.current = false;
    if (!token || !userId) return;
    const t = setTimeout(check, 4000); // let the home screen settle first
    return () => clearTimeout(t);
  }, [token, userId, check]);

  // Snooze for 5 h whenever the popup is closed, whatever state it was in.
  const dismiss = async () => {
    setPhase('hidden');
    const uid = live.current.userId;
    if (uid) await AsyncStorage.setItem(lastShownKey(uid), String(Date.now()));
    schedule(INTERVAL_MS);
  };

  const turnOff = async () => {
    const uid = live.current.userId;
    if (uid) await AsyncStorage.setItem(optOutKey(uid), '1');
    clearTimer();
    setPhase('hidden');
  };

  const allow = async () => {
    const res = await Location.requestForegroundPermissionsAsync();
    if (res.status === 'granted') fetchAndShow(true);
    else setPhase(res.canAskAgain ? 'ask' : 'blocked');
  };

  if (phase === 'hidden') return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={dismiss}>
        <Pressable style={styles.card} onPress={() => {}}>
          <TouchableOpacity style={styles.close} onPress={dismiss} hitSlop={10} accessibilityLabel="Close weather">
            <Ionicons name="close" size={20} color="#555" />
          </TouchableOpacity>

          {(phase === 'ask' || phase === 'blocked') && (
            <>
              <View style={styles.iconBubble}>
                <Ionicons name="partly-sunny-outline" size={30} color="#FF8000" />
              </View>
              <Text style={styles.title}>Weather where you are</Text>
              <Text style={styles.body}>
                MySokoApp can show you a short weather update every few hours while the app is open. We use your
                location only to look up the weather at that moment — it isn't stored or tracked.
              </Text>
              {phase === 'ask' ? (
                <TouchableOpacity style={styles.primary} onPress={allow}>
                  <Text style={styles.primaryText}>Allow location</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.primary} onPress={() => Linking.openSettings()}>
                  <Text style={styles.primaryText}>Open settings</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={dismiss}><Text style={styles.link}>Not now</Text></TouchableOpacity>
              <TouchableOpacity onPress={turnOff}><Text style={styles.subtleLink}>Don't show weather updates</Text></TouchableOpacity>
            </>
          )}

          {phase === 'loading' && (
            <View style={styles.center}>
              <ActivityIndicator color="#FF8000" size="large" />
              <Text style={styles.body}>Checking the weather…</Text>
            </View>
          )}

          {phase === 'error' && (
            <>
              <View style={styles.iconBubble}>
                <Ionicons name="cloud-offline-outline" size={30} color="#FF8000" />
              </View>
              <Text style={styles.title}>Weather unavailable</Text>
              <Text style={styles.body}>{errorText}</Text>
              <TouchableOpacity style={styles.primary} onPress={() => fetchAndShow(true)}>
                <Text style={styles.primaryText}>Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={dismiss}><Text style={styles.link}>Close</Text></TouchableOpacity>
            </>
          )}

          {phase === 'ready' && report && (
            <>
              {!!place && (
                <View style={styles.placeRow}>
                  <Ionicons name="location-outline" size={14} color="#888" />
                  <Text style={styles.place} numberOfLines={1}>{place}</Text>
                </View>
              )}
              <View style={styles.nowRow}>
                {report.icon_url ? (
                  <Image source={{ uri: report.icon_url }} style={styles.nowIcon} />
                ) : (
                  <Ionicons name="partly-sunny-outline" size={56} color="#FF8000" />
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.temp}>{Math.round(report.temp_c)}°C</Text>
                  <Text style={styles.condition}>{report.condition || '—'}</Text>
                  <Text style={styles.meta}>Feels like {Math.round(report.feels_like_c)}°C</Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <Stat icon="umbrella-outline" label="Rain" value={`${report.precip_chance}%`} />
                <Stat icon="water-outline" label="Humidity" value={`${report.humidity_pct}%`} />
                <Stat icon="speedometer-outline" label="Wind" value={`${Math.round(report.wind_kph)} km/h`} />
              </View>

              {report.precip_chance >= 50 && (
                <View style={styles.alert}>
                  <Ionicons name="rainy-outline" size={16} color="#b45309" />
                  <Text style={styles.alertText}>Rain is likely — plan deliveries and trips with extra time.</Text>
                </View>
              )}

              {report.hourly.length > 0 && (
                <View style={styles.hoursRow}>
                  {report.hourly.slice(0, 5).map((h) => (
                    <View key={h.time} style={styles.hour}>
                      <Text style={styles.hourTime}>{hourLabel(h.time)}</Text>
                      {h.icon_url ? <Image source={{ uri: h.icon_url }} style={styles.hourIcon} /> : null}
                      <Text style={styles.hourTemp}>{Math.round(h.temp_c)}°</Text>
                      <Text style={styles.hourRain}>{h.precip_chance}%</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.updated}>
                Updated {timeLabel(report.time) || 'just now'} · {report.source}
              </Text>
              <TouchableOpacity style={styles.primary} onPress={dismiss}>
                <Text style={styles.primaryText}>Got it</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={turnOff}><Text style={styles.subtleLink}>Don't show weather updates</Text></TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Stat({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon as any} size={16} color="#FF8000" />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, paddingTop: 22 },
  close: { position: 'absolute', top: 12, right: 12, zIndex: 2, padding: 4 },
  center: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  iconBubble: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF4E8', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 14, color: '#444', textAlign: 'center', lineHeight: 20 },
  primary: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  link: { textAlign: 'center', color: '#111', fontSize: 14, paddingVertical: 10 },
  subtleLink: { textAlign: 'center', color: '#999', fontSize: 12, paddingTop: 4 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6, marginRight: 28 },
  place: { fontSize: 13, color: '#888', flexShrink: 1 },
  nowRow: { flexDirection: 'row', alignItems: 'center' },
  nowIcon: { width: 64, height: 64 },
  temp: { fontSize: 36, fontWeight: '800', color: '#111' },
  condition: { fontSize: 15, color: '#333', fontWeight: '600' },
  meta: { fontSize: 12, color: '#888', marginTop: 2 },
  statsRow: { flexDirection: 'row', marginTop: 16, backgroundColor: '#FFF8F0', borderRadius: 14, paddingVertical: 10 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 14, fontWeight: '700', color: '#111' },
  statLabel: { fontSize: 11, color: '#888' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 12, padding: 10, marginTop: 12 },
  alertText: { flex: 1, fontSize: 12.5, color: '#92400e' },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  hour: { alignItems: 'center', flex: 1 },
  hourTime: { fontSize: 11, color: '#888' },
  hourIcon: { width: 28, height: 28, marginVertical: 2 },
  hourTemp: { fontSize: 13, fontWeight: '700', color: '#111' },
  hourRain: { fontSize: 10.5, color: '#2563eb' },
  updated: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 14 },
});
