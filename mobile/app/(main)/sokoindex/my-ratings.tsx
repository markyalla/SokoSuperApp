import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, Image, ActivityIndicator, RefreshControl, StatusBar } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listMySokoIndexRatings } from '../../../src/api';

function Stars({ score }: { score: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= score ? 'star' : 'star-outline'} size={14} color="#FF8000" />
      ))}
    </View>
  );
}

function RatingCard({ rating }: { rating: any }) {
  const customer = rating.customer;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.identityRow}>
          {customer?.profile_image_url ? (
            <Image source={{ uri: customer.profile_image_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Ionicons name="person-outline" size={14} color="#FF8000" />
            </View>
          )}
          <View>
            <Text style={styles.cardName}>{customer?.full_name ?? 'Customer'}</Text>
            {customer?.email ? <Text style={styles.cardMeta}>{customer.email}</Text> : null}
          </View>
        </View>
        <Stars score={rating.score} />
      </View>
      {rating.comment ? <Text style={styles.cardComment}>{rating.comment}</Text> : null}
      <Text style={styles.cardDate}>
        {rating.created_at ? new Date(rating.created_at).toLocaleDateString() : ''}
      </Text>
    </View>
  );
}

export default function MyRatingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [ratings, setRatings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await listMySokoIndexRatings();
      setRatings(res.data ?? []);
    } catch {
      setRatings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = () => { setRefreshing(true); fetchData(); };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Ratings</Text>
        <View style={{ width: 30 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#FF8000" /></View>
      ) : (
        <FlatList
          data={ratings}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF8000" />}
          renderItem={({ item }) => <RatingCard rating={item} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="star-outline" size={56} color="#e5e7eb" />
              <Text style={styles.emptyTitle}>No ratings yet</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  avatarFallback: { backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  cardMeta: { fontSize: 11, color: '#9ca3af' },
  cardComment: { fontSize: 13, color: '#4b5563', marginBottom: 6 },
  cardDate: { fontSize: 11, color: '#9ca3af' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 8 },
});
