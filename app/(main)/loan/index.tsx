import React from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function LoanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={[styles.hero, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Loan Services</Text>
        <Text style={styles.description}>Loan and credit routing will be available here soon.</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Ionicons name="cash-outline" size={24} color="#FF8000" />
          <Text style={styles.cardTitle}>Fast approvals</Text>
          <Text style={styles.cardText}>Personal and business credit options will appear here.</Text>
        </View>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push('/home')}>
          <Text style={styles.primaryBtnText}>Back to Home</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  hero: { backgroundColor: '#FF8000', paddingBottom: 24, paddingHorizontal: 20 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff' },
  description: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 6 },
  content: { padding: 16, paddingTop: 20 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 10 },
  cardText: { fontSize: 13, color: '#6b7280', marginTop: 4, lineHeight: 20 },
  primaryBtn: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});
