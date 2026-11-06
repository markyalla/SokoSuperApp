import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useRealtimeUpdates } from '../../src/hooks/useRealtimeUpdates';
import { useDriverAssignmentAlerts } from '../../src/hooks/useDriverAssignmentAlerts';
import Toast from '../../src/components/Toast';
import IncomingOrderPopup from '../../src/components/IncomingOrderPopup';
import WeatherUpdates from '../../src/components/WeatherUpdates';

export default function MainLayout() {
  const router = useRouter();
  const { toast, hideToast } = useRealtimeUpdates();
  useDriverAssignmentAlerts();

  const handleToastAction = () => {
    hideToast();
    if (toast.message.includes('order')) {
      router.push('/shopper/MyOrdersScreen' as any);
    } else if (toast.message.includes('package') || toast.message.includes('delivery') || toast.message.includes('parcel')) {
      router.push('/delivery/track' as any);
    }
  };

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }} />
      <Toast
        visible={toast.visible}
        message={toast.message}
        actionLabel={toast.actionLabel}
        onAction={handleToastAction}
        onHide={hideToast}
      />
      <IncomingOrderPopup />
      <WeatherUpdates />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
