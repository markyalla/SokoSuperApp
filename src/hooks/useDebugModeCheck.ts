import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import JailMonkey from 'jail-monkey';

// 'debug' — a debugger is attached to the app: block (real tampering risk).
// 'warn'  — Developer options / USB debugging are on: warn but let the user
//           continue. Many ordinary phones (and Google's review/test devices)
//           have these on, so blocking them would lock out real users.
export type DebugModeStatus = 'checking' | 'clean' | 'warn' | 'debug';

// Skipped in __DEV__ (dev builds run with a debugger/USB debugging by
// definition) and on web, where there is no native module. Re-runs whenever
// the app returns to the foreground so a user who changes the setting in
// system settings gets the right screen straight away.
export function useDebugModeCheck() {
  const [status, setStatus] = useState<DebugModeStatus>(
    __DEV__ || Platform.OS === 'web' ? 'clean' : 'checking'
  );

  const check = useCallback(async () => {
    if (__DEV__ || Platform.OS === 'web') return;
    try {
      const [debugged, devSettings] = await Promise.all([
        JailMonkey.isDebuggedMode(),
        JailMonkey.isDevelopmentSettingsMode(),
      ]);
      const adb = JailMonkey.AdbEnabled();
      setStatus(debugged ? 'debug' : devSettings || adb ? 'warn' : 'clean');
    } catch (e) {
      // Native module not linked (e.g. Expo Go) — don't lock users out over it.
      console.warn('[useDebugModeCheck] jail-monkey unavailable:', e);
      setStatus('clean');
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  return { status, recheck: check };
}
