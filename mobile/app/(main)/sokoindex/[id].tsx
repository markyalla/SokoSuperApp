import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, StatusBar, Modal, Alert, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { getArtisanDetail, createSokoIndexBooking, initializeSokoIndexPayment, verifySokoIndexPayment } from '../../../src/api';
import { ArtisanProfile, Portfolio } from '../../../src/types/sokoindex';
import ImagePreviewModal from '../../../src/components/ImagePreviewModal';
import PaystackModal from '../../../src/components/PaystackModal';
import { friendlyError } from '../../../src/utils/friendlyError';

// Best-effort device location capture for the booking — failures here must
// never block the booking itself, so any error just omits the location.
async function captureBookingLocation(): Promise<{ location_text?: string; location_lat?: number; location_lng?: number } | undefined> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return undefined;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = position.coords;
    let locationText: string | undefined;
    try {
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (place) {
        locationText = [place.street, place.district || place.city, place.region].filter(Boolean).join(', ');
      }
    } catch {}
    return { location_text: locationText, location_lat: latitude, location_lng: longitude };
  } catch {
    return undefined;
  }
}

export default function ArtisanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [artisan, setArtisan] = useState<ArtisanProfile | null>(null);
  const [artisanPhone, setArtisanPhone] = useState<string | null>(null);
  const [artisanEmail, setArtisanEmail] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookModal, setBookModal] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{ images: string[]; index: number } | null>(null);
  const [unlockRequired, setUnlockRequired] = useState(false);
  const [canBook, setCanBook] = useState(true);
  const [unlockFee, setUnlockFee] = useState(0);
  const [paying, setPaying] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await getArtisanDetail(id);
      setArtisan(res.data.artisan);
      setPortfolio(res.data.portfolio ?? []);
      setArtisanPhone(res.data.artisan_phone ?? null);
      setArtisanEmail(res.data.artisan_email ?? null);
      setUnlockRequired(!!res.data.contact_unlock_required);
      setCanBook(res.data.can_book !== false);
      setUnlockFee(res.data.unlock_fee_ghs ?? 0);
    } catch {
      Alert.alert('Error', 'Could not load this artisan.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleBook = async () => {
    if (!description.trim()) {
      Alert.alert('Error', 'Please describe the job you need done');
      return;
    }
    setSubmitting(true);
    try {
      const location = await captureBookingLocation();
      await createSokoIndexBooking(id, description.trim(), location);
      setBookModal(false);
      setDescription('');
      Alert.alert('Booking sent', 'The artisan will respond to your request soon.', [
        { text: 'View my bookings', onPress: () => router.push('/sokoindex/my-bookings' as any) },
        { text: 'OK' },
      ]);
    } catch (e: any) {
      Alert.alert('Failed', friendlyError(e, 'Could not create booking'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlock = async () => {
    setPaying(true);
    try {
      const res = await initializeSokoIndexPayment('contact_unlock');
      setPaymentRef(res.data.reference);
      setCheckoutUrl(res.data.checkout_url);
    } catch (e: any) {
      Alert.alert('Error', friendlyError(e, 'Could not start payment'));
      setPaying(false);
    }
  };

  const handleUnlockDone = async () => {
    try { await verifySokoIndexPayment(paymentRef); } catch { /* webhook may already have settled it */ }
    setPaying(false);
    fetchData();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF8000" />
      </View>
    );
  }

  if (!artisan) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Artisan not found.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{artisan.display_name}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <View style={styles.profileCard}>
          {artisan.profile_image_path ? (
            <TouchableOpacity onPress={() => setPreview({ images: [artisan.profile_image_path], index: 0 })}>
              <Image source={{ uri: artisan.profile_image_path }} style={styles.avatar} resizeMode="cover" />
            </TouchableOpacity>
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Ionicons name="hammer-outline" size={30} color="#FF8000" />
            </View>
          )}
          <Text style={styles.name}>{artisan.display_name}</Text>
          <Text style={styles.trade}>{artisan.trade_category}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{Number(artisan.avg_rating || 0).toFixed(1)} ⭐</Text>
              <Text style={styles.statLabel}>{artisan.rating_count} ratings</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{artisan.recommendation_count}</Text>
              <Text style={styles.statLabel}>Recommended</Text>
            </View>
          </View>

          {artisan.location_text ? (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={14} color="#6b7280" />
              <Text style={styles.locationText}>{artisan.location_text}</Text>
            </View>
          ) : null}

          {(artisanPhone || artisanEmail) ? (
            <View style={styles.contactBox}>
              {artisanPhone ? (
                <View style={styles.contactRow}>
                  <Ionicons name="call-outline" size={15} color="#16a34a" />
                  <Text style={styles.contactText}>{artisanPhone}</Text>
                </View>
              ) : null}
              {artisanEmail ? (
                <View style={styles.contactRow}>
                  <Ionicons name="mail-outline" size={15} color="#16a34a" />
                  <Text style={styles.contactText}>{artisanEmail}</Text>
                </View>
              ) : null}
            </View>
          ) : unlockRequired && !canBook ? (
            <TouchableOpacity style={styles.unlockBox} onPress={handleUnlock} disabled={paying}>
              <Ionicons name="lock-closed-outline" size={16} color="#FF8000" />
              {paying ? (
                <ActivityIndicator color="#FF8000" />
              ) : (
                <Text style={styles.unlockText}>Unlock contact info & booking — GHS {unlockFee.toFixed(2)}</Text>
              )}
            </TouchableOpacity>
          ) : null}

          {artisan.bio ? <Text style={styles.bio}>{artisan.bio}</Text> : null}
        </View>

        <Text style={styles.sectionTitle}>work done</Text>
        {portfolio.length === 0 ? (
          <Text style={styles.emptyText}>No approved work samples yet.</Text>
        ) : (
          <FlatList
            data={portfolio}
            keyExtractor={(p) => p.id}
            scrollEnabled={false}
            renderItem={({ item }) => {
              const images = [item.image_path_1, item.image_path_2, item.image_path_3, item.image_path_4].filter(Boolean) as string[];
              return (
                <View style={styles.portfolioCard}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.portfolioImages}>
                    {images.map((path, i) => (
                      <TouchableOpacity key={i} onPress={() => setPreview({ images, index: i })}>
                        <Image source={{ uri: path }} style={styles.portfolioImage} resizeMode="cover" />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={styles.portfolioTitle}>{item.title}</Text>
                  {item.description ? <Text style={styles.portfolioDesc}>{item.description}</Text> : null}
                </View>
              );
            }}
          />
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
        {canBook ? (
          <TouchableOpacity style={styles.bookBtn} onPress={() => setBookModal(true)}>
            <Ionicons name="calendar-outline" size={18} color="#fff" />
            <Text style={styles.bookBtnText}>Book this Artisan</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.bookBtn} onPress={handleUnlock} disabled={paying}>
            {paying ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="lock-closed-outline" size={18} color="#fff" />
                <Text style={styles.bookBtnText}>Unlock to Book — GHS {unlockFee.toFixed(2)}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      <PaystackModal
        visible={!!checkoutUrl && paying}
        checkoutUrl={checkoutUrl}
        onClose={() => setPaying(false)}
        onDone={handleUnlockDone}
      />

      <Modal visible={bookModal} transparent animationType="slide" onRequestClose={() => setBookModal(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Describe the job</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Fix a leaking kitchen sink"
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />
            <TouchableOpacity style={styles.modalSubmit} onPress={handleBook} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Send Booking Request</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setBookModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ImagePreviewModal
        visible={!!preview}
        images={preview?.images ?? []}
        initialIndex={preview?.index ?? 0}
        onClose={() => setPreview(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' },
  header: {
    backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
  profileCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20, alignItems: 'center', marginBottom: 20 },
  avatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 12 },
  avatarFallback: { backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '700', color: '#111827' },
  trade: { fontSize: 13, color: '#FF8000', fontWeight: '600', marginTop: 2 },
  statsRow: { flexDirection: 'row', marginTop: 14, backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, width: '100%' },
  statBox: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: '#e5e7eb' },
  statValue: { fontSize: 15, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
  locationText: { fontSize: 13, color: '#6b7280' },
  contactBox: { width: '100%', backgroundColor: '#f0fdf4', borderRadius: 12, padding: 12, marginTop: 12, gap: 6 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactText: { fontSize: 13, fontWeight: '600', color: '#16a34a' },
  unlockBox: { width: '100%', backgroundColor: '#fff7ed', borderRadius: 12, padding: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#FF8000' },
  unlockText: { fontSize: 13, fontWeight: '700', color: '#FF8000' },
  bio: { fontSize: 13, color: '#4b5563', marginTop: 12, lineHeight: 19, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  emptyText: { fontSize: 13, color: '#9ca3af' },
  portfolioCard: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 12 },
  portfolioImages: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  portfolioImage: { width: 90, height: 90, borderRadius: 10 },
  portfolioTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  portfolioDesc: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  bookBtn: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bookBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  modalInput: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#111827', textAlignVertical: 'top', minHeight: 90,
  },
  modalSubmit: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  modalSubmitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalCancel: { textAlign: 'center', color: '#6b7280', fontSize: 13, marginTop: 12 },
});
