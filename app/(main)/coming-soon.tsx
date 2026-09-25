import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../../src/components/Text';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function ComingSoonScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="rocket-outline" size={80} color="#FF8000" />
        </View>
        <Text style={styles.title}>Coming Soon</Text>
        <Text style={styles.subtitle}>We’re building this module to bring you the full SuperApp experience. Stay tuned.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.replace('/home')}>
          <Text style={styles.btnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 32, alignItems: 'center', width: '100%', elevation: 3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  iconWrap: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#111827', marginTop: 20 },
  subtitle: { fontSize: 15, color: '#6b7280', textAlign: 'center', marginTop: 12, lineHeight: 22 },
  btn: { marginTop: 24, backgroundColor: '#FF8000', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 999 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});