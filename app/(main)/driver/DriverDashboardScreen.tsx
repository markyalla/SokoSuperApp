import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Switch, RefreshControl, Modal, ScrollView, Linking, Platform, KeyboardAvoidingView } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getDriverDeliveries,
  getDriverOrderDeliveries,
  getDriverDeliveryDetail,
  getDriverOrderDeliveryDetail,
  acceptDelivery,
  updateDeliveryStatus,
  updateOrderTracking,
  generateDeliveryOTP,
  generateOrderOTP,
  verifyDeliveryOTP,
  verifyOrderOTP,
  getDriverEarnings,
  requestDriverCashout,
} from '../../../src/api';
import { useAuthStore } from '../../../src/store/authStore';
import { useDriverLocationStore } from '../../../src/store/driverLocationStore';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from '../../../src/components/Toast';
import { wsService } from '../../../src/services/websocket';
import MapView, { Marker } from 'react-native-maps';

// Shopper orders carry the customer's checkout GPS pin as user_latitude/
// user_longitude; parcel deliveries carry it as dropoff_lat/dropoff_lng —
// this normalizes both into one shape for the map.
const getCustomerCoords = (d: any): { latitude: number; longitude: number } | null => {
  if (!d) return null;
  const lat = d.source === 'shopper' ? d.user_latitude : d.dropoff_lat;
  const lng = d.source === 'shopper' ? d.user_longitude : d.dropoff_lng;
  return (lat != null && lng != null) ? { latitude: Number(lat), longitude: Number(lng) } : null;
};

// Fallback safety net in case the WebSocket push is ever missed/disconnected —
// the 'driver_assignment' WS event is what makes new assignments feel instant.
const ASSIGNMENT_POLL_INTERVAL = 20000;

interface Delivery {
  id: string | number;
  delivery_status: string;
  delivery_address: string;
  pickup_address?: string;
  order?: {
    id: string | number;
    customer_name: string;
    customer_phone?: string;
    restaurant?: string;
    total_amount: number;
    items?: any[];
  };
  // parcel delivery fields
  description?: string;
  vehicle_type?: string;
  distance_km?: number;
  total_amount?: number;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_location_notes?: string;
  sender_name?: string;
  sender_phone?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  estimated_time?: string;
  created_at?: string;
  updated_at?: string;
  user_latitude?: number;
  user_longitude?: number;
  source?: 'shopper' | 'delivery';
  order_id?: string;
  delivery_fee?: number;
  driver_earnings?: number;
}

const DONE_STATUSES = ['delivered', 'cancelled', 'refunded'];
// The driver is only ever paid this share of the delivery fee — the rest is the platform's cut.
const DRIVER_EARNINGS_RATE = 0.6;
const DELIVERY_FEE_ESTIMATE = 15; // GHS — last-resort fallback when the backend sends neither field (already a payout estimate, not a full fee)

// Always derive "what the driver gets paid" from the raw delivery fee rather than
// trusting a possibly-stale precomputed value — a driver should never be shown the
// full delivery fee as their own earnings, only their 60% cut of it.
const getDriverEarningsAmount = (item: Pick<Delivery, 'delivery_fee' | 'driver_earnings'>): number => {
  if (item.delivery_fee != null) return item.delivery_fee * DRIVER_EARNINGS_RATE;
  if (item.driver_earnings != null) return item.driver_earnings;
  return DELIVERY_FEE_ESTIMATE;
};

const getDisplayId = (id: number | string) => {
  const idStr = String(id);
  if (idStr.length > 8) return `TX-${idStr.substring(0, 8).toUpperCase()}`;
  return `FD-${idStr.padStart(6, '0')}`;
};

const getStatusColor = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'pending':             return '#95a5a6';
    case 'payment_pending':     return '#e67e22';
    case 'payment_confirmed':   return '#FF8000';
    case 'preparing':           return '#e67e22';
    case 'ready_for_pickup':    return '#3498db';
    case 'assigned_to_driver':  return '#2980b9';
    case 'assigned':            return '#2980b9';
    case 'picked_up':           return '#d35400';
    case 'in_transit':          return '#9b59b6';
    case 'delivered':           return '#2ecc71';
    case 'cancelled':           return '#e74c3c';
    case 'refunded':            return '#1D9E75';
    default:                    return '#95a5a6';
  }
};

const getStatusEmoji = (status: string) => {
  switch (status?.toLowerCase()) {
    case 'assigned_to_driver':
    case 'assigned':      return '🛵';
    case 'picked_up':     return '🥡';
    case 'in_transit':    return '🚗';
    case 'delivered':     return '✅';
    case 'cancelled':     return '❌';
    case 'refunded':      return '↩️';
    default:              return '📦';
  }
};

const getNextStatusLabel = (status: string) => {
  const flow: Record<string, string> = {
    assigned:           'Accept Delivery',
    assigned_to_driver: 'Mark Picked Up',
    accepted:           'Mark Picked Up',
    broadcast:          'Mark Picked Up',
    picked_up:          'Mark In Transit',
    in_transit:         'Mark Delivered (OTP)',
  };
  return flow[status?.toLowerCase()] || null;
};

const getNextStatus = (status: string) => {
  const flow: Record<string, string> = {
    assigned:           'accept',   // handled separately via acceptDelivery API
    assigned_to_driver: 'picked_up',
    accepted:           'picked_up',
    broadcast:          'picked_up',
    picked_up:          'in_transit',
    in_transit:         'delivered',
  };
  return flow[status?.toLowerCase()] || null;
};

export default function DriverDashboardScreen() {
  const router = useRouter();
  const { user, logout, tokens } = useAuthStore() as any;
  // Shopper orders and parcel deliveries are two independent systems — keep them separate
  const [activeShopperOrders, setActiveShopperOrders] = useState<Delivery[]>([]);
  const [completedShopperOrders, setCompletedShopperOrders] = useState<Delivery[]>([]);
  const [activeParcels, setActiveParcels] = useState<Delivery[]>([]);
  const [completedParcels, setCompletedParcels] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashTab, setDashTab] = useState<'active' | 'history'>('active');

  const displayName = (user?.user?.full_name || user?.full_name) || 'Driver';
  const driverId = user?.user?.id || user?.id;

  const { isSharing: locationSharing, driverLocation, startSharing, stopSharing } = useDriverLocationStore();

  // Earnings
  const [earnings, setEarnings] = useState({
    total_earnings: 0,
    weekly_earnings: 0,
    pending_cashout: 0,
    available_balance: 0,
  });

  // Detail modal
  const [detailModal, setDetailModal] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Map modal
  const [mapModal, setMapModal] = useState(false);
  const [mapDelivery, setMapDelivery] = useState<any>(null);

  // OTP Modal
  const [otpModal, setOtpModal] = useState(false);
  const [otpDelivery, setOtpDelivery] = useState<any>(null);
  const [enteredOtp, setEnteredOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);

  // Cashout modal
  const [cashoutModal, setCashoutModal] = useState(false);
  const [cashoutAmount, setCashoutAmount] = useState('');
  const [cashoutLoading, setCashoutLoading] = useState(false);
  const [cashoutMethod, setCashoutMethod] = useState<'momo' | 'bank'>('momo');

  const [now, setNow] = useState(new Date());
  const [toast, setToast] = useState({ visible: false, message: '' });

  // Tracks which active delivery IDs the driver has already seen, so a silent
  // background poll can tell "newly assigned" apart from "already showing".
  const seenActiveIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (driverId) {
      loadDeliveries(driverId);
    } else {
      setLoading(false);
      Alert.alert('Authentication Error', 'Driver ID not found. Please log in again.');
    }
    // Location sharing intentionally is NOT stopped here — it must keep
    // running when the driver navigates away from this screen, and only
    // stops via the Switch toggle (stopSharing) or logout.
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Backup poll for newly assigned deliveries while the dashboard is focused,
  // in case the WebSocket push below is ever missed or disconnected.
  useFocusEffect(
    useCallback(() => {
      if (!driverId) return;
      const interval = setInterval(() => {
        loadDeliveries(driverId, { silent: true });
      }, ASSIGNMENT_POLL_INTERVAL);
      return () => clearInterval(interval);
    }, [driverId])
  );

  // Real-time push: the backend LISTENs for pg_notify events fired the instant
  // a driver_id is written to delivery_assignments/order_deliveries — by the
  // admin's SokoWeb dashboard or the auto-assign worker — and relays them here
  // over this driver's WebSocket connection, so a new assignment shows up
  // immediately without waiting for the backup poll above.
  useEffect(() => {
    if (!tokens?.access) return;
    wsService.connect(tokens.access);
    return wsService.addHandler((event) => {
      if (event.type === 'driver_assignment' && driverId) {
        loadDeliveries(driverId, { silent: true });
      }
    });
  }, [tokens?.access, driverId]);

  const loadEarnings = async () => {
    try {
      const res = await getDriverEarnings();
      const data = res.data;
      setEarnings({
        total_earnings:    data.total_earnings    ?? 0,
        weekly_earnings:   data.weekly_earnings   ?? 0,
        pending_cashout:   data.pending_cashout   ?? 0,
        available_balance: data.available_balance ?? 0,
      });
    } catch {
      // silent — earnings card stays at previous values
    }
  };

  const loadDeliveries = async (id: string | number, opts: { silent?: boolean } = {}) => {
    if (!id) return;
    if (!opts.silent) setLoading(true);
    try {
      const [resLogistics, resShopper] = await Promise.all([
        getDriverDeliveries(),
        getDriverOrderDeliveries(),
      ]);

      const rawParcels = Array.isArray(resLogistics.data)
        ? resLogistics.data : resLogistics.data?.data || [];
      const rawShopper = Array.isArray(resShopper.data)
        ? resShopper.data : resShopper.data?.data || [];

      const byNewest = (a: any, b: any) =>
        new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();

      // A delivery is expired-awaiting when the driver never responded within 5 min.
      // Only use driver_assigned_at / accepted_at / created_at — never updated_at,
      // because updated_at is refreshed by unrelated backend writes (e.g. assigning a
      // new delivery) and would falsely reset the countdown on old locked deliveries.
      const AWAITING_STATUSES = ['assigned', 'assigned_to_driver', 'accepted', 'broadcast'];
      const isExpiredAwaiting = (d: any): boolean => {
        if (!AWAITING_STATUSES.includes(d.delivery_status?.toLowerCase())) return false;
        const ref = d.driver_assigned_at || d.accepted_at || d.created_at;
        if (!ref) return false;
        return Date.now() - new Date(ref).getTime() > 5 * 60 * 1000;
      };

      // Shopper orders — independent list
      const shopperItems: Delivery[] = rawShopper.map((d: any) => ({
        ...d,
        id: d.id || d.order_id,
        source: 'shopper' as const,
      }));
      const newActiveShopper = shopperItems
        .filter(d => !DONE_STATUSES.includes(d.delivery_status?.toLowerCase()) && !isExpiredAwaiting(d))
        .sort(byNewest);

      // Parcel deliveries — independent list
      const parcelItems: Delivery[] = rawParcels.map((d: any) => ({
        ...d,
        id: d.id || d.delivery_id,
        source: 'delivery' as const,
      }));
      const newActiveParcels = parcelItems
        .filter(d => !DONE_STATUSES.includes(d.delivery_status?.toLowerCase()) && !isExpiredAwaiting(d))
        .sort(byNewest);

      // Compare against what the driver has already seen to spot fresh admin
      // assignments — only meaningful once we've captured a baseline, and only
      // during background polls (the very first load shouldn't "announce" anything).
      const allActive = [...newActiveShopper, ...newActiveParcels];
      const newActiveIds = new Set(allActive.map(d => String(d.id)));
      if (opts.silent && seenActiveIdsRef.current) {
        const freshlyAssigned = allActive.filter(
          d => AWAITING_STATUSES.includes(d.delivery_status?.toLowerCase())
            && !seenActiveIdsRef.current!.has(String(d.id))
        );
        if (freshlyAssigned.length === 1) {
          const label = freshlyAssigned[0].source === 'shopper' ? 'order' : 'delivery';
          setToast({ visible: true, message: `🚴 New ${label} assigned to you!` });
        } else if (freshlyAssigned.length > 1) {
          setToast({ visible: true, message: `🚴 ${freshlyAssigned.length} new deliveries assigned to you!` });
        }
      }
      seenActiveIdsRef.current = newActiveIds;

      setActiveShopperOrders(newActiveShopper);
      setCompletedShopperOrders(
        shopperItems
          .filter(d => DONE_STATUSES.includes(d.delivery_status?.toLowerCase()) || isExpiredAwaiting(d))
          .sort(byNewest)
      );

      setActiveParcels(newActiveParcels);
      setCompletedParcels(
        parcelItems
          .filter(d => DONE_STATUSES.includes(d.delivery_status?.toLowerCase()) || isExpiredAwaiting(d))
          .sort(byNewest)
      );

      if (!opts.silent) loadEarnings();
    } catch (e: any) {
      console.error('Load deliveries error:', e.message);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDeliveries(driverId);
    setRefreshing(false);
  };

  const openDetail = async (delivery: Delivery) => {
    if (!delivery?.id) { Alert.alert('Error', 'Invalid Task ID'); return; }
    setDetailLoading(true);
    setDetailModal(true);
    try {
      const response = delivery.source === 'shopper'
        ? await getDriverOrderDeliveryDetail(String(delivery.id))
        : await getDriverDeliveryDetail(String(delivery.id));
      const detail = response.data?.data || response.data;
      setSelectedDelivery({
        ...detail,
        source: delivery.source,
        delivery_status: detail.delivery_status || detail.status || detail.Status,
        // Preserve order_id from the list item — detail endpoint now also returns it,
        // but keeping this fallback ensures tracking calls always have the right Order UUID.
        order_id: detail.order_id || delivery.order_id,
      });
    } catch (e: any) {
      Alert.alert('Error', e.message);
      setDetailModal(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const openMap = async (deliveryId: string | number) => {
    setDetailLoading(true);
    setMapModal(true);
    try {
      const delivery = [...activeShopperOrders, ...completedShopperOrders, ...activeParcels, ...completedParcels].find(d => d.id === deliveryId);
      const response = delivery?.source === 'shopper'
        ? await getDriverOrderDeliveryDetail(String(deliveryId))
        : await getDriverDeliveryDetail(String(deliveryId));
      const detail = response.data?.data || response.data;
      setMapDelivery({ ...detail, source: delivery?.source });
    } catch (e: any) {
      Alert.alert('Error', e.message);
      setMapModal(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const openNativeMap = (lat: number, lng: number, label: string) => {
    const url = Platform.OS === 'ios'
      ? `maps:0,0?q=${lat},${lng}(${encodeURIComponent(label)})`
      : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) Linking.openURL(url);
      else Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    });
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => {
          // Tell the backend the driver is offline — otherwise they'd stay
          // stuck "online" for other admins/drivers to see until the
          // server's own staleness sweep catches it a few minutes later.
          await stopSharing();
          setTimeout(() => logout(), 300);
        }
      }
    ]);
  };

  const toggleLocationSharing = async (value: boolean) => {
    if (value) {
      const started = await startSharing();
      if (!started) {
        Alert.alert('Permission Denied', 'Location permission is required.');
        return;
      }
      Alert.alert('✅ You are now Online', 'Your location is live. Admin can assign you deliveries.');
    } else {
      await stopSharing();
      Alert.alert('⚫ You are now Offline', 'You will not receive new delivery assignments.');
    }
  };

  // ── Accept a delivery assigned by admin ──
  const handleAcceptDelivery = (delivery: Delivery) => {
    const isShopper = delivery.source === 'shopper';
    Alert.alert(
      'Accept Delivery',
      isShopper
        ? 'Confirm you have picked up this order from the store.'
        : 'Confirm you are accepting this delivery job. You will be marked as unavailable until it is completed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            try {
              if (isShopper) {
                // Shopper order: use order_id with the order tracking endpoint.
                // order_deliveries has no "accepted" state — assigned → picked_up directly.
                const orderId = delivery.order_id || String(delivery.id);
                await updateOrderTracking(orderId, 'picked_up');
                Alert.alert('✅ Picked Up', 'Order picked up. Head to the customer\'s address.');
              } else {
                await acceptDelivery(String(delivery.id));
                Alert.alert('✅ Accepted', 'You have accepted the delivery. Head to the pickup location.');
              }
              loadDeliveries(driverId);
              if (detailModal && selectedDelivery?.id === delivery.id) openDetail(delivery);
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.error || e.message || 'Could not accept delivery.');
            }
          },
        },
      ],
    );
  };

  // ── Status update ──
  const updateStatus = (delivery: Delivery) => {
    const nextStatus = getNextStatus(delivery.delivery_status);
    if (!nextStatus) return;

    // "assigned" → driver must explicitly accept via dedicated endpoint
    if (nextStatus === 'accept') {
      handleAcceptDelivery(delivery);
      return;
    }

    if (nextStatus === 'delivered') {
      handleGenerateOTP(delivery);
      return;
    }

    const labels: Record<string, string> = {
      picked_up:  'You have collected the parcel from the pickup point.',
      in_transit: 'You are on the way to the delivery address.',
    };

    Alert.alert(
      'Update Status',
      `Mark as "${nextStatus.replace(/_/g, ' ')}"?\n\n${labels[nextStatus] || ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Update',
          onPress: async () => {
            try {
              if (delivery.source === 'shopper') {
                // updateOrderTracking routes on Order ID, not OrderDelivery ID
                const orderId = delivery.order_id || String(delivery.id);
                await updateOrderTracking(orderId, nextStatus);
              } else {
                await updateDeliveryStatus(String(delivery.id), nextStatus);
              }
              Alert.alert('✅ Updated', `Status: ${nextStatus.replace(/_/g, ' ')}`);
              loadDeliveries(driverId);
              if (detailModal && selectedDelivery?.id === delivery.id) openDetail(delivery);
            } catch (e: any) { Alert.alert('Error', e?.response?.data?.error || e.message); }
          },
        },
      ],
    );
  };

  // ── OTP ──
  const handleGenerateOTP = async (delivery: Delivery) => {
    setOtpLoading(true);
    setOtpDelivery(delivery);
    setEnteredOtp('');
    try {
      // Generates the code and sends it to the customer's app — the driver
      // never sees it here, they must ask the customer to read it out.
      delivery.source === 'shopper'
        ? await generateOrderOTP(String(delivery.id))
        : await generateDeliveryOTP(String(delivery.id));
      setOtpModal(true);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not generate OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!enteredOtp || enteredOtp.length !== 4) {
      Alert.alert('Error', 'Please enter the 4-digit code from the customer');
      return;
    }
    setOtpLoading(true);
    try {
      otpDelivery.source === 'shopper'
        ? await verifyOrderOTP(String(otpDelivery.id), enteredOtp)
        : await verifyDeliveryOTP(String(otpDelivery.id), enteredOtp);

      setOtpModal(false);
      setEnteredOtp('');

      // Switch to history tab and show earnings
      await loadDeliveries(driverId);
      setDashTab('history');

      const fee = getDriverEarningsAmount(otpDelivery);
      Alert.alert(
        '🎉 Delivery Complete!',
        `OTP verified!\n\nTask ${getDisplayId(otpDelivery.id)} is done.\n\n💰 +GHS ${fee.toFixed(2)} added to your earnings.`,
        [{ text: 'View Earnings', style: 'default' }]
      );
    } catch (e: any) {
      Alert.alert('❌ Wrong OTP', e.message || 'Incorrect code. Ask customer again.');
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Cashout ──
  const handleRequestCashout = async () => {
    const amount = parseFloat(cashoutAmount);
    if (!cashoutAmount || isNaN(amount) || amount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    if (amount > earnings.available_balance) {
      Alert.alert('Insufficient Balance', `Your available balance is GHS ${earnings.available_balance.toFixed(2)}.`);
      return;
    }
    if (amount < 10) {
      Alert.alert('Minimum Cashout', 'Minimum cashout amount is GHS 10.00.');
      return;
    }

    setCashoutLoading(true);
    try {
      const res = await requestDriverCashout(amount, cashoutMethod);
      const data = res.data;
      setEarnings(prev => ({
        ...prev,
        available_balance: data.available_balance ?? prev.available_balance - amount,
        pending_cashout:   data.pending_cashout   ?? prev.pending_cashout + amount,
      }));
      setCashoutModal(false);
      setCashoutAmount('');
      Alert.alert(
        '✅ Cashout Requested',
        `GHS ${amount.toFixed(2)} via ${cashoutMethod === 'momo' ? 'Mobile Money' : 'Bank Transfer'}.\n\nProcessing is 1-10 minutes.`
      );
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? e.message ?? 'Cashout request failed.';
      Alert.alert('Error', msg);
    } finally {
      setCashoutLoading(false);
    }
  };

  // ── Render delivery card ──
  const renderDelivery = ({ item }: { item: Delivery }) => {
    const nextLabel = getNextStatusLabel(item.delivery_status);
    const isDone = DONE_STATUSES.includes(item.delivery_status?.toLowerCase());
    const isDelivered = item.delivery_status?.toLowerCase() === 'delivered';
    const fee = getDriverEarningsAmount(item);

    const AWAITING_PICKUP_STATUSES = ['assigned', 'assigned_to_driver', 'accepted', 'broadcast'];
    const getRemainingTime = () => {
      if (!AWAITING_PICKUP_STATUSES.includes(item.delivery_status?.toLowerCase())) return null;
      // Never use updated_at — it is refreshed by unrelated backend writes
      // (e.g. assigning a new delivery) and would reset the countdown on old locked deliveries.
      const ref = (item as any).driver_assigned_at
        || (item as any).accepted_at
        || (item as any).created_at;
      if (!ref) return null;
      const assignedTime = new Date(ref).getTime();
      const diff = 5 * 60 * 1000 - (now.getTime() - assignedTime);
      if (diff <= 0) return 'EXPIRED';
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    const timeRemaining = getRemainingTime();
    const isExpired = timeRemaining === 'EXPIRED';

    return (
      <View style={[styles.card, isExpired && styles.cardExpired]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.deliveryId}>Task {getDisplayId(item.id)}</Text>
            <View style={styles.addressRow}>
              <Ionicons name="location-outline" size={14} color="#64748b" />
              <Text style={styles.address} numberOfLines={2}>{item.delivery_address}</Text>
            </View>
          </View>
          <View style={[styles.badge, { backgroundColor: getStatusColor(item.delivery_status) }]}>
            <Text style={styles.badgeText}>
              {getStatusEmoji(item.delivery_status)} {item.delivery_status?.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>

        {timeRemaining && (
          <View style={[styles.timerContainer, isExpired ? styles.timerExpired : styles.timerActive]}>
            <Text style={[styles.timerText, isExpired && styles.timerTextExpired]}>
              {isExpired
                ? '🔒 Order locked — admin is reassigning a new driver'
                : `⏱ Pick up within: ${timeRemaining}`}
            </Text>
          </View>
        )}

        {item.order && (
          <View style={styles.orderSnap}>
            <View style={styles.orderSnapRow}>
              <Ionicons name="person-outline" size={14} color="#FF8000" />
              <Text style={styles.snapRowText}>{item.order.customer_name}</Text>
            </View>
            <View style={styles.orderSnapRow}>
              <Ionicons name="storefront-outline" size={14} color="#64748b" />
              <Text style={styles.snapRowText}>{item.order.restaurant || 'N/A'}</Text>
            </View>
            <View style={styles.orderSnapRow}>
              <Ionicons name="cash-outline" size={14} color="#16a34a" />
              <Text style={styles.snapRowText}>GHS {item.order.total_amount?.toFixed(2)}</Text>
            </View>
            {item.estimated_time && (
              <View style={styles.orderSnapRow}>
                <Ionicons name="time-outline" size={14} color="#64748b" />
                <Text style={styles.snapRowText}>Est. {item.estimated_time}</Text>
              </View>
            )}
          </View>
        )}

        {/* Earnings row for completed deliveries */}
        {isDelivered && (
          <View style={styles.earningsRow}>
            <View style={styles.earningsPill}>
              <Text style={styles.earningsPillLabel}>Your earnings</Text>
              <Text style={styles.earningsPillAmount}>+GHS {fee.toFixed(2)}</Text>
            </View>
            {item.created_at && (
              <Text style={styles.completedDate}>
                {new Date(item.created_at).toLocaleDateString('en-GH', {
                  day: 'numeric', month: 'short', year: 'numeric'
                })}
              </Text>
            )}
          </View>
        )}

        {item.delivery_status?.toLowerCase() === 'cancelled' && (
          <View style={styles.cancelledPill}>
            <Text style={styles.cancelledPillText}>❌ Cancelled — no earnings</Text>
          </View>
        )}

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.detailBtn, isExpired && styles.btnLocked]}
            onPress={() => {
              if (isExpired) {
                Alert.alert('🔒 Order Locked', 'You did not pick up this order within 5 minutes. The admin will reassign it.');
                return;
              }
              openDetail(item);
            }}
          >
            <Text style={styles.detailBtnText}>{isExpired ? '🔒 Locked' : '📋 Details'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapBtn, isExpired && styles.btnLocked]}
            onPress={() => {
              if (isExpired) {
                Alert.alert('🔒 Order Locked', 'You did not pick up this order within 5 minutes. The admin will reassign it.');
                return;
              }
              openMap(item.id);
            }}
          >
            <Text style={styles.mapBtnText}>{isExpired ? '🔒 Locked' : '🗺️ Map'}</Text>
          </TouchableOpacity>
        </View>

        {!isDone && nextLabel && (
          <TouchableOpacity
            style={[
              styles.updateBtn,
              nextLabel.includes('OTP') && styles.updateBtnOtp,
              isExpired && styles.updateBtnLocked,
            ]}
            onPress={() => {
              if (isExpired) {
                Alert.alert(
                  '🔒 Order Locked',
                  'You did not mark this order as picked up within 5 minutes. The admin has been notified and will reassign it to another driver.',
                );
                return;
              }
              updateStatus(item);
            }}
          >
            <Text style={styles.updateBtnText}>
              {isExpired
                ? '🔒 Order Locked'
                : nextLabel.includes('OTP')
                  ? '🔐 ' + nextLabel
                  : '→ ' + nextLabel}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D9E75" />
        <Text style={styles.loadingText}>Loading deliveries...</Text>
      </View>
    );
  }

  const currentShopper = dashTab === 'active' ? activeShopperOrders : completedShopperOrders;
  const currentParcels  = dashTab === 'active' ? activeParcels      : completedParcels;
  const totalActive     = activeShopperOrders.length + activeParcels.length;
  const totalCompleted  = completedShopperOrders.length + completedParcels.length;

  return (
    <SafeAreaView style={styles.safeArea}>
      

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => router.replace('/home')} style={styles.backIconButton}>
            <Ionicons name="arrow-back" size={20} color="#FF8000" />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            
            <Text style={styles.headerTitle}>Driver Dashboard</Text>
            <Text style={styles.headerSub}>Welcome back, {displayName}</Text>
          </View>
        </View>

        <View style={styles.locationToggleCard}>
          <Ionicons name={locationSharing ? 'radio-button-on' : 'radio-button-off'} size={16} color={locationSharing ? '#16a34a' : '#64748b'} />
          <Text style={styles.locationLabel}>{locationSharing ? 'Live' : 'Offline'}</Text>
          <Switch
            value={locationSharing}
            onValueChange={toggleLocationSharing}
            trackColor={{ false: '#e2e8f0', true: '#dcfce7' }}
            thumbColor={locationSharing ? '#16a34a' : '#f4f3f4'}
          />
        </View>
      </View>

      {locationSharing && (
        <View style={styles.liveBanner}>
          <Text style={styles.liveBannerText}>🟢 Sharing live location with customers</Text>
        </View>
      )}

      {/* ── Earnings Card ── */}
      <View style={styles.earningsCard}>
        <View style={styles.earningsTopRow}>
          <View style={styles.earningsHero}>
            <View style={styles.earningsIconBadge}>
              <Ionicons name="wallet-outline" size={22} color="#FF8000" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.earningsCardLabel}>Available Balance</Text>
              <Text style={styles.earningsCardAmount}>GHS {earnings.available_balance.toFixed(2)}</Text>
              {earnings.pending_cashout > 0 && (
                <Text style={styles.pendingText}>GHS {earnings.pending_cashout.toFixed(2)} pending payout</Text>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={styles.cashoutBtn}
            onPress={() => {
              setCashoutAmount('');
              setCashoutModal(true);
            }}
          >
            <Ionicons name="cash-outline" size={16} color="#fff" />
            <Text style={styles.cashoutBtnText}>Cash Out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.earningsDivider} />

        <View style={styles.earningsStatsRow}>
          <View style={styles.earningsStat}>
            <Text style={styles.earningsStatLabel}>Total Earned</Text>
            <Text style={styles.earningsStatValue}>GHS {earnings.total_earnings.toFixed(2)}</Text>
          </View>
          <View style={styles.earningsStatDivider} />
          <View style={styles.earningsStat}>
            <Text style={styles.earningsStatLabel}>This Week</Text>
            <Text style={[styles.earningsStatValue, { color: '#FF8000' }]}>GHS {earnings.weekly_earnings.toFixed(2)}</Text>
          </View>
          <View style={styles.earningsStatDivider} />
          <View style={styles.earningsStat}>
            <Text style={styles.earningsStatLabel}>Deliveries</Text>
            <Text style={styles.earningsStatValue}>
              {[...completedShopperOrders, ...completedParcels].filter(d => d.delivery_status?.toLowerCase() === 'delivered').length}
            </Text>
          </View>
        </View>
        <Text style={styles.earningsSub}>Payouts processed upon request</Text>
      </View>

      {/* ── Active / History Tabs ── */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, dashTab === 'active' && styles.tabActive]}
          onPress={() => setDashTab('active')}
        >
          <Text style={[styles.tabText, dashTab === 'active' && styles.tabTextActive]}>
            🚗 Active ({totalActive})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, dashTab === 'history' && styles.tabActive]}
          onPress={() => setDashTab('history')}
        >
          <Text style={[styles.tabText, dashTab === 'history' && styles.tabTextActive]}>
            📦 History ({totalCompleted})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#1D9E75']} />
        }
      >
        {/* ── Shopper Orders section ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🍱 Shopper Orders</Text>
          <Text style={styles.sectionCount}>{currentShopper.length}</Text>
        </View>
        {currentShopper.length === 0 ? (
          <View style={styles.sectionEmpty}>
            <Text style={styles.sectionEmptyText}>
              {dashTab === 'active' ? 'No active shopper orders' : 'No completed shopper orders'}
            </Text>
          </View>
        ) : (
          currentShopper.map(item => (
            <View key={`shopper-${item.id}`}>
              {renderDelivery({ item })}
            </View>
          ))
        )}

        {/* ── Parcel Deliveries section ── */}
        <View style={[styles.sectionHeader, { marginTop: 16 }]}>
          <Text style={styles.sectionTitle}>📦 Parcel Deliveries</Text>
          <Text style={styles.sectionCount}>{currentParcels.length}</Text>
        </View>
        {currentParcels.length === 0 ? (
          <View style={styles.sectionEmpty}>
            <Text style={styles.sectionEmptyText}>
              {dashTab === 'active' ? 'No active parcel deliveries' : 'No completed parcel deliveries'}
            </Text>
          </View>
        ) : (
          currentParcels.map(item => (
            <View key={`parcel-${item.id}`}>
              {renderDelivery({ item })}
            </View>
          ))
        )}
      </ScrollView>

      {/* ── CASHOUT MODAL ── */}
      <Modal visible={cashoutModal} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <View style={styles.cashoutModalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>💸 Request Cashout</Text>
              <TouchableOpacity onPress={() => setCashoutModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.balanceDisplay}>
              <Text style={styles.balanceLabel}>Available Balance</Text>
              <Text style={styles.balanceAmount}>GHS {earnings.available_balance.toFixed(2)}</Text>
            </View>

            {/* Method selector */}
            <Text style={styles.cashoutSectionLabel}>Payout Method</Text>
            <View style={styles.methodRow}>
              <TouchableOpacity
                style={[styles.methodBtn, cashoutMethod === 'momo' && styles.methodBtnActive]}
                onPress={() => setCashoutMethod('momo')}
              >
                <Text style={styles.methodEmoji}>📱</Text>
                <Text style={[styles.methodLabel, cashoutMethod === 'momo' && styles.methodLabelActive]}>
                  Mobile Money
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.methodBtn, cashoutMethod === 'bank' && styles.methodBtnActive]}
                onPress={() => setCashoutMethod('bank')}
              >
                <Text style={styles.methodEmoji}>🏦</Text>
                <Text style={[styles.methodLabel, cashoutMethod === 'bank' && styles.methodLabelActive]}>
                  Bank Transfer
                </Text>
              </TouchableOpacity>
            </View>

            {/* Amount input */}
            <Text style={styles.cashoutSectionLabel}>Amount (GHS)</Text>
            <TextInput
              style={styles.cashoutInput}
              value={cashoutAmount}
              onChangeText={text => setCashoutAmount(text.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              placeholderTextColor="#bbb"
              keyboardType="decimal-pad"
            />
            <Text style={styles.cashoutHint}>Minimum: GHS 10.00 · Max: GHS {earnings.available_balance.toFixed(2)}</Text>

            {/* Quick amounts */}
            <View style={styles.quickAmountRow}>
              {[20, 50, 100, 200].map(amt => (
                <TouchableOpacity
                  key={amt}
                  style={[styles.quickAmtBtn, parseFloat(cashoutAmount) === amt && styles.quickAmtBtnActive]}
                  onPress={() => setCashoutAmount(String(amt))}
                >
                  <Text style={[styles.quickAmtText, parseFloat(cashoutAmount) === amt && styles.quickAmtTextActive]}>
                    {amt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.cashoutModalActions}>
              <TouchableOpacity
                style={styles.cashoutCancelBtn}
                onPress={() => setCashoutModal(false)}
              >
                <Text style={styles.cashoutCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cashoutConfirmBtn, cashoutLoading && { opacity: 0.6 }]}
                onPress={handleRequestCashout}
                disabled={cashoutLoading}
              >
                {cashoutLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.cashoutConfirmText}>Request Cashout</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── ORDER DETAIL MODAL ── */}
      <Modal visible={detailModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedDelivery?.source === 'delivery' ? '📦 Parcel Details' : '🍱 Order Details'}
                {selectedDelivery ? ` — ${getDisplayId(selectedDelivery.id)}` : ''}
              </Text>
              <TouchableOpacity onPress={() => setDetailModal(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {detailLoading ? (
              <ActivityIndicator size="large" color="#FF8000" style={{ marginVertical: 30 }} />
            ) : selectedDelivery ? (
              <ScrollView showsVerticalScrollIndicator={false}>

                {/* ── Status badge ── */}
                <View style={[styles.detailStatusBadge,
                  { backgroundColor: getStatusColor(selectedDelivery.delivery_status) }]}>
                  <Text style={styles.detailStatusText}>
                    {getStatusEmoji(selectedDelivery.delivery_status)}{' '}
                    {selectedDelivery.delivery_status?.replace(/_/g, ' ').toUpperCase()}
                  </Text>
                </View>

                {/* ── Earnings (delivered) ── */}
                {selectedDelivery.delivery_status?.toLowerCase() === 'delivered' && (
                  <View style={styles.detailEarningsBox}>
                    <Text style={styles.detailEarningsLabel}>Your Earnings for This Delivery</Text>
                    <Text style={styles.detailEarningsAmount}>
                      +GHS {getDriverEarningsAmount(selectedDelivery).toFixed(2)}
                    </Text>
                    {selectedDelivery.delivery_fee != null && (
                      <Text style={[styles.detailEarningsLabel, { marginTop: 4 }]}>60% of GHS {selectedDelivery.delivery_fee.toFixed(2)} delivery fee</Text>
                    )}
                  </View>
                )}

                {/* ════ PARCEL DELIVERY (source === 'delivery') ════ */}
                {selectedDelivery.source === 'delivery' && (<>

                  {/* Progress stages */}
                  {(() => {
                    const stages = ['accepted', 'picked_up', 'in_transit', 'delivered'];
                    const labels = ['Assigned', 'Picked Up', 'In Transit', 'Delivered'];
                    const cur = selectedDelivery.delivery_status?.toLowerCase();
                    const curIdx = stages.indexOf(cur);
                    return (
                      <View style={styles.progressContainer}>
                        <Text style={styles.progressTitle}>Delivery Progress</Text>
                        <View style={styles.progressTrack}>
                          {stages.map((s, i) => {
                            const done = curIdx >= i;
                            const active = curIdx === i;
                            return (
                              <View key={s} style={styles.progressStepWrap}>
                                <View style={[styles.progressDot,
                                  done && styles.progressDotDone,
                                  active && styles.progressDotActive,
                                ]}>
                                  {done && <Ionicons name="checkmark" size={10} color="#fff" />}
                                </View>
                                <Text style={[styles.progressLabel, done && styles.progressLabelDone]}>
                                  {labels[i]}
                                </Text>
                                {i < stages.length - 1 && (
                                  <View style={[styles.progressLine, curIdx > i && styles.progressLineDone]} />
                                )}
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    );
                  })()}

                  {/* Parcel info */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>📦 Parcel</Text>
                    <Text style={styles.detailRow}>{selectedDelivery.description || '—'}</Text>
                    <View style={styles.detailGrid}>
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>Vehicle</Text>
                        <Text style={styles.detailGridValue}>{(selectedDelivery.vehicle_type || 'N/A').charAt(0).toUpperCase() + (selectedDelivery.vehicle_type || '').slice(1)}</Text>
                      </View>
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>Distance</Text>
                        <Text style={styles.detailGridValue}>{selectedDelivery.distance_km ? `${Number(selectedDelivery.distance_km).toFixed(1)} km` : '—'}</Text>
                      </View>
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>Total Fee</Text>
                        <Text style={[styles.detailGridValue, { color: '#FF8000' }]}>GHS {(selectedDelivery.delivery_fee || 0).toFixed(2)}</Text>
                      </View>
                      <View style={styles.detailGridItem}>
                        <Text style={styles.detailGridLabel}>Your Cut</Text>
                        <Text style={[styles.detailGridValue, { color: '#e2790f' }]}>GHS {getDriverEarningsAmount(selectedDelivery).toFixed(2)}</Text>
                      </View>
                    </View>
                  </View>

                  {/* Route */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>🗺 Route</Text>
                    <View style={styles.routeRow}>
                      <Ionicons name="radio-button-on-outline" size={14} color="#e2790f" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.routeLabel}>Pickup</Text>
                        <Text style={styles.routeAddr}>{selectedDelivery.pickup_address || '—'}</Text>
                      </View>
                    </View>
                    <View style={[styles.routeRow, { marginTop: 10 }]}>
                      <Ionicons name="location-outline" size={14} color="#FF8000" />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.routeLabel}>Dropoff</Text>
                        <Text style={styles.routeAddr}>{selectedDelivery.delivery_address || selectedDelivery.dropoff_address || '—'}</Text>
                      </View>
                    </View>
                  </View>

                  {/* Receiver */}
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>👤 Receiver</Text>
                    <View style={styles.personRow}>
                      <View style={[styles.personAvatar, { backgroundColor: '#fff7ed' }]}>
                        <Ionicons name="person-outline" size={18} color="#FF8000" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.personName}>{selectedDelivery.receiver_name || '—'}</Text>
                        {selectedDelivery.receiver_phone && (
                          <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedDelivery.receiver_phone}`)}>
                            <Text style={styles.personPhone}>📞 {selectedDelivery.receiver_phone}</Text>
                          </TouchableOpacity>
                        )}
                        {selectedDelivery.receiver_location_notes ? (
                          <Text style={styles.personNotes}>📌 {selectedDelivery.receiver_location_notes}</Text>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  {/* Sender */}
                  {selectedDelivery.sender_name ? (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>📤 Sender</Text>
                      <View style={styles.personRow}>
                        <View style={[styles.personAvatar, { backgroundColor: '#f0f9ff' }]}>
                          <Ionicons name="person-outline" size={18} color="#3b82f6" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.personName}>{selectedDelivery.sender_name}</Text>
                          {selectedDelivery.sender_phone && (
                            <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedDelivery.sender_phone}`)}>
                              <Text style={styles.personPhone}>📞 {selectedDelivery.sender_phone}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  ) : null}

                </>)}

                {/* ════ SHOPPER ORDER (source === 'shopper') ════ */}
                {selectedDelivery.source === 'shopper' && (<>
                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>📍 Delivery Info</Text>
                    <Text style={styles.detailRow}>Address: {selectedDelivery.delivery_address}</Text>
                    <Text style={styles.detailRow}>Est. Time: {selectedDelivery.estimated_time || 'N/A'}</Text>
                  </View>

                  {selectedDelivery.order && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>📦 Order Info</Text>
                      <Text style={styles.detailRow}>Order #{selectedDelivery.order.id}</Text>
                      <Text style={styles.detailRow}>Customer: {selectedDelivery.order.customer_name}</Text>
                      {selectedDelivery.order.customer_phone ? (
                        <TouchableOpacity onPress={() => Linking.openURL(`tel:${selectedDelivery.order.customer_phone}`)}>
                          <Text style={styles.personPhone}>📞 {selectedDelivery.order.customer_phone}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <Text style={styles.detailRow}>Shop: {selectedDelivery.order.restaurant || 'N/A'}</Text>
                    </View>
                  )}

                  {selectedDelivery.order?.items?.length > 0 && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>🍱 Items Ordered</Text>
                      {selectedDelivery.order.items.map((item: any, idx: number) => (
                        <View key={idx} style={styles.foodItemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.foodItemName}>{item.name}</Text>
                            <Text style={styles.foodItemQty}>Qty: {item.quantity}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={styles.foodItemPrice}>GHS {item.price?.toFixed(2)} each</Text>
                            <Text style={styles.foodItemSubtotal}>= GHS {item.subtotal?.toFixed(2)}</Text>
                          </View>
                        </View>
                      ))}
                      <View style={styles.totalDivider} />
                      <View style={styles.foodItemRow}>
                        <Text style={styles.grandTotalLabel}>Total</Text>
                        <Text style={styles.grandTotalValue}>
                          GHS {selectedDelivery.order.total_amount?.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  )}
                </>)}

                {/* ── Action button ── */}
                {(() => {
                  const nextLabel = getNextStatusLabel(selectedDelivery.delivery_status);
                  if (!nextLabel) return null;
                  const AWAITING = ['assigned', 'assigned_to_driver', 'accepted', 'broadcast'];
                  const isModalExpired = AWAITING.includes(selectedDelivery.delivery_status?.toLowerCase()) && (() => {
                    const ref = selectedDelivery.driver_assigned_at
                      || selectedDelivery.accepted_at
                      || selectedDelivery.created_at;
                    return ref && (Date.now() - new Date(ref).getTime()) > 5 * 60 * 1000;
                  })();
                  return (
                    <TouchableOpacity
                      style={[
                        styles.modalUpdateBtn,
                        selectedDelivery.delivery_status?.toLowerCase() === 'in_transit' && styles.modalUpdateBtnOtp,
                        isModalExpired && styles.modalUpdateBtnLocked,
                      ]}
                      onPress={() => {
                        if (isModalExpired) {
                          Alert.alert('🔒 Order Locked', 'You did not pick up this order within 5 minutes. The admin will reassign it.');
                          return;
                        }
                        const delivery = [...activeShopperOrders, ...completedShopperOrders, ...activeParcels, ...completedParcels]
                          .find(d => String(d.id) === String(selectedDelivery.id));
                        setDetailModal(false);
                        setTimeout(() => updateStatus(delivery ?? { ...selectedDelivery, id: selectedDelivery.id }), 300);
                      }}
                    >
                      <Text style={styles.modalUpdateBtnText}>
                        {isModalExpired
                          ? '🔒 Order Locked'
                          : selectedDelivery.delivery_status?.toLowerCase() === 'in_transit'
                            ? '🔐 Mark Delivered (OTP Required)'
                            : `→ ${nextLabel}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })()}

                <View style={{ height: 24 }} />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* ── MAP MODAL ── */}
      {/* Rendered as a plain absolutely-positioned overlay instead of RN's
          <Modal> — react-native-maps' native MapView crashes the app on
          Android when mounted inside a Modal (it renders into a separate
          Dialog window that the Google Maps SDK can't reliably attach to).
          The customer-facing map (TrackOrderScreen) never crashes because
          it's rendered inline on the screen, not inside a Modal — mirroring
          that here avoids the native crash. */}
      {mapModal && (
        <View style={styles.mapModalContainer}>
          <View style={styles.mapModalHeader}>
            <Text style={styles.mapModalTitle}>
              🗺️ Delivery #{mapDelivery?.id} — Location
            </Text>
            <TouchableOpacity onPress={() => setMapModal(false)}>
              <Text style={styles.mapModalClose}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          {detailLoading ? (
            <View style={styles.mapLoading}>
              <ActivityIndicator size="large" color="#FF8000" />
              <Text style={styles.loadingText}>Loading location info...</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.mapContent}>
              {(() => {
                const customerCoords = getCustomerCoords(mapDelivery);
                const driverCoords = driverLocation
                  ? { latitude: driverLocation.lat, longitude: driverLocation.lng }
                  : null;
                if (!customerCoords && !driverCoords) return null;

                const center = customerCoords || driverCoords!;
                // Wide enough to comfortably fit both pins when both exist.
                const delta = customerCoords && driverCoords
                  ? Math.max(0.02, Math.abs(customerCoords.latitude - driverCoords.latitude) * 2.5)
                  : 0.01;

                return (
                  <MapView
                    style={styles.mapPreview}
                    initialRegion={{
                      latitude: center.latitude,
                      longitude: center.longitude,
                      latitudeDelta: delta,
                      longitudeDelta: delta,
                    }}
                    region={{
                      latitude: center.latitude,
                      longitude: center.longitude,
                      latitudeDelta: delta,
                      longitudeDelta: delta,
                    }}
                  >
                    {customerCoords && (
                      <Marker coordinate={customerCoords} title="Customer" pinColor="#e74c3c" />
                    )}
                    {driverCoords && (
                      <Marker coordinate={driverCoords} title="You" pinColor="#FF8000" />
                    )}
                  </MapView>
                );
              })()}

              <View style={styles.locationCard}>
                <View style={styles.locationIconCircle}>
                  <Text style={styles.locationIcon}>🏠</Text>
                </View>
                <View style={styles.locationInfo}>
                  <Text style={styles.locationTitle}>Customer Location</Text>
                  <Text style={styles.locationAddress}>
                    {mapDelivery?.delivery_address || mapDelivery?.dropoff_address || 'Address not available'}
                  </Text>
                  {getCustomerCoords(mapDelivery) ? (
                    <Text style={styles.locationCoords}>
                      {getCustomerCoords(mapDelivery)!.latitude.toFixed(5)}, {getCustomerCoords(mapDelivery)!.longitude.toFixed(5)}
                    </Text>
                  ) : (
                    <Text style={styles.locationUnavailable}>GPS coordinates not shared</Text>
                  )}
                </View>
              </View>

              {getCustomerCoords(mapDelivery) ? (
                <TouchableOpacity
                  style={styles.openMapBtn}
                  onPress={() => {
                    const coords = getCustomerCoords(mapDelivery)!;
                    openNativeMap(
                      coords.latitude,
                      coords.longitude,
                      mapDelivery?.delivery_address || mapDelivery?.dropoff_address || 'Customer'
                    );
                  }}
                >
                  <Text style={styles.openMapBtnText}>📍 Open Customer Location in Maps</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.noGpsBox}>
                  <Text style={styles.noGpsEmoji}>📍</Text>
                  <Text style={styles.noGpsTitle}>No GPS coordinates available</Text>
                  <Text style={styles.noGpsSub}>Use the delivery address above to navigate.</Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.searchAddressBtn}
                onPress={() => {
                  const address = encodeURIComponent(mapDelivery?.delivery_address || mapDelivery?.dropoff_address || '');
                  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${address}`);
                }}
              >
                <Text style={styles.searchAddressBtnText}>
                  🔍 Search Delivery Address in Google Maps
                </Text>
              </TouchableOpacity>

              <View style={styles.locationCard}>
                <View style={[styles.locationIconCircle, { backgroundColor: '#fff5f5' }]}>
                  <Text style={styles.locationIcon}>🛵</Text>
                </View>
                <View style={styles.locationInfo}>
                  <Text style={styles.locationTitle}>Your Location</Text>
                  {driverLocation ? (
                    <>
                      <Text style={styles.locationCoords}>
                        {driverLocation.lat.toFixed(5)}, {driverLocation.lng.toFixed(5)}
                      </Text>
                      <Text style={styles.locationLive}>🟢 Live — updating every 5 seconds</Text>
                    </>
                  ) : (
                    <Text style={styles.locationUnavailable}>
                      Turn on location sharing to see your position
                    </Text>
                  )}
                </View>
              </View>

              {driverLocation && (
                <TouchableOpacity
                  style={[styles.openMapBtn, { backgroundColor: '#FF8000' }]}
                  onPress={() => openNativeMap(driverLocation.lat, driverLocation.lng, 'My Location')}
                >
                  <Text style={styles.openMapBtnText}>🛵 Open My Location in Maps</Text>
                </TouchableOpacity>
              )}

              <View style={styles.tipBox}>
                <Text style={styles.tipTitle}>💡 Navigation Tip</Text>
                <Text style={styles.tipText}>
                  Tap "Open Customer Location in Maps" to get turn-by-turn directions.
                </Text>
              </View>
              <View style={{ height: 30 }} />
            </ScrollView>
          )}
        </View>
      )}

      {/* ── OTP MODAL ── */}
      <Modal visible={otpModal} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <View style={styles.otpModalBox}>
            <Text style={styles.otpModalTitle}>🔐 Delivery Confirmation</Text>
            <Text style={styles.otpModalSub}>Delivery #{otpDelivery?.id}</Text>

            <View style={styles.otpInputSection}>
              <Text style={styles.otpInputLabel}>
                Ask the customer to tell you their code, then enter it below to confirm delivery:
              </Text>
              <TextInput
                style={styles.otpInput}
                value={enteredOtp}
                onChangeText={(text) => setEnteredOtp(text.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder="Enter 4-digit code"
                placeholderTextColor="#aaa"
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>

            <View style={styles.otpModalActions}>
              <TouchableOpacity
                style={styles.otpCancelBtn}
                onPress={() => { setOtpModal(false); setEnteredOtp(''); }}
              >
                <Text style={styles.otpCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.otpConfirmBtn, otpLoading && { opacity: 0.6 }]}
                onPress={handleVerifyOTP}
                disabled={otpLoading}
              >
                {otpLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.otpConfirmBtnText}>✅ Confirm Delivery</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Toast
        visible={toast.visible}
        message={toast.message}
        actionLabel="View"
        onAction={() => {
          setToast({ visible: false, message: '' });
          setDashTab('active');
        }}
        onHide={() => setToast({ visible: false, message: '' })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#f8fafc' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 14 },

  // Header
  header: {
    backgroundColor: '#fff', paddingTop: 16, paddingBottom: 14,
    paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center' },
  backIconButton: { width: 40, height: 40, backgroundColor: '#fff7ed', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  logoutIconButton: { width: 40, height: 40, backgroundColor: '#fff7ed', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTextWrap: { flex: 1, marginLeft: 12 },
  headerEyebrow: { fontSize: 11, color: '#fb923c', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  headerSub: { fontSize: 13, color: '#64748b', marginTop: 2 },
  locationToggleCard: {
    marginTop: 12, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0'
  },
  locationLabel: { color: '#334155', fontSize: 12, fontWeight: '600', marginHorizontal: 6 },
  liveBanner: { backgroundColor: '#fff7ed', paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#ffedd5' },
  liveBannerText: { color: '#c2410c', fontSize: 13, fontWeight: '600' },

  // Earnings Card
  earningsCard: {
    backgroundColor: '#fff', margin: 16, marginBottom: 0, borderRadius: 18,
    padding: 16, elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6,
    borderWidth: 1, borderColor: '#f1f5f9',
  },
  earningsTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earningsHero: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  earningsIconBadge: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff7ed',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  earningsCardLabel: { fontSize: 12, color: '#64748b', marginBottom: 4 },
  earningsCardAmount: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  pendingText: { fontSize: 11, color: '#fb923c', marginTop: 2 },
  cashoutBtn: {
    backgroundColor: '#FF8000', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, alignItems: 'center', flexDirection: 'row', gap: 6,
  },
  cashoutBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  earningsDivider: { height: 1, backgroundColor: '#f1f5f9', marginVertical: 12 },
  earningsStatsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  earningsStat: { flex: 1, alignItems: 'center' },
  earningsStatDivider: { width: 1, backgroundColor: '#f1f5f9' },
  earningsStatLabel: { fontSize: 11, color: '#94a3b8', marginBottom: 4 },
  earningsStatValue: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  earningsSub: { fontSize: 10, color: '#94a3b8', marginTop: 10, textAlign: 'center', fontStyle: 'italic' },

  // Tabs
  tabRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 12, marginBottom: 6,
    borderRadius: 999, padding: 4, borderWidth: 1, borderColor: '#e2e8f0',
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 999 },
  tabActive: { backgroundColor: '#FF8000' },
  tabText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  // List
  scrollFlex: { flex: 1 },
  list: { padding: 16, paddingBottom: 30 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, borderWidth: 1, borderColor: '#f1f5f9',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  deliveryId: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, maxWidth: 150 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  address: { fontSize: 13, color: '#64748b', marginLeft: 4, flex: 1 },
  orderSnap: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 10, marginBottom: 12 },
  orderSnapRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  snapRowText: { fontSize: 13, color: '#475569', marginLeft: 6, flex: 1 },

  // Earnings in card
  earningsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  earningsPill: {
    backgroundColor: '#f0fff4', borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 8, borderWidth: 1, borderColor: '#b7ebcf',
  },
  earningsPillLabel: { fontSize: 10, color: '#64748b', marginBottom: 2 },
  earningsPillAmount: { fontSize: 16, fontWeight: '700', color: '#15803d' },
  completedDate: { fontSize: 11, color: '#94a3b8' },
  cancelledPill: {
    backgroundColor: '#fef2f2', borderRadius: 8, padding: 8,
    alignItems: 'center', marginBottom: 10,
  },
  cancelledPillText: { fontSize: 12, color: '#dc2626', fontWeight: '600' },

  cardActions: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  detailBtn: { flex: 1, backgroundColor: '#ea580c', paddingVertical: 10, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  detailBtnText: { color: '#fff', fontSize: 13, fontWeight: '600', marginLeft: 6 },
  mapBtn: { flex: 1, backgroundColor: '#FF8000', paddingVertical: 10, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  mapBtnText: { color: '#fff', fontSize: 13, fontWeight: '600', marginLeft: 6 },
  btnLocked: { backgroundColor: '#94a3b8' },
  updateBtn: { backgroundColor: '#FF8000', paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  updateBtnOtp: { backgroundColor: '#ea580c' },
  updateBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  timerContainer: { padding: 8, borderRadius: 10, marginBottom: 10, alignItems: 'center' },
  timerActive: { backgroundColor: '#fff7ed' },
  timerExpired: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  timerText: { fontSize: 12, fontWeight: '700', color: '#c2410c' },
  timerTextExpired: { color: '#dc2626' },
  cardExpired: { opacity: 0.8, borderWidth: 1.5, borderColor: '#ef4444' },
  updateBtnLocked: { backgroundColor: '#94a3b8' },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  emptySub: { fontSize: 14, color: '#64748b', marginTop: 4, textAlign: 'center' },

  // Section separators
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#f8fafc', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 8, marginBottom: 10, borderWidth: 1, borderColor: '#e2e8f0',
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  sectionCount: {
    fontSize: 12, fontWeight: '700', color: '#fff', backgroundColor: '#FF8000',
    borderRadius: 999, minWidth: 24, textAlign: 'center', paddingHorizontal: 8, paddingVertical: 2,
  },
  sectionEmpty: {
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 20,
    alignItems: 'center', marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  sectionEmptyText: { fontSize: 13, color: '#94a3b8' },

  // Profile footer
  driverRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: '#1a1a1a' },
  cardRow: { fontSize: 13, color: '#555', marginBottom: 3 },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 15 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 4 },
  infoLabel: { fontSize: 13, color: '#888', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#333', fontWeight: 'bold' },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '88%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#1a1a1a', flex: 1 },
  modalClose: { fontSize: 20, color: '#888', paddingLeft: 10 },

  // Cashout Modal
  cashoutModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  balanceDisplay: {
    backgroundColor: '#FF8000', borderRadius: 14, padding: 18,
    alignItems: 'center', marginBottom: 20,
  },
  balanceLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
  balanceAmount: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  cashoutSectionLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8 },
  methodRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  methodBtn: {
    flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: '#e0e0e0',
    paddingVertical: 12, alignItems: 'center', backgroundColor: '#fafafa',
  },
  methodBtnActive: { borderColor: '#FF8000', backgroundColor: '#fff8f0' },
  methodEmoji: { fontSize: 22, marginBottom: 4 },
  methodLabel: { fontSize: 12, color: '#888', fontWeight: '600' },
  methodLabelActive: { color: '#FF8000' },
  cashoutInput: {
    borderWidth: 2, borderColor: '#e0e0e0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 24,
    fontWeight: 'bold', color: '#1a1a1a', textAlign: 'center',
    backgroundColor: '#fafafa', marginBottom: 6,
  },
  cashoutHint: { fontSize: 11, color: '#aaa', textAlign: 'center', marginBottom: 14 },
  quickAmountRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  quickAmtBtn: {
    flex: 1, borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0',
    paddingVertical: 8, alignItems: 'center',
  },
  quickAmtBtnActive: { borderColor: '#FF8000', backgroundColor: '#fff8f0' },
  quickAmtText: { fontSize: 13, color: '#888', fontWeight: '600' },
  quickAmtTextActive: { color: '#FF8000' },
  cashoutModalActions: { flexDirection: 'row', gap: 10 },
  cashoutCancelBtn: {
    flex: 1, backgroundColor: '#f0f0f0', paddingVertical: 14,
    borderRadius: 12, alignItems: 'center',
  },
  cashoutCancelText: { color: '#666', fontWeight: '600', fontSize: 15 },
  cashoutConfirmBtn: {
    flex: 2, backgroundColor: '#FF8000', paddingVertical: 14,
    borderRadius: 12, alignItems: 'center',
  },
  cashoutConfirmText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  // Progress stepper
  progressContainer: { marginBottom: 14 },
  progressTitle: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10 },
  progressTrack: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  progressStepWrap: { flex: 1, alignItems: 'center', position: 'relative' },
  progressDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center',
  },
  progressDotDone: { backgroundColor: '#1D9E75' },
  progressDotActive: { backgroundColor: '#FF8000', borderWidth: 2, borderColor: '#fff' },
  progressLabel: { fontSize: 9, color: '#9ca3af', marginTop: 4, textAlign: 'center' },
  progressLabelDone: { color: '#1D9E75', fontWeight: '700' },
  progressLine: {
    position: 'absolute', top: 11, left: '50%', right: '-50%',
    height: 2, backgroundColor: '#e5e7eb',
  },
  progressLineDone: { backgroundColor: '#1D9E75' },

  // Parcel detail grid
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 0 },
  detailGridItem: { width: '50%', paddingVertical: 6, paddingRight: 8 },
  detailGridLabel: { fontSize: 10, color: '#9ca3af', marginBottom: 2 },
  detailGridValue: { fontSize: 13, fontWeight: '700', color: '#111827' },

  // Route in detail
  routeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  routeLabel: { fontSize: 10, color: '#9ca3af', marginBottom: 2 },
  routeAddr: { fontSize: 13, color: '#374151', lineHeight: 18 },

  // Person card (receiver / sender)
  personRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  personAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  personName: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 2 },
  personPhone: { fontSize: 13, color: '#3b82f6', fontWeight: '600' },
  personNotes: { fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 17 },

  // Detail modal
  detailStatusBadge: { borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 16 },
  detailStatusText: { color: '#fff', fontSize: 15, fontWeight: 'bold', textTransform: 'uppercase' },
  detailEarningsBox: {
    backgroundColor: '#f0fff4', borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#b7ebcf',
  },
  detailEarningsLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  detailEarningsAmount: { fontSize: 22, fontWeight: 'bold', color: '#1D9E75' },
  detailSection: { backgroundColor: '#fafafa', borderRadius: 10, padding: 14, marginBottom: 12 },
  detailSectionTitle: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 10 },
  detailRow: { fontSize: 13, color: '#555', marginBottom: 5 },
  foodItemRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  foodItemName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  foodItemQty: { fontSize: 12, color: '#888', marginTop: 2 },
  foodItemPrice: { fontSize: 12, color: '#888' },
  foodItemSubtotal: { fontSize: 13, fontWeight: '700', color: '#e74c3c', marginTop: 2 },
  totalDivider: { height: 1, backgroundColor: '#e0e0e0', marginVertical: 8 },
  grandTotalLabel: { fontSize: 15, fontWeight: 'bold', color: '#1a1a1a' },
  grandTotalValue: { fontSize: 16, fontWeight: 'bold', color: '#FF8000' },
  modalUpdateBtn: { backgroundColor: '#1D9E75', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  modalUpdateBtnOtp: { backgroundColor: '#8e44ad' },
  modalUpdateBtnLocked: { backgroundColor: '#95a5a6' },
  modalUpdateBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  // Map modal — absolutely positioned overlay (not RN <Modal>, see render note)
  mapModalContainer: { ...StyleSheet.absoluteFill, backgroundColor: '#f5f5f5', zIndex: 999, elevation: 999 },
  mapModalHeader: {
    backgroundColor: '#FF8000', paddingTop: 50, paddingBottom: 14,
    paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  mapModalTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', flex: 1 },
  mapModalClose: { color: '#fff', fontSize: 14, fontWeight: '600' },
  mapLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mapContent: { padding: 16 },
  mapPreview: { width: '100%', height: 220, borderRadius: 14, marginBottom: 16 },
  locationCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12,
    flexDirection: 'row', alignItems: 'flex-start', elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3,
  },
  locationIconCircle: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#e8f4fd',
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  locationIcon: { fontSize: 22 },
  locationInfo: { flex: 1 },
  locationTitle: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 4 },
  locationAddress: { fontSize: 13, color: '#555', marginBottom: 4, lineHeight: 18 },
  locationCoords: { fontSize: 12, color: '#888' },
  locationLive: { fontSize: 12, color: '#FF8000', fontWeight: '600', marginTop: 2 },
  locationUnavailable: { fontSize: 12, color: '#FF8000', marginTop: 2 },
  openMapBtn: { backgroundColor: '#3498db', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 10 },
  openMapBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  searchAddressBtn: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center',
    marginBottom: 16, borderWidth: 1.5, borderColor: '#3498db',
  },
  searchAddressBtnText: { color: '#3498db', fontSize: 14, fontWeight: '600' },
  noGpsBox: { backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 12 },
  noGpsEmoji: { fontSize: 36, marginBottom: 8 },
  noGpsTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  noGpsSub: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18 },
  tipBox: {
    backgroundColor: '#fffbe6', borderRadius: 12, padding: 14,
    borderLeftWidth: 4, borderLeftColor: '#f39c12', marginTop: 4,
  },
  tipTitle: { fontSize: 13, fontWeight: 'bold', color: '#b7770d', marginBottom: 6 },
  tipText: { fontSize: 13, color: '#555', lineHeight: 18 },

  // OTP Modal
  otpModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  otpModalTitle: { fontSize: 20, fontWeight: 'bold', color: '#1a1a1a', textAlign: 'center', marginBottom: 4 },
  otpModalSub: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 20 },
  otpInputSection: { marginBottom: 20 },
  otpInputLabel: { fontSize: 13, color: '#555', marginBottom: 10, lineHeight: 18 },
  otpInput: {
    borderWidth: 2, borderColor: '#FF8000', borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 14, fontSize: 28,
    fontWeight: 'bold', color: '#1a1a1a', textAlign: 'center',
    letterSpacing: 8, backgroundColor: '#fafafa',
  },
  otpModalActions: { flexDirection: 'row', gap: 10 },
  otpCancelBtn: { flex: 1, backgroundColor: '#f0f0f0', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  otpCancelBtnText: { color: '#666', fontWeight: '600', fontSize: 15 },
  otpConfirmBtn: { flex: 2, backgroundColor: '#FF8000', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  otpConfirmBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});
