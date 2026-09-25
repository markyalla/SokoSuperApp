import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Image, ActivityIndicator, RefreshControl, StatusBar, Alert } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getMyArtisanProfile, listMyPortfolio, initializeSokoIndexPayment, verifySokoIndexPayment, getSokoIndexFeatureFlags } from '../../../src/api';
import { ArtisanProfile, Portfolio } from '../../../src/types/sokoindex';
import PaystackModal from '../../../src/components/PaystackModal';

const STATUS_COLOR: Record<string, string> = { pending: '#d97706', approved: '#16a34a', rejected: '#dc2626' };

export default function MyPortfolioScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<ArtisanProfile | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio[]>([]);
  const [joiningFeeEnabled, setJoiningFeeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [paymentRef, setPaymentRef] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, portfolioRes, flagsRes] = await Promise.all([
        getMyArtisanProfile(), listMyPortfolio(), getSokoIndexFeatureFlags().catch(() => ({ data: { joining_fee_enabled: false } })),
      ]);
      setProfile(profileRes.data);
      setPortfolio(portfolioRes.data ?? []);
      setJoiningFeeEnabled(!!flagsRes.data.joining_fee_enabled);
    } catch {
      Alert.alert('Error', 'Could not load your artisan profile.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const handlePayJoiningFee = async () => {
    if (!profile) return;
    setPaying(true);
    try {
      const res = await initializeSokoIndexPayment('joining_fee', profile.id);
      setPaymentRef(res.data.reference);
      setCheckoutUrl(res.data.checkout_url);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.error || 'Could not start payment');
      setPaying(false);
    }
  };

  const handlePaymentDone = async () => {
    try {
      await verifySokoIndexPayment(paymentRef);
    } catch {
      // webhook may have already settled it; refresh regardless
    } finally {
      setPaying(false);
      fetchData();
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#FF8000" /></View>;
  }

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No artisan profile found.</Text>
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
        <Text style={styles.headerTitle}>My Work Samples</Text>
        <View style={{ width: 30 }} />
      </View>

      <FlatList
        data={portfolio}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF8000" />}
        ListHeaderComponent={
          <>
            <View style={styles.profileCard}>
              {profile.profile_image_path ? (
                <Image source={{ uri: profile.profile_image_path }} style={styles.avatar} resizeMode="cover" />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="hammer-outline" size={26} color="#FF8000" />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.name}>{profile.display_name}</Text>
                <Text style={styles.trade}>{profile.trade_category}</Text>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: profile.is_suspended ? '#dc2626' : profile.is_published ? '#16a34a' : '#d97706' }]} />
                  <Text style={styles.statusText}>
                    {profile.is_suspended ? 'Suspended' : profile.is_published ? 'Published' : 'Pending publish'}
                  </Text>
                </View>
              </View>
            </View>

            {profile.is_suspended && profile.suspension_reason ? (
              <View style={styles.suspendedBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
                <Text style={styles.suspendedText}>{profile.suspension_reason}</Text>
              </View>
            ) : null}

            {joiningFeeEnabled && !profile.joining_fee_paid && (
              <TouchableOpacity style={styles.feeBanner} onPress={handlePayJoiningFee} disabled={paying}>
                <Ionicons name="card-outline" size={20} color="#FF8000" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.feeBannerTitle}>Pay joining fee</Text>
                  <Text style={styles.feeBannerSub}>Unlock full visibility on MySokoIndex</Text>
                </View>
                {paying ? <ActivityIndicator color="#FF8000" /> : <Ionicons name="chevron-forward" size={18} color="#FF8000" />}
              </TouchableOpacity>
            )}

            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>My Work Samples</Text>
              <TouchableOpacity onPress={() => router.push('/sokoindex/create-portfolio' as any)}>
                <Text style={styles.addNewText}>+ Add New</Text>
              </TouchableOpacity>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.portfolioCard}
            onPress={() => router.push({ pathname: '/sokoindex/create-portfolio', params: { id: item.id } } as any)}
          >
            {item.image_path_1 ? (
              <Image source={{ uri: item.image_path_1 }} style={styles.portfolioImage} resizeMode="cover" />
            ) : (
              <View style={[styles.portfolioImage, styles.portfolioImageFallback]}>
                <Ionicons name="image-outline" size={20} color="#9ca3af" />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.portfolioTitle}>{item.title}</Text>
              <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[item.status] ?? '#9ca3af') + '22' }]}>
                <Text style={[styles.statusBadgeText, { color: STATUS_COLOR[item.status] ?? '#9ca3af' }]}>{item.status}</Text>
              </View>
              {item.status === 'rejected' && item.rejection_reason ? (
                <Text style={styles.rejectionText}>{item.rejection_reason}</Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="images-outline" size={56} color="#e5e7eb" />
            <Text style={styles.emptyTitle}>No work sample items yet</Text>
            <Text style={styles.emptyText}>Tap "Add New" to showcase your work.</Text>
          </View>
        }
      />

      <PaystackModal
        visible={!!checkoutUrl && paying}
        checkoutUrl={checkoutUrl}
        onClose={() => setPaying(false)}
        onDone={handlePaymentDone}
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
  profileCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: '#111827' },
  trade: { fontSize: 12, color: '#FF8000', fontWeight: '600', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, color: '#6b7280' },
  suspendedBox: { flexDirection: 'row', gap: 8, backgroundColor: '#fef2f2', borderRadius: 12, padding: 12, marginBottom: 14 },
  suspendedText: { flex: 1, fontSize: 12, color: '#991b1b', lineHeight: 17 },
  feeBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14,
    padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#FF8000',
  },
  feeBannerTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  feeBannerSub: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6 },
  addNewText: { fontSize: 13, fontWeight: '700', color: '#FF8000' },
  portfolioCard: { backgroundColor: '#fff', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  portfolioImage: { width: 56, height: 56, borderRadius: 10 },
  portfolioImageFallback: { backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  portfolioTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  statusBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  rejectionText: { fontSize: 11, color: '#dc2626', marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 8 },
  emptyText: { fontSize: 13, color: '#6b7280' },
});
