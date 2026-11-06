import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { joinSusuGroup, listMyGroups } from '../../../src/api';
import { SusuGroup } from '../../../src/types/susu';

const fmt = (n: any) => (Number(n) || 0).toFixed(2);

const STATUS_COLOR: Record<string, string> = {
  forming: '#FF8000',
  active: '#1D9E75',
  completed: '#6b7280',
};

type ListItem =
  | { type: 'header'; label: string }
  | { type: 'group'; data: SusuGroup }
  | { type: 'create' };

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </View>
  );
}

function AdminGroupCard({ group, onPress }: { group: SusuGroup; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.card, styles.adminCard]} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, styles.adminCardIcon]}>
          <Ionicons name="shield-checkmark-outline" size={22} color="#FF8000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{group.name}</Text>
          <Text style={styles.cardSub}>
            GH₵ {fmt(group.contribution_amount)} / {group.cycle_period}
          </Text>
        </View>
        <View style={styles.adminBadge}>
          <Ionicons name="star" size={11} color="#FF8000" />
          <Text style={styles.adminBadgeText}> Admin</Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[group.status] ?? '#9ca3af' }]} />
        <Text style={[styles.cardMeta, { color: STATUS_COLOR[group.status] ?? '#9ca3af', textTransform: 'capitalize' }]}>
          {group.status}
        </Text>
        <Ionicons name="people-outline" size={13} color="#9ca3af" style={{ marginLeft: 10 }} />
        <Text style={styles.cardMeta}>Max {group.max_members} members</Text>
        <Ionicons name="chevron-forward" size={14} color="#FF8000" style={{ marginLeft: 'auto' }} />
      </View>
    </TouchableOpacity>
  );
}

function MemberGroupCard({ group, onPress }: { group: SusuGroup; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Ionicons name="people-outline" size={22} color="#FF8000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{group.name}</Text>
          <Text style={styles.cardSub}>
            GH₵ {fmt(group.contribution_amount)} / {group.cycle_period}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[group.status] ?? '#9ca3af') + '22' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLOR[group.status] ?? '#9ca3af' }]}>
            {group.status}
          </Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <Ionicons name="people-outline" size={13} color="#9ca3af" />
        <Text style={styles.cardMeta}>Max {group.max_members} members</Text>
        <Ionicons name="chevron-forward" size={14} color="#d1d5db" style={{ marginLeft: 'auto' }} />
      </View>
    </TouchableOpacity>
  );
}

function OtherGroupCard({
  group,
  onRequest,
  requesting,
}: {
  group: SusuGroup;
  onRequest: () => void;
  requesting: boolean;
}) {
  const isPending = group.my_role === 'pending';
  const canJoin = group.status === 'forming';

  return (
    <View style={[styles.card, styles.otherCard]}>
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, styles.otherCardIcon]}>
          <Ionicons name="lock-closed-outline" size={20} color="#9ca3af" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{group.name}</Text>
          <Text style={styles.cardSub}>
            GH₵ {fmt(group.contribution_amount)} / {group.cycle_period}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLOR[group.status] ?? '#9ca3af') + '22' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLOR[group.status] ?? '#9ca3af' }]}>
            {group.status}
          </Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <Ionicons name="people-outline" size={13} color="#9ca3af" />
        <Text style={styles.cardMeta}>Max {group.max_members} members</Text>
        {canJoin && (
          <TouchableOpacity
            style={[styles.requestChip, isPending && styles.requestChipPending]}
            onPress={onRequest}
            disabled={isPending || requesting}
          >
            {requesting
              ? <ActivityIndicator size="small" color="#FF8000" />
              : isPending
                ? <>
                    <Ionicons name="time-outline" size={12} color="#FF8000" />
                    <Text style={styles.requestChipText}>Pending</Text>
                  </>
                : <>
                    <Ionicons name="person-add-outline" size={12} color="#FF8000" />
                    <Text style={styles.requestChipText}>Request</Text>
                  </>
            }
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function CreateGroupCard({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.createCard} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.createCardIcon}>
        <Ionicons name="add-circle-outline" size={26} color="#FF8000" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.createCardTitle}>Create a new group</Text>
        <Text style={styles.createCardSub}>Start a susu group and invite members</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#FF8000" />
    </TouchableOpacity>
  );
}

export default function SusuGroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<SusuGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      setError(null);
      const res = await listMyGroups();
      setGroups(res.data.groups ?? []);
    } catch {
      setError('Could not load groups. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const onRefresh = () => { setRefreshing(true); fetchGroups(); };

  const handleRequest = (group: SusuGroup) => {
    Alert.alert(
      'Request to Join',
      `Send a join request for "${group.name}"?\nContribution: GH₵ ${fmt(group.contribution_amount)} / ${group.cycle_period}\n\nThe admin will review your request.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Request',
          onPress: async () => {
            try {
              setRequestingId(group.id);
              await joinSusuGroup(group.id);
              Alert.alert('Request Sent', `Your request to join "${group.name}" has been sent. The admin will review it.`);
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

  const adminGroups = groups.filter((g) => g.my_role === 'admin');
  const memberGroups = groups.filter((g) => g.my_role === 'member');
  const otherGroups = groups.filter((g) => g.my_role === 'none' || g.my_role === 'pending');

  const listData: ListItem[] = [];
  if (adminGroups.length > 0) {
    listData.push({ type: 'header', label: 'Groups I Admin' });
    adminGroups.forEach((g) => listData.push({ type: 'group', data: g }));
  }
  listData.push({ type: 'create' });
  if (memberGroups.length > 0) {
    listData.push({ type: 'header', label: "Groups I'm In" });
    memberGroups.forEach((g) => listData.push({ type: 'group', data: g }));
  }
  if (otherGroups.length > 0) {
    listData.push({ type: 'header', label: 'Other Groups' });
    otherGroups.forEach((g) => listData.push({ type: 'group', data: g }));
  }

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') {
      return <SectionHeader label={item.label} />;
    }
    if (item.type === 'create') {
      return <CreateGroupCard onPress={() => router.push('/susu/CreateGroupScreen' as any)} />;
    }
    const group = item.data;
    if (group.my_role === 'admin') {
      return <AdminGroupCard group={group} onPress={() => router.push(`/susu/${group.id}` as any)} />;
    }
    if (group.my_role === 'member') {
      return <MemberGroupCard group={group} onPress={() => router.push(`/susu/${group.id}` as any)} />;
    }
    return (
      <OtherGroupCard
        group={group}
        requesting={requestingId === group.id}
        onRequest={() => handleRequest(group)}
      />
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SokoSusu</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF8000" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={48} color="#d1d5db" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : groups.length === 0 ? (
        <FlatList
          data={[{ type: 'create' } as ListItem]}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF8000" />}
          renderItem={renderItem}
          ListFooterComponent={
            <View style={styles.empty}>
              <Ionicons name="people-circle-outline" size={64} color="#e5e7eb" />
              <Text style={styles.emptyTitle}>No groups yet</Text>
              <Text style={styles.emptyText}>Create a new group or wait for others to create one.</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => {
            if (item.type === 'header') return `header-${item.label}`;
            if (item.type === 'create') return 'create';
            return `group-${item.data.id}`;
          }}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF8000" />}
          renderItem={renderItem}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { color: '#6b7280', fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },
  list: { padding: 16 },
  emptyContainer: { padding: 16 },
  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 8 },
  emptyText: { fontSize: 14, color: '#6b7280', textAlign: 'center', paddingHorizontal: 40 },
  sectionHeader: { marginBottom: 8, marginTop: 4 },
  sectionHeaderText: { fontSize: 12, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    marginBottom: 12,
  },
  adminCard: {
    borderWidth: 1.5,
    borderColor: '#FF800033',
    backgroundColor: '#fffbf7',
  },
  otherCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fafafa',
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
  adminCardIcon: { backgroundColor: '#FF800015' },
  otherCardIcon: { backgroundColor: '#f3f4f6' },
  cardName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  cardSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  adminBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF800018',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  adminBadgeText: { fontSize: 11, fontWeight: '700', color: '#FF8000' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMeta: { fontSize: 12, color: '#9ca3af' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  requestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#FF800044',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  requestChipPending: { backgroundColor: '#fff7ed', borderColor: '#FF800022' },
  requestChipText: { fontSize: 11, fontWeight: '700', color: '#FF8000' },
  createCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1.5,
    borderColor: '#FF800044',
    borderStyle: 'dashed',
    marginBottom: 12,
  },
  createCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCardTitle: { fontSize: 15, fontWeight: '700', color: '#FF8000' },
  createCardSub: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
});
