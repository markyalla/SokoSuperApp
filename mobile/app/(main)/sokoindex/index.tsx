import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl, StatusBar, Image } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { browseArtisans, getSokoIndexMe } from '../../../src/api';
import { ArtisanProfile, SokoIndexMeResponse } from '../../../src/types/sokoindex';
import { useAuthStore } from '../../../src/store/authStore';

type SectionHeaderRow = { __sectionHeader: true; title: string; id: string };
type ArtisanListRow = ArtisanProfile | SectionHeaderRow;

function ArtisanCard({ artisan, onPress }: { artisan: ArtisanProfile; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      {artisan.profile_image_path ? (
        <Image source={{ uri: artisan.profile_image_path }} style={styles.cardImage} resizeMode="cover" />
      ) : (
        <View style={[styles.cardImage, styles.cardImageFallback]}>
          <Ionicons name="hammer-outline" size={24} color="#FF8000" />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.cardName}>{artisan.display_name}</Text>
        <Text style={styles.cardTrade}>{artisan.trade_category}</Text>
        <View style={styles.cardMetaRow}>
          <Ionicons name="star" size={13} color="#f59e0b" />
          <Text style={styles.cardMeta}>{Number(artisan.avg_rating || 0).toFixed(1)} ({artisan.rating_count})</Text>
          {artisan.location_text ? (
            <>
              <Ionicons name="location-outline" size={13} color="#9ca3af" style={{ marginLeft: 10 }} />
              <Text style={styles.cardMeta}>{artisan.location_text}</Text>
            </>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
    </TouchableOpacity>
  );
}

export default function SokoIndexScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore() as any;
  const [artisans, setArtisans] = useState<ArtisanProfile[]>([]);
  const [me, setMe] = useState<SokoIndexMeResponse | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Group artisans into "Near You" (same country as the logged-in user) and
  // "Other Regions" — the API already returns same-country artisans first
  // (a stable sort, nothing is hidden), this just makes that grouping visible.
  const sectionedArtisans = useMemo<ArtisanListRow[]>(() => {
    if (!user?.country) return artisans;
    const mine = artisans.filter((a) => a.country === user.country);
    const others = artisans.filter((a) => a.country !== user.country);
    if (mine.length === 0 || others.length === 0) return artisans;
    return [
      { __sectionHeader: true, title: 'Near You', id: '__section_mine' },
      ...mine,
      { __sectionHeader: true, title: 'Other Regions', id: '__section_others' },
      ...others,
    ];
  }, [artisans, user?.country]);
  const didSplitByCountry = sectionedArtisans.length > artisans.length;

  const fetchData = useCallback(async (query?: string) => {
    try {
      const [artisansRes, meRes] = await Promise.all([
        browseArtisans(query ? { q: query } : undefined),
        getSokoIndexMe().catch(() => ({ data: null })),
      ]);
      setArtisans(artisansRes.data.artisans ?? []);
      setMe(meRes.data);
    } catch {
      // keep previous data on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = () => { setRefreshing(true); fetchData(q); };
  const onSearch = () => { setLoading(true); fetchData(q); };

  const renderBanner = () => {
    if (me?.is_artisan) {
      return (
        <>
          <TouchableOpacity style={styles.banner} onPress={() => router.push('/sokoindex/my-portfolio' as any)} activeOpacity={0.9}>
            <View style={styles.bannerIcon}><Ionicons name="briefcase-outline" size={22} color="#FF8000" /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.bannerTitle}>My Artisan Portfolio</Text>
              <Text style={styles.bannerSub}>Manage your profile & work samples</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FF8000" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.banner} onPress={() => router.push('/sokoindex/my-ratings' as any)} activeOpacity={0.9}>
            <View style={styles.bannerIcon}><Ionicons name="star-outline" size={22} color="#FF8000" /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.bannerTitle}>My Ratings</Text>
              <Text style={styles.bannerSub}>See who rated you and their feedback</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FF8000" />
          </TouchableOpacity>
        </>
      );
    }
    if (me?.has_applied) {
      return (
        <View style={styles.pendingBanner}>
          <Ionicons name="time-outline" size={18} color="#d97706" />
          <Text style={styles.pendingBannerText}>
            Your artisan application is <Text style={{ fontWeight: '700' }}>{me.status}</Text>
            {me.status === 'rejected' && me.rejection_reason ? ` — ${me.rejection_reason}` : ''}
          </Text>
        </View>
      );
    }
    return (
      <TouchableOpacity style={styles.banner} onPress={() => router.push('/sokoindex/apply' as any)} activeOpacity={0.9}>
        <View style={styles.bannerIcon}><Ionicons name="hammer-outline" size={22} color="#FF8000" /></View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.bannerTitle}>Are you an artisan?</Text>
          <Text style={styles.bannerSub}>Create a work samples and get booked</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#FF8000" />
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>MySokoIndex</Text>
        <TouchableOpacity onPress={() => router.push('/sokoindex/my-bookings' as any)} style={styles.backBtn}>
          <Ionicons name="receipt-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color="#9ca3af" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by trade or name (e.g. plumber, carpenter)"
          placeholderTextColor="#9ca3af"
          value={q}
          onChangeText={setQ}
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#FF8000" /></View>
      ) : (
        <FlatList
          data={sectionedArtisans}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF8000" />}
          ListHeaderComponent={
            <>
              {renderBanner()}
              {!didSplitByCountry && <Text style={styles.sectionTitle}>Artisans near you</Text>}
            </>
          }
          renderItem={({ item }) =>
            '__sectionHeader' in item ? (
              <Text style={styles.sectionTitle}>{item.title}</Text>
            ) : (
              <ArtisanCard artisan={item} onPress={() => router.push(`/sokoindex/${item.id}` as any)} />
            )
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={56} color="#e5e7eb" />
              <Text style={styles.emptyTitle}>No artisans found</Text>
              <Text style={styles.emptyText}>Try a different search term.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 14, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, borderWidth: 1, borderColor: '#e5e7eb',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginTop: 4 },
  banner: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 18,
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#FF8000',
  },
  bannerIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  bannerSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fffbeb',
    borderRadius: 12, padding: 14, marginBottom: 18,
  },
  pendingBannerText: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  cardImage: { width: 52, height: 52, borderRadius: 26 },
  cardImageFallback: { backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  cardTrade: { fontSize: 12, color: '#FF8000', fontWeight: '600', marginTop: 2 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  cardMeta: { fontSize: 11, color: '#9ca3af', marginLeft: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginTop: 8 },
  emptyText: { fontSize: 13, color: '#6b7280' },
});
