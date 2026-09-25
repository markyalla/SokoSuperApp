import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Image, ActivityIndicator, RefreshControl, StatusBar } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  listMySokoIndexBookings, listIncomingSokoIndexBookings, getSokoIndexMe,
  initializeSokoIndexPayment, verifySokoIndexPayment,
} from '../../../src/api';
import { useAuthStore } from '../../../src/store/authStore';
import PaystackModal from '../../../src/components/PaystackModal';

const STATUS_COLOR: Record<string, string> = {
  pending: '#d97706',
  accepted: '#2563eb',
  awaiting_confirmation: '#0891b2',
  completed: '#16a34a',
  rejected: '#dc2626',
  cancelled: '#6b7280',
};

function BookingCard({ booking, isArtisanView, onPress }: { booking: any; isArtisanView: boolean; onPress: () => void }) {
  const color = STATUS_COLOR[booking.status] ?? '#9ca3af';
  const title = isArtisanView ? (booking.customer?.full_name ?? 'Customer') : (booking.artisan?.display_name ?? 'Artisan');
  const meta = isArtisanView ? (booking.customer?.location_text ?? '') : (booking.artisan?.trade_category ?? '');
  const avatarUri = isArtisanView ? booking.customer?.profile_image_url : booking.artisan?.profile_image_path;
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardTop}>
        <View style={styles.identityRow}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Ionicons name={isArtisanView ? 'person-outline' : 'hammer-outline'} size={14} color="#FF8000" />
            </View>
          )}
          <Text style={styles.cardName}>{title}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: color + '22' }]}>
          <Text style={[styles.statusText, { color }]}>{booking.status.replace(/_/g, ' ')}</Text>
        </View>
      </View>
      <Text style={styles.cardDesc} numberOfLines={2}>{booking.description}</Text>
      <View style={styles.cardFooter}>
        <Ionicons name={isArtisanView ? 'location-outline' : 'hammer-outline'} size={12} color="#9ca3af" />
        <Text style={styles.cardMeta}>{meta}</Text>
        <Ionicons name="chevron-forward" size={14} color="#d1d5db" style={{ marginLeft: 'auto' }} />
      </View>
    </TouchableOpacity>
  );
}

export default function MyBookingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore() as any;
  const userData = user?.user || user;
  const roles: string[] = userData?.roles || [];
  const isArtisan = roles.includes('artisan');

  const [tab, setTab] = useState<'customer' | 'artisan'>('customer');
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unlockRequired, setUnlockRequired] = useState(false);
  const [unlocked, setUnlocked] = useState(true);
  const [paying, setPaying] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  const fetchData = useCallback(async (which: 'customer' | 'artisan') => {
    try {
      const res = which === 'artisan' ? await listIncomingSokoIndexBookings() : await listMySokoIndexBookings();
      setBookings(res.data ?? []);
      if (which === 'artisan') {
        const meRes = await getSokoIndexMe().catch(() => null);
        setUnlockRequired(!!meRes?.data.artisan_unlock_required);
        setUnlocked(meRes?.data.artisan_unlocked !== false);
      }
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { setLoading(true); fetchData(tab); }, [tab, fetchData]);
  const onRefresh = () => { setRefreshing(true); fetchData(tab); };

  const handleUnlock = async () => {
    setPaying(true);
    try {
      const res = await initializeSokoIndexPayment('artisan_unlock');
      setPaymentRef(res.data.reference);
      setCheckoutUrl(res.data.checkout_url);
    } catch (e: any) {
      setPaying(false);
    }
  };

  const handleUnlockDone = async () => {
    try { await verifySokoIndexPayment(paymentRef); } catch { /* webhook may already have settled it */ }
    setPaying(false);
    fetchData(tab);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Bookings</Text>
        <View style={{ width: 30 }} />
      </View>

      {isArtisan && (
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === 'customer' && styles.tabActive]} onPress={() => setTab('customer')}>
            <Text style={[styles.tabText, tab === 'customer' && styles.tabTextActive]}>As Customer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, tab === 'artisan' && styles.tabActive]} onPress={() => setTab('artisan')}>
            <Text style={[styles.tabText, tab === 'artisan' && styles.tabTextActive]}>Incoming Jobs</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#FF8000" /></View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF8000" />}
          ListHeaderComponent={
            tab === 'artisan' && unlockRequired && !unlocked ? (
              <TouchableOpacity style={styles.unlockBanner} onPress={handleUnlock} disabled={paying}>
                <Ionicons name="lock-closed-outline" size={20} color="#FF8000" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.unlockBannerTitle}>Unlock incoming jobs</Text>
                  <Text style={styles.unlockBannerSub}>Pay a one-time fee to see customer contact info and accept or reject jobs</Text>
                </View>
                {paying ? <ActivityIndicator color="#FF8000" /> : <Ionicons name="chevron-forward" size={20} color="#FF8000" />}
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              isArtisanView={tab === 'artisan'}
              onPress={() => router.push({ pathname: '/sokoindex/booking/[id]', params: { id: item.id, as: tab } } as any)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={56} color="#e5e7eb" />
              <Text style={styles.emptyTitle}>No bookings yet</Text>
            </View>
          }
        />
      )}

      <PaystackModal
        visible={!!checkoutUrl && paying}
        checkoutUrl={checkoutUrl}
        onClose={() => setPaying(false)}
        onDone={handleUnlockDone}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 0 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb' },
  tabActive: { backgroundColor: '#FF8000', borderColor: '#FF8000' },
  tabText: { fontSize: 12, fontWeight: '700', color: '#6b7280' },
  tabTextActive: { color: '#fff' },
  unlockBanner: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#FF8000',
  },
  unlockBannerTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  unlockBannerSub: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: { backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  cardDesc: { fontSize: 13, color: '#4b5563', marginBottom: 8 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMeta: { fontSize: 11, color: '#9ca3af' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 8 },
});
