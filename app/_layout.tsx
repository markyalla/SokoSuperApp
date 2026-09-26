import { useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import '../src/services/locationTask';
import '../src/services/notificationHandler';
import { Text } from '../src/components/Text';
import { useDebugModeCheck } from '../src/hooks/useDebugModeCheck';

export default function Layout() {
  const { status, recheck } = useDebugModeCheck();
  // Dismissing the Developer-options warning lasts until the app is fully closed.
  const [warnDismissed, setWarnDismissed] = useState(false);

  const openDevSettings = () =>
    Linking.sendIntent('android.settings.APPLICATION_DEVELOPMENT_SETTINGS').catch(() =>
      Linking.openSettings()
    );

  if (status === 'checking') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#FF8000" />
      </View>
    );
  }

  if (status === 'debug') {
    // A debugger is attached to the app — block.
    return (
      <View style={styles.center}>
        <Ionicons name="shield-outline" size={56} color="#FF8000" />
        <Text style={styles.title}>Debugging detected</Text>
        <Text style={styles.body}>
          For your security, SokoApp can't run while a debugger is attached to it. Disconnect the
          debugger (or restart your phone), then come back to the app.
        </Text>
        <Pressable style={[styles.button, styles.secondary]} onPress={recheck}>
          <Text style={[styles.buttonText, styles.secondaryText]}>Check again</Text>
        </Pressable>
      </View>
    );
  }

  if (status === 'warn' && !warnDismissed) {
    // Developer options / USB debugging on — warn, but let the user continue.
    return (
      <View style={styles.center}>
        <Ionicons name="warning-outline" size={56} color="#FF8000" />
        <Text style={styles.title}>Developer options are on</Text>
        <Text style={styles.body}>
          Your phone has Developer options or USB debugging turned on. This makes your phone less
          secure. For the safest experience with your account and payments, turn them off in your
          phone's settings.
        </Text>
        {Platform.OS === 'android' && (
          <Pressable style={styles.button} onPress={openDevSettings}>
            <Text style={styles.buttonText}>Open settings</Text>
          </Pressable>
        )}
        <Pressable style={[styles.button, styles.secondary]} onPress={() => setWarnDismissed(true)}>
          <Text style={[styles.buttonText, styles.secondaryText]}>Continue anyway</Text>
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={recheck}>
          <Text style={styles.linkText}>Check again</Text>
        </Pressable>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  title: { fontSize: 20, fontWeight: '700', marginTop: 16, color: '#111827' },
  body: { fontSize: 15, color: '#4b5563', textAlign: 'center', marginTop: 8, lineHeight: 22 },
  button: {
    marginTop: 24,
    backgroundColor: '#FF8000',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 10,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  secondary: { marginTop: 12, backgroundColor: 'transparent', borderWidth: 1, borderColor: '#FF8000' },
  secondaryText: { color: '#FF8000' },
  linkBtn: { marginTop: 14, padding: 6 },
  linkText: { color: '#6b7280', fontSize: 14, textDecorationLine: 'underline' },
});
