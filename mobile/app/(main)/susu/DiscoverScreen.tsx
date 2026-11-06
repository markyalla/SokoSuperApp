import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { discoverGroups, joinSusuGroup } from '../../../src/api';
import { DiscoverGroup } from '../../../src/types/susu';

const fmt = (n: any) => (Number(n) || 0).toFixed(2);

type RequestStatus = DiscoverGroup['my_request_status'];

function RequestButton({
  status,
  loading,
  onPress,
}: {
  status: RequestStatus;
  loading: boolean;
  onPress: () => void;
}) {
  if (status === 'member') {
    return (
      <View style={[styles.actionBtn, styles.memberBtn]}>
        <Ionicons name="checkmark-circle" size={15} color="#1D9E75" />
        <Text style={[styles.actionBtnText, styles.memberBtnText]}>Already a Member</Text>
      </View>
    );
  }

  if (status === 'pending') {
    return (
      <View style={[styles.actionBtn, styles.pendingBtn]}>
        <Ionicons name="time-outline" size={15} color="#FF8000" />
        <Text style={[styles.actionBtnText, styles.pendingBtnText]}>Pending Approval</Text>
      </View>
    );
  }

  if (status === 'approved') {
    return (
      <View style={[styles.actionBtn, styles.memberBtn]}>
        <Ionicons name="checkmark-circle" size={15} color="#1D9E75" />
        <Text style={[styles.actionBtnText, styles.memberBtnText]}>Approved</Text>
      </View>
    );
  }

  if (status === 'rejected') {
    return (
      <TouchableOpacity style={[styles.actionBtn, styles.requestBtn]} onPress={onPress} disabled={loading}>
        {loading
          ? <ActivityIndicator color="#fff" size="small" />
          : <>
              <Ionicons name="refresh-outline" size={15} color="#fff" />
              <Text style={[styles.actionBtnText, styles.requestBtnText]}>Re-request to Join</Text>
            </>
        }
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[styles.actionBtn, styles.requestBtn]} onPress={onPress} disabled={loading}>
      {loading
        ? <ActivityIndicator color="#fff" size="small" />
        : <>
            <Ionicons name="person-add-outline" size={15} color="#fff" />
            <Text style={[styles.actionBtnText, styles.requestBtnText]}>Request to Join</Text>
          </>
      }
    </TouchableOpacity>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      setError(null);
      const res = await discoverGroups();
      const raw = res.data;
      const list: DiscoverGroup[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.groups)
          ? raw.groups
          : Array.isArray(raw?.data)
            ? raw.data
            : [];
      setGroups(list);
    } catch (e: any) {
      console.error('Discover groups error:', e?.response?.data ?? e?.message);
      setError('Could not load groups. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleRequest = (group: DiscoverGroup) => {
    const isRerequest = group.my_request_status === 'rejected';
    Alert.alert(
      isRerequest ? 'Re-request to Join' : 'Request to Join',
      `Send a join request for "${group.name}"?\nContribution: GH₵ ${fmt(group.contribution_amount)} / ${group.cycle_period}\n\nThe group admin will review and approve your request.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Request',
          onPress: async () => {
            try {
              setRequestingId(group.id);
              await joinSusuGroup(group.id);
              Alert.alert(
                'Request Sent',
                `Your request to join "${group.name}" has been sent. The admin will review it shortly.`,
              );
              fetchGroups();
            } catch (e: any) {
              const msg = e?.response?.data?.error ?? 'Failed to send join request.';
              Alert.alert('Error', msg);
            } finally {
              setRequestingId(null);
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: DiscoverGroup }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Ionicons name="people-outline" size={22} color="#FF8000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{item.name}</Text>
          <Text style={styles.cardSub}>
            GH₵ {fmt(item.contribution_amount)} / {item.cycle_period}
          </Text>
        </View>
        <View style={styles.openBadge}>
          <Text style={styles.openBadgeText}>Open</Text>
        </View>
      </View>

      <View style={styles.cardMeta}>
        <Ionicons name="people-outline" size={13} color="#9ca3af" />
        <Text style={styles.cardMetaText}>Max {item.max_members} members</Text>
        <Ionicons name="time-outline" size={13} color="#9ca3af" style={{ marginLeft: 8 }} />
        <Text style={styles.cardMetaText}>{item.cycle_period}</Text>
      </View>

      <RequestButton
        status={item.my_request_status}
        loading={requestingId === item.id}
        onPress={() => handleRequest(item)}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Discover Groups</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF8000" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color="#d1d5db" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setLoading(true); fetchGroups(); }}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          contentContainerStyle={groups.length === 0 ? styles.emptyContainer : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchGroups(); }}
              tintColor="#FF8000"
            />
          }
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={56} color="#e5e7eb" />
              <Text style={styles.emptyTitle}>No open groups</Text>
              <Text style={styles.emptyText}>
                All groups are currently full or active. Create your own!
              </Text>
              <TouchableOpacity
                style={styles.createBtn}
                onPress={() => { router.back(); router.push('/susu/CreateGroupScreen' as any); }}
              >
                <Text style={styles.createBtnText}>Create a Group</Text>
              </TouchableOpacity>
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
    backgroundColor: '#FF8000',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  list: { padding: 16 },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 8 },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center', paddingHorizontal: 40 },
  errorText: { fontSize: 14, color: '#6b7280', textAlign: 'center', paddingHorizontal: 32 },
  retryBtn: {
    backgroundColor: '#FF8000',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  openBadge: { backgroundColor: '#ecfdf5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  openBadgeText: { fontSize: 11, color: '#1D9E75', fontWeight: '600' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 },
  cardMetaText: { fontSize: 12, color: '#9ca3af' },
  actionBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  requestBtn: {
    backgroundColor: '#FF8000',
  },
  requestBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  pendingBtn: { backgroundColor: '#fff7ed' },
  pendingBtnText: { color: '#FF8000', fontWeight: '600', fontSize: 14 },
  memberBtn: { backgroundColor: '#ecfdf5' },
  memberBtnText: { color: '#1D9E75', fontWeight: '600', fontSize: 14 },
  actionBtnText: { fontSize: 14, fontWeight: '700' },
  createBtn: {
    marginTop: 16,
    backgroundColor: '#FF8000',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  createBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
