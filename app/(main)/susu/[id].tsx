import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  approveJoinRequest,
  contributeToGroup,
  getSusuGroup,
  listGroupContributions,
  listGroupPayouts,
  listJoinRequests,
  rejectJoinRequest,
} from '../../../src/api';
import { GroupDetailResponse, SusuContribution, SusuJoinRequest, SusuMember, SusuPayout } from '../../../src/types/susu';

type Tab = 'members' | 'contributions' | 'payouts' | 'requests';

const fmt = (n: any, decimals = 2) => (Number(n) || 0).toFixed(decimals);

function initials(name?: string, fallback?: string) {
  if (name && name.trim()) {
    return name.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  }
  return fallback?.slice(0, 2).toUpperCase() ?? '??';
}

function displayName(m: SusuMember) {
  return m.full_name?.trim() || `Member #${m.position}`;
}

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [contributions, setContributions] = useState<SusuContribution[]>([]);
  const [payouts, setPayouts] = useState<SusuPayout[]>([]);
  const [joinRequests, setJoinRequests] = useState<SusuJoinRequest[]>([]);
  const [tab, setTab] = useState<Tab>('members');
  const [loading, setLoading] = useState(true);
  const [contributing, setContributing] = useState(false);
  const [handlingRequestId, setHandlingRequestId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const [detailResult, contribResult, payoutResult] = await Promise.allSettled([
        getSusuGroup(id),
        listGroupContributions(id),
        listGroupPayouts(id),
      ]);

      if (detailResult.status === 'rejected') {
        const msg = (detailResult.reason as any)?.response?.data?.error ?? 'Failed to load group details.';
        Alert.alert('Error', msg);
        return;
      }

      const raw = detailResult.value.data;
      const parsed: GroupDetailResponse = raw?.group ? raw : raw?.data ?? raw;
      setDetail(parsed);

      if (contribResult.status === 'fulfilled') {
        const cd = contribResult.value.data;
        setContributions(cd?.contributions ?? (Array.isArray(cd) ? cd : []));
      }

      if (payoutResult.status === 'fulfilled') {
        const pd = payoutResult.value.data;
        setPayouts(pd?.payouts ?? (Array.isArray(pd) ? pd : []));
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Failed to load group details.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchJoinRequests = useCallback(async () => {
    if (!id) return;
    try {
      const res = await listJoinRequests(id);
      setJoinRequests(res.data?.requests ?? []);
    } catch {
      // Non-admins receive 403 — silently ignore
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  useEffect(() => {
    if (detail?.is_admin && detail.group.status === 'forming') {
      fetchJoinRequests();
    }
  }, [detail?.is_admin, detail?.group.status, fetchJoinRequests]);

  const handleContribute = async () => {
    if (!detail || !id) return;
    const currentCycle = contributions.length > 0
      ? Math.max(...contributions.map((c) => c.cycle_number))
      : 1;

    Alert.alert(
      'Record Contribution',
      `Contribute GH₵ ${fmt(detail.group.contribution_amount)} for cycle ${currentCycle}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              setContributing(true);
              await contributeToGroup(id, currentCycle);
              fetchDetail();
            } catch (e: any) {
              const msg = e?.response?.data?.error ?? 'Failed to record contribution.';
              Alert.alert('Error', msg);
            } finally {
              setContributing(false);
            }
          },
        },
      ],
    );
  };

  const handleApprove = async (request: SusuJoinRequest) => {
    if (!id) return;
    Alert.alert(
      'Approve Request',
      `Allow this user to join the group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              setHandlingRequestId(request.id);
              const res = await approveJoinRequest(id, request.id);
              const position = res.data?.position;
              Alert.alert('Approved', `Member added at position #${position}.`);
              fetchDetail();
              fetchJoinRequests();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.error ?? 'Failed to approve request.');
            } finally {
              setHandlingRequestId(null);
            }
          },
        },
      ],
    );
  };

  const handleReject = async (request: SusuJoinRequest) => {
    if (!id) return;
    Alert.alert(
      'Reject Request',
      `Reject this user's request to join?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              setHandlingRequestId(request.id);
              await rejectJoinRequest(id, request.id);
              fetchJoinRequests();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.error ?? 'Failed to reject request.');
            } finally {
              setHandlingRequestId(null);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FF8000" />
        </View>
      </SafeAreaView>
    );
  }

  if (!detail) return null;
  const { group, members, member_count, my_position, is_admin, pending_request_count } = detail;

  const currentCycle = contributions.length > 0
    ? Math.max(...contributions.map((c) => c.cycle_number))
    : 1;

  const contributedThisCycle = new Set(
    contributions.filter((c) => c.cycle_number === currentCycle).map((c) => c.user_id),
  );

  const cycleContributors = contributions.reduce<Record<number, number>>((acc, c) => {
    acc[c.cycle_number] = (acc[c.cycle_number] ?? 0) + 1;
    return acc;
  }, {});

  const showRequestsTab = is_admin && group.status === 'forming';

  const tabs: Tab[] = showRequestsTab
    ? ['members', 'contributions', 'payouts', 'requests']
    : ['members', 'contributions', 'payouts'];

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{group.name}</Text>
        {is_admin && (
          <View style={styles.adminHeaderBadge}>
            <Ionicons name="star" size={11} color="#FF8000" />
            <Text style={styles.adminHeaderBadgeText}> Admin</Text>
          </View>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Stats card */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>GH₵ {fmt(group.contribution_amount)}</Text>
            <Text style={styles.statLabel}>Per {group.cycle_period}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{member_count}/{group.max_members}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { textTransform: 'capitalize' }]}>{group.status}</Text>
            <Text style={styles.statLabel}>Status</Text>
          </View>
        </View>

        {/* Admin info panel */}
        {is_admin && (
          <View style={styles.adminPanel}>
            <View style={styles.adminPanelRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color="#FF8000" />
              <Text style={styles.adminPanelTitle}>Admin Overview</Text>
            </View>
            <View style={styles.adminStats}>
              <View style={styles.adminStat}>
                <Text style={styles.adminStatVal}>{member_count}</Text>
                <Text style={styles.adminStatLabel}>Members</Text>
              </View>
              <View style={styles.adminStat}>
                <Text style={styles.adminStatVal}>{contributedThisCycle.size}</Text>
                <Text style={styles.adminStatLabel}>Paid Cycle {currentCycle}</Text>
              </View>
              <View style={styles.adminStat}>
                <Text style={styles.adminStatVal}>{member_count - contributedThisCycle.size}</Text>
                <Text style={styles.adminStatLabel}>Pending</Text>
              </View>
              <View style={styles.adminStat}>
                <Text style={styles.adminStatVal}>
                  GH₵ {fmt(contributedThisCycle.size * Number(group.contribution_amount || 0), 0)}
                </Text>
                <Text style={styles.adminStatLabel}>Collected</Text>
              </View>
            </View>
          </View>
        )}

        {/* Position banner (non-admin) */}
        {!is_admin && (
          <View style={styles.positionBanner}>
            <Ionicons name="trophy-outline" size={18} color="#FF8000" />
            <Text style={styles.positionText}>
              Your payout position: <Text style={{ fontWeight: '700', color: '#FF8000' }}>#{my_position}</Text>
            </Text>
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabs}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <View style={styles.tabInner}>
                <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
                {t === 'requests' && (pending_request_count ?? joinRequests.length) > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {pending_request_count ?? joinRequests.length}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Members tab */}
        {tab === 'members' && (
          <View style={styles.section}>
            {members.map((m) => {
              const paid = contributedThisCycle.has(m.user_id);
              return (
                <View key={m.user_id} style={styles.memberRow}>
                  <View style={[styles.memberAvatar, m.is_admin && styles.memberAvatarAdmin]}>
                    <Text style={[styles.memberAvatarText, m.is_admin && styles.memberAvatarTextAdmin]}>
                      {initials(m.full_name, `#${m.position}`)}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={styles.memberNameRow}>
                      <Text style={styles.memberName}>{displayName(m)}</Text>
                      {m.is_admin && (
                        <View style={styles.adminBadge}>
                          <Text style={styles.adminBadgeText}>Admin</Text>
                        </View>
                      )}
                    </View>

                    {m.phone_number ? (
                      <Text style={styles.memberDetail}>
                        <Ionicons name="call-outline" size={11} color="#9ca3af" /> {m.phone_number}
                      </Text>
                    ) : null}

                    {m.email ? (
                      <Text style={styles.memberDetail}>
                        <Ionicons name="mail-outline" size={11} color="#9ca3af" /> {m.email}
                      </Text>
                    ) : null}

                    <Text style={styles.memberSub}>
                      Position #{m.position} · Joined {new Date(m.joined_at).toLocaleDateString()}
                    </Text>
                  </View>

                  <View style={[styles.paidBadge, paid ? styles.paidBadgeYes : styles.paidBadgeNo]}>
                    <Ionicons
                      name={paid ? 'checkmark-circle' : 'time-outline'}
                      size={13}
                      color={paid ? '#1D9E75' : '#9ca3af'}
                    />
                    <Text style={[styles.paidBadgeText, paid ? styles.paidYesText : styles.paidNoText]}>
                      {paid ? 'Paid' : 'Pending'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Contributions tab */}
        {tab === 'contributions' && (
          <View style={styles.section}>
            {contributions.length === 0 ? (
              <Text style={styles.emptyTab}>No contributions yet.</Text>
            ) : (
              Object.entries(cycleContributors)
                .sort(([a], [b]) => Number(b) - Number(a))
                .map(([cycle, count]) => (
                  <View key={cycle} style={styles.cycleRow}>
                    <View style={styles.cycleIcon}>
                      <Ionicons name="cash-outline" size={18} color="#1D9E75" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cycleName}>Cycle {cycle}</Text>
                      <Text style={styles.cycleSub}>{count} of {member_count} members contributed</Text>
                      <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${(count / member_count) * 100}%` as any }]} />
                      </View>
                    </View>
                    <Text style={styles.cycleAmount}>
                      GH₵ {fmt(Number(count) * Number(group.contribution_amount || 0))}
                    </Text>
                  </View>
                ))
            )}
          </View>
        )}

        {/* Payouts tab */}
        {tab === 'payouts' && (
          <View style={styles.section}>
            {payouts.length === 0 ? (
              <Text style={styles.emptyTab}>No payouts yet.</Text>
            ) : (
              payouts.map((p) => {
                const recipient = members.find((m) => m.user_id === p.user_id);
                return (
                  <View key={p.id} style={styles.payoutRow}>
                    <View style={styles.payoutIcon}>
                      <Ionicons name="arrow-down-outline" size={18} color="#FF8000" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payoutName}>
                        {recipient ? displayName(recipient) : `Cycle ${p.cycle_number}`}
                      </Text>
                      <Text style={styles.payoutSub}>
                        Cycle {p.cycle_number} · {new Date(p.payout_date).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={styles.payoutAmount}>GH₵ {fmt(p.amount)}</Text>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Requests tab (admin only, forming groups) */}
        {tab === 'requests' && (
          <View style={styles.section}>
            {joinRequests.length === 0 ? (
              <View style={styles.emptyRequestsWrap}>
                <Ionicons name="person-add-outline" size={40} color="#e5e7eb" />
                <Text style={styles.emptyTab}>No pending join requests.</Text>
              </View>
            ) : (
              joinRequests.map((req) => (
                <View key={req.id} style={styles.requestRow}>
                  <View style={styles.requestAvatar}>
                    <Ionicons name="person-outline" size={20} color="#FF8000" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.requestUserId}>
                      User {req.user_id.slice(0, 8).toUpperCase()}
                    </Text>
                    <Text style={styles.requestDate}>
                      Requested {new Date(req.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.requestActions}>
                    <TouchableOpacity
                      style={[styles.requestBtn, styles.rejectBtn]}
                      onPress={() => handleReject(req)}
                      disabled={handlingRequestId === req.id}
                    >
                      {handlingRequestId === req.id
                        ? <ActivityIndicator size="small" color="#ef4444" />
                        : <Ionicons name="close" size={16} color="#ef4444" />
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.requestBtn, styles.approveBtn]}
                      onPress={() => handleApprove(req)}
                      disabled={handlingRequestId === req.id}
                    >
                      {handlingRequestId === req.id
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Ionicons name="checkmark" size={16} color="#fff" />
                      }
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {group.status !== 'completed' && tab !== 'requests' && (
        <TouchableOpacity
          style={[styles.contributeBtn, contributing && { opacity: 0.7 }]}
          onPress={handleContribute}
          disabled={contributing}
        >
          {contributing
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.contributeBtnText}>
                Contribute GH₵ {fmt(group.contribution_amount)}
              </Text>
          }
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  adminHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  adminHeaderBadgeText: { fontSize: 11, fontWeight: '700', color: '#FF8000' },
  statsCard: {
    margin: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: '#f3f4f6' },
  adminPanel: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fffbf7',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FF800033',
  },
  adminPanelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  adminPanelTitle: { fontSize: 13, fontWeight: '700', color: '#FF8000' },
  adminStats: { flexDirection: 'row', justifyContent: 'space-between' },
  adminStat: { alignItems: 'center', flex: 1 },
  adminStatVal: { fontSize: 15, fontWeight: '700', color: '#111827' },
  adminStatLabel: { fontSize: 10, color: '#9ca3af', marginTop: 2, textAlign: 'center' },
  positionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    padding: 12,
  },
  positionText: { fontSize: 14, color: '#374151' },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#fff' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabText: { fontSize: 12, color: '#9ca3af', fontWeight: '500' },
  tabTextActive: { color: '#FF8000', fontWeight: '700' },
  tabBadge: {
    backgroundColor: '#FF8000',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabBadgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },
  section: { paddingHorizontal: 16 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarAdmin: { backgroundColor: '#fff7ed' },
  memberAvatarText: { fontSize: 13, fontWeight: '700', color: '#6b7280' },
  memberAvatarTextAdmin: { color: '#FF8000' },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  memberName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  memberDetail: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  memberSub: { fontSize: 11, color: '#9ca3af', marginTop: 3 },
  adminBadge: { backgroundColor: '#ecfdf5', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  adminBadgeText: { fontSize: 10, color: '#1D9E75', fontWeight: '700' },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  paidBadgeYes: { backgroundColor: '#ecfdf5' },
  paidBadgeNo: { backgroundColor: '#f3f4f6' },
  paidBadgeText: { fontSize: 11, fontWeight: '600' },
  paidYesText: { color: '#1D9E75' },
  paidNoText: { color: '#9ca3af' },
  cycleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  cycleIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center' },
  cycleName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  cycleSub: { fontSize: 12, color: '#9ca3af', marginTop: 2, marginBottom: 6 },
  progressBar: { height: 4, backgroundColor: '#f3f4f6', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: '#1D9E75', borderRadius: 2 },
  cycleAmount: { fontSize: 14, fontWeight: '700', color: '#1D9E75' },
  payoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  payoutIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  payoutName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  payoutSub: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  payoutAmount: { fontSize: 14, fontWeight: '700', color: '#FF8000' },
  emptyTab: { textAlign: 'center', color: '#9ca3af', paddingVertical: 32, fontSize: 14 },
  emptyRequestsWrap: { alignItems: 'center', paddingTop: 40, gap: 8 },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  requestAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff7ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestUserId: { fontSize: 14, fontWeight: '600', color: '#111827' },
  requestDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: 8 },
  requestBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5' },
  approveBtn: { backgroundColor: '#FF8000' },
  contributeBtn: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#FF8000',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#FF8000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  contributeBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
