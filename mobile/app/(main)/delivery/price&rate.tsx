import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function PriceRatesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const rates = [
    { vehicle: 'Bicycle',   base: 'GH₵ 5.00',  perKm: 'GH₵ 1.50',  icon: 'bicycle-outline' },
    { vehicle: 'Motorbike', base: 'GH₵ 10.00', perKm: 'GH₵ 2.50',  icon: 'speedometer-outline' },
    { vehicle: 'Car',       base: 'GH₵ 25.00', perKm: 'GH₵ 4.00',  icon: 'car-outline' },
    { vehicle: 'Van',       base: 'GH₵ 40.00', perKm: 'GH₵ 6.00',  icon: 'bus-outline' },
    { vehicle: 'Truck',     base: 'GH₵ 80.00', perKm: 'GH₵ 10.00', icon: 'cube-outline' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Pricing & Rates</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>Transparent pricing for all your delivery needs.</Text>
        
        {rates.map((item) => (
          <View key={item.vehicle} style={styles.rateCard}>
            <View style={styles.iconContainer}>
              <Ionicons name={item.icon as any} size={32} color="#FF8000" />
            </View>
            <View style={styles.rateInfo}>
              <Text style={styles.vehicleName}>{item.vehicle}</Text>
              <Text style={styles.rateDetail}>Base Fare: <Text style={styles.bold}>{item.base}</Text></Text>
              <Text style={styles.rateDetail}>Distance: <Text style={styles.bold}>{item.perKm}/km</Text></Text>
            </View>
          </View>
        ))}

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={24} color="#0F6E56" />
          <Text style={styles.infoText}>
            Final prices are calculated based on the shortest route and real-time demand. 
            Wait time fees may apply after 5 minutes of arrival.
          </Text>
        </View>

        <TouchableOpacity 
          style={styles.bookBtn}
          onPress={() => router.push('/delivery')}
        >
          <Text style={styles.bookBtnText}>Estimate My Delivery</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, backgroundColor: '#FF8000' },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: 'bold', marginLeft: 16, color: '#fff' },
  content: { padding: 20 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 24 },
  rateCard: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  iconContainer: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#E1F5EE', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  rateInfo: { flex: 1 },
  vehicleName: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  rateDetail: { fontSize: 14, color: '#666' },
  bold: { fontWeight: 'bold', color: '#FF8000' },
  infoBox: { flexDirection: 'row', backgroundColor: '#E1F5EE', borderRadius: 12, padding: 16, marginTop: 10, gap: 12 },
  infoText: { flex: 1, fontSize: 13, color: '#FF8000', lineHeight: 20 },
  bookBtn: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 32 },
  bookBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});