import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { applyDriver } from '../../../src/api';

export default function ApplyDriverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [vehicleType, setVehicleType] = useState('motorcycle');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');

  const handleSubmit = async () => {
    if (!vehicleModel || !vehiclePlate || !licenseNumber) {
      Alert.alert('Error', 'Please fill in all details');
      return;
    }

    setLoading(true);
    try {
      await applyDriver({
        vehicle_type: vehicleType,
        vehicle_model: vehicleModel,
        vehicle_plate: vehiclePlate,
        license_number: licenseNumber,
      });
      Alert.alert('Success', 'Application submitted! We will review your details soon.', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (e: any) {
      Alert.alert('Failed', e.response?.data?.error || 'Could not submit application');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.headerBar, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Apply to Drive</Text>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.iconWrap}>
            <Ionicons name="bicycle-outline" size={28} color="#FF8000" />
          </View>
          <Text style={styles.header}>Earn with every delivery</Text>
          <Text style={styles.sub}>Share your vehicle details and start accepting jobs on SokoApp.</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.label}>Vehicle Type</Text>
          <View style={styles.row}>
            {['bicycle', 'motorcycle', 'car', 'van', 'truck'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, vehicleType === t && styles.chipActive]}
                onPress={() => setVehicleType(t)}
              >
                <Text style={[styles.chipText, vehicleType === t && styles.chipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Vehicle Model</Text>
          <TextInput style={styles.input} placeholder="e.g. Royal 125, Toyota Vitz" placeholderTextColor="#9ca3af" value={vehicleModel} onChangeText={setVehicleModel} />

          <Text style={styles.label}>Number Plate</Text>
          <TextInput style={styles.input} placeholder="e.g. GR-123-24" placeholderTextColor="#9ca3af" value={vehiclePlate} onChangeText={setVehiclePlate} />

          <Text style={styles.label}>License Number</Text>
          <TextInput style={styles.input} placeholder="Your driver's license number" placeholderTextColor="#9ca3af" value={licenseNumber} onChangeText={setLicenseNumber} />

          <TouchableOpacity style={styles.btn} onPress={handleSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Submit Application</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 16, paddingBottom: 32, backgroundColor: '#f9fafb' },
  headerBar: { backgroundColor: '#FF8000', paddingBottom: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginRight: 40 },
  heroCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, marginTop: 16, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  iconWrap: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  header: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  sub: { fontSize: 14, color: '#6b7280', marginTop: 6, textAlign: 'center', lineHeight: 20 },
  formCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, marginTop: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  label: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14, fontSize: 15, color: '#111827'
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  chip: {
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999,
    backgroundColor: '#f3f4f6', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb'
  },
  chipActive: { backgroundColor: '#FF8000', borderColor: '#FF8000' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  chipTextActive: { color: '#fff' },
  btn: {
    backgroundColor: '#FF8000', paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 12
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 }
});