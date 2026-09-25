import React, { useEffect, useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, StatusBar } from 'react-native';
import { Text } from '../../../src/components/Text';
import { getOrders, cancelOrder, requestRefund, deleteOrder, getCustomerOrderOTP } from '../../../src/api';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { wsService } from '../../../src/services/websocket';

interface Order {
  order_id: string;
  status: string;
  total_amount: number;
  delivery_address: string;
  created_at: string;
  restaurant?: { name: string };
  store?: { name: string };
  items: { name: string; quantity: number; unit_price?: number; special_note?: string; options?: string }[];
  delivery?: { id: string };
}

type Tab = 'active' | 'completed' | 'history';

const ACTIVE_STATUSES = [
  'pending', 'payment_pending', 'payment_confirmed',
  'preparing', 'ready_for_pickup', 'assigned_to_driver',
  'picked_up', 'in_transit',
];
const COMPLETED_STATUSES = ['delivered'];
const HISTORY_STATUSES = ['cancelled', 'refunded', 'failed'];

function OTPInline({ orderId, status }: { orderId: string; status: string }) {
  const [otp, setOtp] = useState<string | null>(null);
  const active = ['in_transit', 'out_for_delivery', 'picked_up', 'assigned_to_driver'].includes(
    status.toLowerCase().replace(/ /g, '_'),
  );

  useEffect(() => {
    if (active) {
      const fetch = async () => {
        try {
          const res = await getCustomerOrderOTP(orderId);
          if (res.data.otp) setOtp(res.data.otp);
        } catch {}
      };
      fetch();
      const timer = setInterval(fetch, 10000);
      return () => clearInterval(timer);
    }
  }, [active, orderId]);

  if (!active || !otp) return null;
  return (
    <View style={{ backgroundColor: '#ffff', padding: 10, borderRadius: 8, marginTop: 8, borderWidth: 1, borderColor: '#e74c3c' }}>
      <Text style={{ fontSize: 12, color: '#FF8000', fontWeight: 'bold', textAlign: 'center' }}>
        🔐 Delivery Code: <Text style={{ fontSize: 16 }}>{otp}</Text>
      </Text>
    </View>
  );
}

const getDisplayId = (id: number | string) => `FD-${String(id).padStart(6, '0')}`;

const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'pending':            return '#95a5a6';
    case 'payment_pending':    return '#e67e22';
    case 'payment_confirmed':  return '#f39c12';
    case 'preparing':          return '#e67e22';
    case 'ready_for_pickup':   return '#3498db';
    case 'assigned_to_driver': return '#2980b9';
    case 'picked_up':          return '#d35400';
    case 'in_transit':         return '#9b59b6';
    case 'delivered':          return '#2ecc71';
    case 'cancelled':          return '#e74c3c';
    case 'refunded':           return '#1D9E75';
    default:                   return '#95a5a6';
  }
};

const getStatusEmoji = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'pending':            return '⏳';
    case 'payment_pending':    return '💳';
    case 'payment_confirmed':  return '💰';
    case 'preparing':          return '👨‍🍳';
    case 'ready_for_pickup':   return '🛍️';
    case 'assigned_to_driver': return '🛵';
    case 'picked_up':          return '🥡';
    case 'in_transit':         return '🚗';
    case 'delivered':          return '✅';
    case 'cancelled':          return '❌';
    case 'refunded':           return '↩️';
    default:                   return '📦';
  }
};

export default function MyOrdersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('active');

  useFocusEffect(
    useCallback(() => { loadOrders(); }, []),
  );

  // Instant refresh when the backend pushes an order_status event
  useEffect(() => {
    return wsService.addHandler((event) => {
      if (event.type === 'order_status') loadOrders();
    });
  }, []);

  const loadOrders = async () => {
    try {
      const response = await getOrders();
      setOrders(response.data);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  };

  const handleCancelOrder = (orderId: string | number) => {
    Alert.alert('Cancel Order', 'Are you sure you want to cancel this order?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        onPress: async () => {
          try {
            await cancelOrder(String(orderId));
            Alert.alert('Success', 'Order cancelled successfully.');
            loadOrders();
          } catch (e: any) { Alert.alert('Error', e.message); }
        },
      },
    ]);
  };

  const handleRequestRefund = (orderId: string | number, amount: number) => {
    Alert.alert(
      'Request Refund',
      `Your payment of GHS ${amount.toFixed(2)} will be returned to your mobile money account within 1–3 business days.\n\nCancel this order and request a refund?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Refund Me',
          style: 'destructive',
          onPress: async () => {
            try {
              await requestRefund(String(orderId));
              Alert.alert('Refund Initiated', 'Your refund has been submitted. The money will arrive on your mobile money within 1–3 business days.');
              loadOrders();
            } catch (e: any) {
              Alert.alert('Refund Failed', e?.response?.data?.error || e.message || 'Something went wrong. Please try again.');
            }
          },
        },
      ],
    );
  };

  const handleDeleteOrder = (orderId: string) => {
    Alert.alert(
      'Remove Order',
      'Remove this order from your history? This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteOrder(orderId);
              setOrders(prev => prev.filter(o => o.order_id !== orderId));
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.error || e.message || 'Could not remove order.');
            }
          },
        },
      ],
    );
  };

  const canTrackOrder = (order: Order) => {
    const trackableStatuses = [
      'preparing', 'ready_for_pickup', 'assigned_to_driver',
      'picked_up', 'in_transit', 'delivered',
    ];
    const currentStatus = (order.status || '').toLowerCase().replace(/ /g, '_');
    return Boolean(order.delivery?.id) && trackableStatuses.includes(currentStatus);
  };

  const filteredOrders = orders.filter(o => {
    const s = (o.status || '').toLowerCase().replace(/ /g, '_');
    if (activeTab === 'active')    return ACTIVE_STATUSES.includes(s);
    if (activeTab === 'completed') return COMPLETED_STATUSES.includes(s);
    return HISTORY_STATUSES.includes(s);
  });

  const countFor = (tab: Tab) => orders.filter(o => {
    const s = (o.status || '').toLowerCase().replace(/ /g, '_');
    if (tab === 'active')    return ACTIVE_STATUSES.includes(s);
    if (tab === 'completed') return COMPLETED_STATUSES.includes(s);
    return HISTORY_STATUSES.includes(s);
  }).length;

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'active',    label: 'Active',    icon: '🚗' },
    { key: 'completed', label: 'Completed', icon: '✅' },
    { key: 'history',   label: 'History',   icon: '🗂️' },
  ];

  const emptyMessages: Record<Tab, { emoji: string; title: string; sub: string }> = {
    active:    { emoji: '📦', title: 'No active orders',    sub: 'Place an order and it will show here' },
    completed: { emoji: '✅', title: 'No completed orders', sub: 'Delivered orders will appear here' },
    history:   { emoji: '🗂️', title: 'No history yet',     sub: 'Cancelled or refunded orders appear here' },
  };

  const renderOrder = ({ item }: { item: Order }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.orderId}>Order {getDisplayId(item.order_id)}</Text>
        <View style={[styles.badge, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.badgeText}>
            {getStatusEmoji(item.status)} {item.status?.replace(/_/g, ' ')}
          </Text>
        </View>
      </View>

      <Text style={styles.restaurant}>
        🏠 {item.store?.name || item.restaurant?.name || 'N/A'}
      </Text>
      <Text style={styles.address}>📍 {item.delivery_address}</Text>

      <OTPInline orderId={item.order_id} status={item.status} />

      <View style={styles.itemsList}>
        {item.items?.slice(0, 3).map((i, idx) => (
          <View key={idx} style={{ marginBottom: 4 }}>
            <Text style={styles.itemText}>• {i.name} × {i.quantity}</Text>
            {i.special_note ? (
              <Text style={styles.itemNote}>📝 {i.special_note}</Text>
            ) : null}
          </View>
        ))}
        {item.items?.length > 3 && (
          <Text style={styles.itemText}>+{item.items.length - 3} more items</Text>
        )}
      </View>

      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.totalAmount}>GHS {item.total_amount?.toFixed(2)}</Text>
          <Text style={styles.orderDate}>
            {item.created_at ? new Date(item.created_at).toLocaleDateString('en-GH', {
              day: 'numeric', month: 'short', year: 'numeric',
            }) : 'N/A'}
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          {item.status?.toLowerCase() === 'pending' && (
            <TouchableOpacity
              style={[styles.detailsBtn, { backgroundColor: '#95a5a6' }]}
              onPress={() => handleCancelOrder(item.order_id)}
            >
              <Text style={styles.detailsBtnText}>✕ Cancel</Text>
            </TouchableOpacity>
          )}
          {item.status?.toLowerCase() === 'payment_confirmed' && (
            <TouchableOpacity
              style={[styles.detailsBtn, { backgroundColor: '#e74c3c' }]}
              onPress={() => handleRequestRefund(item.order_id, item.total_amount)}
            >
              <Text style={styles.detailsBtnText}>↩ Refund</Text>
            </TouchableOpacity>
          )}
          {HISTORY_STATUSES.includes(item.status?.toLowerCase()) && (
            <TouchableOpacity
              style={[styles.detailsBtn, { backgroundColor: '#c0392b' }]}
              onPress={() => handleDeleteOrder(item.order_id)}
            >
              <Text style={styles.detailsBtnText}>🗑 Delete</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.detailsBtn}
            onPress={() => router.push({
              pathname: '/shopper/TrackOrderScreen',
              params: {
                orderId: String(item.order_id),
                deliveryId: String(item.delivery?.id || 0),
                showMap: 'false',
              },
            } as any)}
          >
            <Text style={styles.detailsBtnText}>📋 Details</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.trackBtn, !canTrackOrder(item) && styles.trackBtnDisabled]}
            onPress={() => {
              if (canTrackOrder(item)) {
                router.push({
                  pathname: '/shopper/TrackOrderScreen',
                  params: {
                    orderId: String(item.order_id),
                    deliveryId: String(item.delivery?.id || 0),
                    showMap: 'true',
                  },
                } as any);
              } else {
                Alert.alert('Not Available', 'Tracking will be available once your order is being prepared or out for delivery.');
              }
            }}
          >
            <Text style={[styles.trackBtnText, !canTrackOrder(item) && styles.trackBtnTextDisabled]}>
              🗺️ Track
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF8000" />
      </View>
    );
  }

  const empty = emptyMessages[activeTab];

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.replace('/home')} style={styles.backIconButton}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle}>My Orders</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {TABS.map(tab => {
          const count = countFor(tab.key);
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.icon} {tab.label}
              </Text>
              {count > 0 && (
                <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={item => String(item.order_id)}
        renderItem={renderOrder}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#FF8000']} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>{empty.emoji}</Text>
            <Text style={styles.emptyTitle}>{empty.title}</Text>
            <Text style={styles.emptySub}>{empty.sub}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
  header: {
    backgroundColor: '#FF8000', paddingBottom: 16,
    paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  backIconButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
  },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#FF8000',
  },
  tabText: { fontSize: 13, fontWeight: '600', color: '#999' },
  tabTextActive: { color: '#FF8000' },
  tabBadge: {
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabBadgeActive: { backgroundColor: '#FF800022' },
  tabBadgeText: { fontSize: 10, fontWeight: '700', color: '#777' },
  tabBadgeTextActive: { color: '#FF8000' },

  // List
  list: { padding: 16, paddingBottom: 30 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6,
  },
  cardHeader: {
    flexDirection: 'column', alignItems: 'flex-start', marginBottom: 10, gap: 6,
  },
  orderId: { fontSize: 16, fontWeight: 'bold', color: '#1a1a1a' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  restaurant: { fontSize: 14, color: '#555', marginBottom: 4 },
  address: { fontSize: 13, color: '#888', marginBottom: 10 },
  itemsList: { backgroundColor: '#fafafa', borderRadius: 8, padding: 10, marginBottom: 12 },
  itemText: { fontSize: 13, color: '#555', marginBottom: 2 },
  itemNote: { fontSize: 11, color: '#888', fontStyle: 'italic', marginLeft: 12 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 12,
  },
  buttonContainer: { flexDirection: 'row', gap: 8 },
  totalAmount: { fontSize: 16, fontWeight: 'bold', color: '#FF8000' },
  orderDate: { fontSize: 12, color: '#aaa', marginTop: 2 },
  detailsBtn: {
    backgroundColor: '#f3f4f6', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  detailsBtnText: { color: '#374151', fontSize: 12, fontWeight: '600' },
  trackBtn: {
    backgroundColor: '#FF8000', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  trackBtnDisabled: { backgroundColor: '#ccc' },
  trackBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  trackBtnTextDisabled: { color: '#888' },
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyEmoji: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  emptySub: { fontSize: 14, color: '#6b7280', marginTop: 4, textAlign: 'center', lineHeight: 20 },
});
