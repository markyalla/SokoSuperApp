import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import JailMonkey from 'jail-monkey';

export type DebugModeStatus = 'checking' | 'clean' | 'debug';

// Flags a device with Android developer options / USB debugging turned on, or
// with a debugger attached to the app. Skipped in __DEV__ (dev builds run with
// USB debugging on by definition) and on web, where there is no native module.
// Re-runs whenever the app returns to the foreground so a user who switches the
// setting off in system settings gets straight back in.
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
      setStatus(debugged || devSettings || adb ? 'debug' : 'clean');
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
