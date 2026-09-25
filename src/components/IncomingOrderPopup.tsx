import React, { useEffect, useState } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useOrderAssignmentStore } from '../store/orderAssignmentStore';

const ASSIGNMENT_WINDOW_MS = 5 * 60 * 1000;

// Mirrors the countdown math used for delivery cards on the driver dashboard
// (5-minute window, ticking every second) — surfaced here as a global popup
// so it's visible no matter which screen the driver is on.
function getRemainingTime(assignedAt: string, now: Date): string | null {
  const assignedTime = new Date(assignedAt).getTime();
  const diff = ASSIGNMENT_WINDOW_MS - (now.getTime() - assignedTime);
  if (diff <= 0) return null;
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function IncomingOrderPopup() {
  const router = useRouter();
  const { pendingAssignment, clear } = useOrderAssignmentStore();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!pendingAssignment) return;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [pendingAssignment]);

  if (!pendingAssignment) return null;

  const remaining = getRemainingTime(pendingAssignment.assignedAt, now);
  if (!remaining) {
    clear();
    return null;
  }

  const handleView = () => {
    clear();
    router.push('/driver' as any);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={clear}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconBadge}>
            <Ionicons name="cube-outline" size={26} color="#fff" />
          </View>
          <Text style={styles.title}>New Delivery Assigned</Text>
          <Text style={styles.subtitle}>Respond before the assignment expires</Text>
          <Text style={styles.countdown}>{remaining}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.dismissBtn} onPress={clear}>
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.viewBtn} onPress={handleView}>
              <Text style={styles.viewText}>View Order</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center' },
  iconBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FF8000', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4, textAlign: 'center' },
  countdown: { fontSize: 34, fontWeight: '800', color: '#dc2626', marginVertical: 16 },
  actions: { flexDirection: 'row', gap: 10, width: '100%' },
  dismissBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1.5, borderColor: '#e5e7eb' },
  dismissText: { color: '#6b7280', fontWeight: '700', fontSize: 14 },
  viewBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#FF8000' },
  viewText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
