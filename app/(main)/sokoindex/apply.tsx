import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, StatusBar, Modal, SectionList } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { applyAsArtisan } from '../../../src/api';
import { useAuthStore } from '../../../src/store/authStore';

// Grouped by trade family so the picker reads as sections rather than one long
// alphabetical dump. Presented as a modal (not inline chips) since the list is broad.
const TRADE_CATEGORIES: { section: string; items: string[] }[] = [
  {
    section: 'Construction & Building',
    items: [
      'Plumber', 'Electrician', 'Carpenter', 'Mason/Bricklayer', 'Painter', 'Welder',
      'Tiler', 'Roofer', 'Plasterer', 'Aluminum/Window Fabricator', 'POP/Ceiling Installer',
      'Scaffolder', 'Screed/Terrazzo Worker', 'Borehole Driller/Pump Mechanic',
      'Metal Fabricator/Welding Fitter', 'Blacksmith',
    ],
  },
  {
    section: 'Auto & Transport',
    items: [
      'Mechanic', 'Auto Electrician', 'Spray Painter/Auto Body Repair', 'Vulcanizer',
      'Motorbike/Okada Mechanic', 'Bicycle Repairer',
    ],
  },
  {
    section: 'Home & Electronics',
    items: [
      'AC/Refrigeration Technician', 'Generator Technician', 'Solar Installer',
      'Inverter/Battery Technician', 'CCTV/Security System Installer',
      'Satellite Dish/DSTV Installer', 'Phone Repair Technician', 'Computer Repair Technician',
      'Appliance Repair Technician', 'Locksmith',
    ],
  },
  {
    section: 'Beauty & Fashion',
    items: [
      'Tailor/Seamstress', 'Fashion Designer', 'Shoe Repair/Cobbler', 'Leather Worker/Bag Maker',
      'Jewelry Maker', 'Hairdresser', 'Hair Braider/Weavonist', 'Barber', 'Makeup Artist',
      'Nail Technician',
    ],
  },
  {
    section: 'Events & Creative',
    items: [
      'Photographer', 'Videographer', 'Event Planner', 'Event Decorator', 'DJ/MC',
      'Sound Engineer', 'Tent & Canopy Rental/Setup', 'Signage/Branding Artist',
      'Wood Carver/Sculptor', 'Basket/Craft Weaver', 'Interior Decorator',
    ],
  },
  {
    section: 'Information Technology',
    items: [
      'Web Developer', 'Software Developer', 'Mobile App Developer', 'Graphic Designer',
      'UI/UX Designer', 'IT Support Technician', 'Network Technician', 'Digital Marketer',
      'Social Media Manager', 'Data Analyst',
    ],
  },
  {
    section: 'Home Services',
    items: [
      'Cleaner', 'Laundry/Dry Cleaner', 'Gardener/Landscaper', 'Pest Control',
      'Mover/Logistics', 'Furniture Polisher', 'Cabinet Maker', 'Upholsterer', 'Caterer', 'Baker',
    ],
  },
  {
    section: 'Other',
    items: ['Other'],
  },
];

export default function ApplyArtisanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { kycStatus } = useAuthStore() as any;
  const [loading, setLoading] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [bio, setBio] = useState('');
  const [tradeCategory, setTradeCategory] = useState('');
  const [locationText, setLocationText] = useState('');

  const kycApproved = String(kycStatus ?? '').toLowerCase() === 'approved';

  const handleSubmit = async () => {
    if (!tradeCategory || !bio.trim()) {
      Alert.alert('Error', 'Please describe your work and select a trade category');
      return;
    }

    setLoading(true);
    try {
      await applyAsArtisan({
        bio: bio.trim(),
        trade_category: tradeCategory,
        location_text: locationText.trim() || undefined,
      });
      Alert.alert('Success', 'Application submitted! Our team will review it soon.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Failed', e.response?.data?.error || 'Could not submit application');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.headerBar, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Become an Artisan</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.iconWrap}>
            <Ionicons name="hammer-outline" size={28} color="#FF8000" />
          </View>
          <Text style={styles.header}>Get discovered on MySokoIndex</Text>
          <Text style={styles.sub}>Add work samples, get booked for jobs, and grow your reputation.</Text>
        </View>

        {!kycApproved && (
          <TouchableOpacity style={styles.kycWarning} onPress={() => router.push('/(auth)/kyc' as any)}>
            <Ionicons name="alert-circle-outline" size={18} color="#92400e" />
            <Text style={styles.kycWarningText}>
              Your identity must be verified before you can apply. Tap here to complete verification — we use it to verify artisans instead of asking for your ID again.
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.formCard}>
          <Text style={styles.label}>Trade Category</Text>
          <TouchableOpacity style={styles.selectBox} onPress={() => setCategoryModal(true)}>
            <Text style={tradeCategory ? styles.selectText : styles.selectPlaceholder}>
              {tradeCategory || 'Select your trade'}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#9ca3af" />
          </TouchableOpacity>

          <Text style={styles.label}>Describe your work</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Tell customers what you do and your experience"
            placeholderTextColor="#9ca3af"
            value={bio}
            onChangeText={setBio}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.label}>Location (optional)</Text>
          <TextInput style={styles.input} placeholder="e.g. Osu, Accra" placeholderTextColor="#9ca3af" value={locationText} onChangeText={setLocationText} />

          <TouchableOpacity style={styles.btn} onPress={handleSubmit} disabled={loading || !kycApproved}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Submit Application</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={categoryModal} animationType="slide" onRequestClose={() => setCategoryModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['left', 'right']}>
          <View style={[styles.headerBar, { paddingTop: insets.top + 14 }]}>
            <TouchableOpacity onPress={() => setCategoryModal(false)} style={styles.backBtn}>
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Select Trade</Text>
            <View style={{ width: 40 }} />
          </View>
          <SectionList
            sections={TRADE_CATEGORIES.map((g) => ({ title: g.section, data: g.items }))}
            keyExtractor={(item) => item}
            stickySectionHeadersEnabled
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{section.title}</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.categoryRow}
                onPress={() => { setTradeCategory(item); setCategoryModal(false); }}
              >
                <Text style={styles.categoryRowText}>{item}</Text>
                {tradeCategory === item && <Ionicons name="checkmark" size={18} color="#FF8000" />}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32, backgroundColor: '#f9fafb' },
  headerBar: { backgroundColor: '#FF8000', paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center', marginRight: 40 },
  heroCard: { backgroundColor: '#fff', borderRadius: 20, padding: 20, marginTop: 16, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  iconWrap: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  header: { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' },
  sub: { fontSize: 14, color: '#6b7280', marginTop: 6, textAlign: 'center', lineHeight: 20 },
  kycWarning: { flexDirection: 'row', gap: 8, backgroundColor: '#fffbeb', borderRadius: 12, padding: 14, marginTop: 16 },
  kycWarningText: { flex: 1, fontSize: 12, color: '#92400e', lineHeight: 17 },
  formCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, marginTop: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  label: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14, fontSize: 15, color: '#111827',
  },
  textArea: { textAlignVertical: 'top', minHeight: 90 },
  selectBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14,
  },
  selectText: { flex: 1, fontSize: 15, color: '#111827', marginRight: 8 },
  selectPlaceholder: { flex: 1, fontSize: 15, color: '#9ca3af', marginRight: 8 },
  btn: { backgroundColor: '#FF8000', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  categoryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  categoryRowText: { flex: 1, fontSize: 15, color: '#111827', marginRight: 8 },
  sectionHeader: { backgroundColor: '#f9fafb', paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  sectionHeaderText: { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
});
