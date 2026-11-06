import React, { useEffect } from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from '../../src/components/Text';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';

export default function WelcomeScreen() {
  const router = useRouter();
  const { tokens, loading, loadStoredAuth } = useAuthStore();

  useEffect(() => {
    loadStoredAuth();
  }, []);

  useEffect(() => {
    if (!loading && tokens) {
      router.replace('/home');
    }
  }, [loading, tokens]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF8000" />
        <Text style={styles.message}>Loading session…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.heroCard}>
        <View style={styles.iconWrap}>
          <Ionicons name="apps-outline" size={40} color="#FF8000" />
        </View>
        <Text style={styles.title}>Welcome to SuperApp</Text>
        <Text style={styles.subtitle}>One account, access all services.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/login')}>
          <Text style={styles.primaryBtnText}>Login</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/register')}>
          <Text style={styles.secondaryBtnText}>Create Account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f5f5f5' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  heroCard: { backgroundColor: '#fff', borderRadius: 24, padding: 28, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  iconWrap: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#111827', marginBottom: 8 },
  subtitle: { fontSize: 15, marginBottom: 24, color: '#6b7280', lineHeight: 22 },
  message: { marginTop: 12, fontSize: 16, color: '#6b7280' },
  primaryBtn: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  secondaryBtnText: { color: '#374151', fontWeight: '700' },
});
