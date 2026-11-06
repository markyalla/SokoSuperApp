import React, { useEffect, useState, useRef } from 'react';
import { Image } from 'react-native';
import {
  View, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, Linking, StatusBar, TextInput
} from 'react-native';
import { Text } from '../../../src/components/Text';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import { mapsAvailable } from '../../../src/config/maps';
import { FullScreenMap, MapPin } from '../../../src/components/FullScreenMap';
import { getOrders, getOrderDetail, getDeliveryLocation, getCustomerOrderOTP, rateOrderDelivery, fileOrderComplaint } from '../../../src/api';
import { friendlyError } from '../../../src/utils/friendlyError';

interface Order {
  id: string | number;
  status: string;
  delivery_address: string;
  created_at: string;
  restaurant?: { name: string };
  store?: { name: string };
  items: { name: string; quantity: number; unit_price: number; special_note?: string; options?: string }[];
  delivery_fee: number;
  total_amount: number;
  delivery_lat?: number;
  delivery_lng?: number;
  delivery?: { id: number };
  estimated_prep_mins?: number;
  accepted_at?: string;
  ready_at?: string;
}

interface DeliveryInfo {
  id: number;
  delivery_status: string;
  driver_name?: string;
  driver_phone?: string;
  driver_id?: string;
  vehicle_name?: string;
  driver_profile_image?: string;
  license_number?: string;
  estimated_time?: string;
  delivery_address?: string;
  vehicle_latitude?: number;
  vehicle_longitude?: number;
  user_latitude?: number;
  user_longitude?: number;
  customer_rating?: number;
};

const STATUS_STEPS = [
  { key: 'pending',             label: 'Order Placed',       emoji: '📝', sub: 'Your order has been received' },
  { key: 'payment_pending',     label: 'Awaiting Payment',   emoji: '💳', sub: 'Waiting for payment confirmation' },
  { key: 'payment_confirmed',   label: 'Payment Confirmed',  emoji: '✅', sub: 'Payment received successfully' },
  { key: 'preparing',           label: 'Preparing',          emoji: '👨‍🍳', sub: 'Restaurant is preparing your order' },
  { key: 'ready_for_pickup',    label: 'Ready for Pickup',   emoji: '🛍️', sub: 'Order is ready, awaiting driver' },
  { key: 'assigned_to_driver',  label: 'Driver Assigned',    emoji: '🛵', sub: 'A driver has been assigned' },
  { key: 'picked_up',           label: 'Picked Up',          emoji: '🥡', sub: 'Driver has collected your order' },
  { key: 'in_transit',          label: 'On the Way',         emoji: '🚗', sub: 'Driver is heading to you' },
  { key: 'delivered',           label: 'Delivered',          emoji: '✅', sub: 'Order delivered successfully' },
];

// Helper to mask sequential IDs
const getDisplayId = (id: number | string) => `FD-${String(id).padStart(6, '0')}`;


///OTP component function

function OTPDisplay({ orderId, orderStatus }: { orderId: string | number; orderStatus: string }) {
  const [otp, setOtp] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const pollRef = useRef<any>(null);

  useEffect(() => {
    const status = orderStatus.toLowerCase();
    if (status === 'in_transit' || status === 'out_for_delivery' || status === 'picked_up') {
      fetchOTP();
      // Poll every 5 seconds waiting for driver to generate OTP
      pollRef.current = setInterval(fetchOTP, 5000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [orderStatus, orderId]);

  const fetchOTP = async () => {
    try {
      const response = await getCustomerOrderOTP(orderId);
      const result = response.data;
      if (result.verified) {
        setVerified(true);
        setOtp(null);
        clearInterval(pollRef.current);
      } else if (result.otp) {
        setOtp(result.otp);
      }
    } catch (error) {
      console.error("Failed to fetch customer OTP:", error);
    }
  };

  if (verified) {
    return (
      <View style={otpStyles.verifiedBox}>
        <Text style={otpStyles.verifiedEmoji}>✅</Text>
        <Text style={otpStyles.verifiedTitle}>Delivery Confirmed!</Text>
        <Text style={otpStyles.verifiedSub}>Your order has been delivered successfully</Text>
      </View>
    );
  }

  if (!otp) {
    const status = orderStatus.toLowerCase();
    if (status !== 'in_transit' && status !== 'out_for_delivery' && status !== 'picked_up') return null;
    return (
      <View style={otpStyles.waitingBox}>
        <ActivityIndicator size="small" color="#FF8000" />
        <Text style={otpStyles.waitingText}>
          Waiting for driver to arrive... Your delivery code will appear here
        </Text>
      </View>
    );
  }

  return (
    <View style={otpStyles.otpBox}>
      <Text style={otpStyles.otpBoxTitle}>🔐 Your Delivery Code</Text>
      <Text style={otpStyles.otpBoxSub}>
        When the driver arrives, tell them this code to confirm your delivery:
      </Text>
      <View style={otpStyles.otpDigitsRow}>
        {otp.split('').map((digit, idx) => (
          <View key={idx} style={otpStyles.otpDigit}>
            <Text style={otpStyles.otpDigitText}>{digit}</Text>
          </View>
        ))}
      </View>
      <Text style={otpStyles.otpWarning}>
        ⚠️ Do not share this code until you receive your order
      </Text>
    </View>
  );
}



function PrepEtaBanner({ status, estimatedPrepMins, acceptedAt }: {
  status: string; estimatedPrepMins?: number; acceptedAt?: string;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (status !== 'preparing') return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [status]);

  if (status !== 'preparing' || !estimatedPrepMins || !acceptedAt) return null;

  const readyByMs = new Date(acceptedAt).getTime() + estimatedPrepMins * 60000;
  const minsLeft = Math.max(0, Math.round((readyByMs - now) / 60000));
  const readyByLabel = new Date(readyByMs).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' });

  return (
    <View style={etaStyles.box}>
      <Text style={etaStyles.emoji}>⏱️</Text>
      <View style={{ flex: 1 }}>
        <Text style={etaStyles.title}>
          {minsLeft > 0 ? `Ready in ~${minsLeft} min` : 'Should be ready any moment'}
        </Text>
        <Text style={etaStyles.sub}>Estimated ready by {readyByLabel}</Text>
      </View>
    </View>
  );
}

// Order statuses that still have something to track, most advanced first —
// used to pick which order to show when this screen is opened without one.
const TRACKABLE_PRIORITY = [
  'in_transit', 'picked_up', 'assigned_to_driver', 'ready_for_pickup',
  'preparing', 'payment_confirmed', 'payment_pending', 'pending',
];

export default function TrackOrderScreen() {
  const router = useRouter();
  const params = useLocalSearchParams() as any;
  const [resolvedId, setResolvedId] = useState<string | null>(params.orderId ? String(params.orderId) : null);
  const [resolving, setResolving] = useState(!params.orderId);

  // Opened from the home screen's "Track order" shortcut there's no orderId —
  // track the user's current order instead of requesting /orders/undefined.
  useEffect(() => {
    if (params.orderId) return;
    (async () => {
      try {
        const res = await getOrders();
        const orders: any[] = Array.isArray(res.data) ? res.data : [];
        const rank = (o: any) => {
          const i = TRACKABLE_PRIORITY.indexOf(String(o.status || '').toLowerCase().replace(/ /g, '_'));
          return i < 0 ? Infinity : i;
        };
        const current = orders
          .filter((o) => rank(o) !== Infinity)
          .sort((a, b) => rank(a) - rank(b)
            || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        if (current) setResolvedId(String(current.order_id ?? current.id));
      } catch {
        // Falls through to the "no active order" state below.
      } finally {
        setResolving(false);
      }
    })();
  }, [params.orderId]);

  if (resolving) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF8000" />
        <Text style={styles.loadingText}>Finding your current order...</Text>
      </View>
    );
  }

  if (!resolvedId) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={{ fontSize: 44 }}>🛍️</Text>
        <Text style={styles.noOrderTitle}>No order to track</Text>
        <Text style={styles.noOrderSub}>You don't have an order in progress right now.</Text>
        <TouchableOpacity style={styles.emptyBtn} onPress={() => router.replace('/shopper/MyOrdersScreen' as any)}>
          <Text style={styles.emptyBtnText}>View my orders</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
          <Text style={styles.emptyLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Without an explicit order the user asked to "track", so open on the map.
  const showMap = params.orderId ? params.showMap === 'true' : true;
  return <TrackOrderView key={resolvedId} orderId={resolvedId} showMap={showMap} />;
}

function TrackOrderView({ orderId, showMap }: { orderId: string; showMap: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullMap, setFullMap] = useState(false);
  const [activeTab, setActiveTab] = useState<'status' | 'details' | 'driver' | 'location'>(
    showMap ? 'location' : 'status'
  );
  const intervalRef = useRef<any>(null);
  const [starChoice, setStarChoice] = useState(0);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingDone, setRatingDone] = useState(false);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [complaintText, setComplaintText] = useState('');
  const [complaintLoading, setComplaintLoading] = useState(false);
  const [complaintSent, setComplaintSent] = useState(false);

  useEffect(() => {
    loadData();
    intervalRef.current = setInterval(loadData, 10000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const loadData = async () => {
    try {
      const response = await getOrderDetail(orderId);
      const orderData = response.data;
      setOrder(orderData);

      // Use delivery info from order first
      if (orderData.delivery) {
        setDelivery(orderData.delivery as DeliveryInfo);
      }

      // GetOrderTracking is keyed by the ORDER's id (not the OrderDelivery's own
      // id) — orderId (the route param) is always the right value here.
      if (orderId) {
  try {
    const locResponse = await getDeliveryLocation(orderId);
    const locationData = locResponse.data as any;
    setDelivery(prev => {
      if (!prev) {
        return {
          id: orderData.delivery?.id,
          delivery_status: locationData.delivery_status || 'pending',
          driver_name: locationData.driver_name,
          driver_phone: locationData.driver_phone,
          driver_id: locationData.driver_id,
          delivery_address: locationData.delivery_address,
          vehicle_latitude: locationData.vehicle_latitude,
          vehicle_longitude: locationData.vehicle_longitude,
          user_latitude: locationData.user_latitude,
          user_longitude: locationData.user_longitude,
        };
      }
      const merged: DeliveryInfo = {
        id: prev.id,
        delivery_status: locationData.delivery_status || prev.delivery_status,
        driver_name: locationData.driver_name ?? prev.driver_name,
        driver_profile_image: locationData.driver_profile_image ?? prev.driver_profile_image,
        driver_phone: locationData.driver_phone ?? prev.driver_phone,
        driver_id: locationData.driver_id ?? prev.driver_id,
        vehicle_name: prev.vehicle_name,
        license_number: prev.license_number,
        estimated_time: prev.estimated_time,
        delivery_address: locationData.delivery_address ?? prev.delivery_address,
        vehicle_latitude: locationData.vehicle_latitude ?? prev.vehicle_latitude,
        vehicle_longitude: locationData.vehicle_longitude ?? prev.vehicle_longitude,
        user_latitude: locationData.user_latitude ?? prev.user_latitude,
        user_longitude: locationData.user_longitude ?? prev.user_longitude,
        customer_rating: locationData.customer_rating ?? prev?.customer_rating,
      };
      return merged;
    });
  } catch {
    // Keep delivery info from order if location fetch fails
  }
}
    } catch (e: any) {
      if (loading) Alert.alert('Error', friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRateOrder = async () => {
    if (starChoice === 0) return;
    setRatingLoading(true);
    try {
      await rateOrderDelivery(String(orderId), starChoice);
      setRatingDone(true);
    } catch {
      Alert.alert('Error', 'Could not submit rating. Please try again.');
    } finally {
      setRatingLoading(false);
    }
  };

  const handleFileComplaint = async () => {
    if (!complaintText.trim()) return;
    setComplaintLoading(true);
    try {
      await fileOrderComplaint(String(orderId), 'general', complaintText.trim());
      setComplaintSent(true);
      setComplaintOpen(false);
      setComplaintText('');
    } catch {
      Alert.alert('Error', 'Could not submit your report. Please try again.');
    } finally {
      setComplaintLoading(false);
    }
  };

  const getCurrentStepIndex = () => {
    const status = order?.status?.toLowerCase() || 'pending';
    const idx = STATUS_STEPS.findIndex(s => s.key === status);
    return idx >= 0 ? idx : 0;
  };

  const customerCoords = (order?.delivery_lat != null && order?.delivery_lng != null)
    ? { latitude: Number(order.delivery_lat), longitude: Number(order.delivery_lng) }
    : null;
  const driverCoords = (delivery?.vehicle_latitude != null && delivery?.vehicle_longitude != null)
    ? { latitude: Number(delivery.vehicle_latitude), longitude: Number(delivery.vehicle_longitude) }
    : null;
  const mapPins: MapPin[] = [
    ...(customerCoords ? [{ key: 'customer', coordinate: customerCoords, title: 'Your delivery location', color: '#FF8000' }] : []),
    ...(driverCoords ? [{ key: 'driver', coordinate: driverCoords, title: delivery?.driver_name || 'Your driver', color: '#1D9E75' }] : []),
  ];

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'pending':             return '#95a5a6';
      case 'payment_pending':     return '#e67e22';
      case 'payment_confirmed':   return '#FF8000';
      case 'preparing':           return '#e67e22';
      case 'ready_for_pickup':    return '#3498db';
      case 'assigned_to_driver':  return '#2980b9';
      case 'picked_up':           return '#d35400';
      case 'in_transit':          return '#9b59b6';
      case 'delivered':           return '#2ecc71';
      case 'cancelled':           return '#e74c3c';
      case 'refunded':            return '#1D9E75';
      default:                    return '#95a5a6';
    }
    
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF8000" />
        <Text style={styles.loadingText}>Loading order info...</Text>
      </View>
    );
  }

  const currentStep = getCurrentStepIndex();

  // When this screen is opened straight into the map (showMap=true, e.g. from
  // a push notification while the app was closed), there's no back history —
  // router.back() is then a no-op and the hardware/gesture back button falls
  // through to closing the app instead of returning to it. Fall back to
  // replacing with home in that case, same as the other screens' back button.
  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>

      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={handleClose} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Order {getDisplayId(orderId)}</Text>
          {order && (
            <View style={[styles.headerBadge, { backgroundColor: getStatusColor(order.status) }]}>
              <Text style={styles.headerBadgeText}>
                {order.status?.replace(/_/g, ' ')}
              </Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={loadData} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {([
          { key: 'status', label: '📊 Status' },
          { key: 'details', label: '📦 Details' },
          { key: 'driver', label: '🛵 Driver' },
          { key: 'location', label: '📍 Location' },
        ] as const).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── STATUS TAB ── */}
        {activeTab === 'status' && (
          <View>
            {delivery?.id && (order?.status?.toLowerCase() === 'in_transit' || 
              order?.status?.toLowerCase() === 'out_for_delivery' || 
              order?.status?.toLowerCase() === 'picked_up') && (
              <View style={{ marginHorizontal: 16, marginTop: 16, marginBottom: -8 }}>
                <OTPDisplay orderId={orderId} orderStatus={order?.status || ''} />
              </View>
            )}
            <View style={{ marginHorizontal: 16, marginTop: 16, marginBottom: -8 }}>
              <PrepEtaBanner
                status={order?.status?.toLowerCase() || ''}
                estimatedPrepMins={order?.estimated_prep_mins}
                acceptedAt={order?.accepted_at}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Order Progress</Text>
              {STATUS_STEPS.map((step, index) => {
                const isCompleted = index <= currentStep;
                const isCurrent = index === currentStep;
                const isCancelled = order?.status?.toLowerCase() === 'cancelled';
                return (
                  <View key={step.key} style={styles.stepRow}>
                    <View style={styles.stepLeft}>
                      <View style={[
                        styles.stepCircle,
                        isCompleted && !isCancelled && styles.stepCircleCompleted,
                        isCurrent && !isCancelled && styles.stepCircleCurrent,
                        isCancelled && isCurrent && styles.stepCircleCancelled,
                      ]}>
                        <Text style={styles.stepEmoji}>
                          {isCancelled && isCurrent ? '❌' : step.emoji}
                        </Text>
                      </View>
                      {index < STATUS_STEPS.length - 1 && (
                        <View style={[
                          styles.stepLine,
                          isCompleted && !isCancelled && styles.stepLineCompleted
                        ]} />
                      )}
                    </View>
                    <View style={styles.stepInfo}>
                      <Text style={[
                        styles.stepLabel,
                        isCurrent && !isCancelled && styles.stepLabelCurrent,
                        !isCompleted && styles.stepLabelInactive,
                      ]}>
                        {step.label}
                      </Text>
                      {isCurrent && (
                        <Text style={styles.stepSub}>{step.sub}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {order?.status?.toLowerCase() === 'cancelled' && (
              <View style={styles.cancelledBox}>
                <Text style={styles.cancelledEmoji}>❌</Text>
                <Text style={styles.cancelledTitle}>Order Cancelled</Text>
                <Text style={styles.cancelledSub}>
                  This order was cancelled. Contact support if you need assistance.
                </Text>
              </View>
            )}

            {order?.status?.toLowerCase() === 'delivered' && (
              <View style={ratingStyles.card}>
                <Text style={ratingStyles.title}>Rate Your Driver</Text>
                {ratingDone || (delivery?.customer_rating ?? 0) > 0 ? (
                  <View style={ratingStyles.doneRow}>
                    <Ionicons name="star" size={18} color="#FF8000" />
                    <Text style={ratingStyles.doneText}>
                      Thank you! You rated {ratingDone ? starChoice : delivery?.customer_rating} star{(ratingDone ? starChoice : (delivery?.customer_rating ?? 0)) === 1 ? '' : 's'}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={ratingStyles.sub}>How was your delivery experience?</Text>
                    <View style={ratingStyles.starsRow}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <TouchableOpacity key={n} onPress={() => setStarChoice(n)} activeOpacity={0.7}>
                          <Ionicons
                            name={n <= starChoice ? 'star' : 'star-outline'}
                            size={38}
                            color="#FF8000"
                          />
                        </TouchableOpacity>
                      ))}
                    </View>
                    {starChoice > 0 && (
                      <TouchableOpacity
                        style={[ratingStyles.btn, ratingLoading && { opacity: 0.6 }]}
                        onPress={handleRateOrder}
                        disabled={ratingLoading}
                        activeOpacity={0.85}
                      >
                        {ratingLoading
                          ? <ActivityIndicator color="#fff" size="small" />
                          : <Text style={ratingStyles.btnText}>Submit Rating</Text>
                        }
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            )}

            {!!delivery?.driver_id && (
              <View style={ratingStyles.card}>
                {complaintSent ? (
                  <View style={ratingStyles.doneRow}>
                    <Ionicons name="checkmark-circle" size={18} color="#FF8000" />
                    <Text style={ratingStyles.doneText}>Thanks — our team will review your report</Text>
                  </View>
                ) : !complaintOpen ? (
                  <TouchableOpacity onPress={() => setComplaintOpen(true)} activeOpacity={0.7}>
                    <Text style={{ color: '#dc2626', fontSize: 14, fontWeight: '600' }}>Report a Problem</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <Text style={ratingStyles.title}>What went wrong?</Text>
                    <TextInput
                      style={complaintStyles.input}
                      placeholder="Describe the issue"
                      value={complaintText}
                      onChangeText={setComplaintText}
                      multiline
                      numberOfLines={4}
                    />
                    <TouchableOpacity
                      style={[ratingStyles.btn, { backgroundColor: '#dc2626' }, complaintLoading && { opacity: 0.6 }]}
                      onPress={handleFileComplaint}
                      disabled={complaintLoading}
                      activeOpacity={0.85}
                    >
                      {complaintLoading
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={ratingStyles.btnText}>File Complaint</Text>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setComplaintOpen(false); setComplaintText(''); }} style={{ marginTop: 10 }}>
                      <Text style={{ color: '#888', fontSize: 13 }}>Cancel</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            <Text style={styles.autoRefresh}>Auto-refreshing every 10 seconds 🔄</Text>
          </View>
        )}

        {/* ── DETAILS TAB ── */}
        {activeTab === 'details' && order && (
          <View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📋 Order Info</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Order ID (Internal)</Text>
                <Text style={styles.infoValue}>{getDisplayId(order.id)}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Restaurant</Text>
                <Text style={styles.infoValue}>{order.store?.name || order.restaurant?.name || 'N/A'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Status</Text>
                <View style={[styles.inlineBadge, { backgroundColor: getStatusColor(order.status) }]}>
                  <Text style={styles.inlineBadgeText}>
                    {order.status?.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Address</Text>
                <Text style={[styles.infoValue, { flex: 1, textAlign: 'right', marginLeft: 8 }]}>
                  {order.delivery_address}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Date</Text>
                <Text style={styles.infoValue}>
                  {order.created_at
                    ? new Date(order.created_at).toLocaleString('en-GH', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })
                    : 'N/A'}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🍱 Items Ordered</Text>
              {order.items?.map((item, idx) => (
                <View key={idx} style={styles.foodRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.foodName}>{item.name}</Text>
                    <Text style={styles.foodQty}>Qty: {item.quantity}</Text>
                    {item.special_note ? (
                      <Text style={styles.foodNote}>Note: {item.special_note}</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.foodUnitPrice}>
                      GHS {item.unit_price?.toFixed(2)} each
                    </Text>
                    <Text style={styles.foodSubtotal}>
                      GHS {(item.unit_price * item.quantity).toFixed(2)}
                    </Text>
                  </View>
                </View>
              ))}
              <View style={styles.totalDivider} />
              <View style={styles.foodRow}>
                <Text style={styles.grandTotalLabel}>Delivery Fee</Text>
                <Text style={styles.grandTotalValue}>GHS {order.delivery_fee?.toFixed(2) || '0.00'}</Text>
              </View>
              <View style={styles.foodRow}>
                <Text style={styles.grandTotalLabel}>Total Paid</Text>
                <Text style={[styles.grandTotalValue, { color: '#e74c3c', fontSize: 17 }]}>
                  GHS {order.total_amount?.toFixed(2)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ── DRIVER TAB ── */}
        {activeTab === 'driver' && (
          <View>
            {delivery?.driver_name ? (
              <View>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>🛵 Your Driver</Text>
                  <View style={styles.driverCard}>
                    {/* Avatar */}
                    {delivery.driver_profile_image ? (
                      <Image
                        source={{ uri: delivery.driver_profile_image }}
                        style={styles.driverAvatarImage}
                        defaultSource={require('../../../assets/default-avatar.png')}
                      />
                    ) : (
                      <View style={styles.driverAvatar}>
                        <Text style={styles.driverAvatarText}>
                          {delivery.driver_name?.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}

                    {/* Info */}
                    <View style={styles.driverInfo}>
                      <Text style={styles.driverName}>{delivery.driver_name}</Text>

                      {delivery.vehicle_name && (
                        <Text style={styles.driverDetail}>🚗 {delivery.vehicle_name}</Text>
                      )}
                      {delivery.license_number && (
                        <Text style={styles.driverDetail}>🪪 {delivery.license_number}</Text>
                      )}
                      {delivery.estimated_time && (
                        <Text style={styles.driverDetail}>⏱️ Est. {delivery.estimated_time}</Text>
                      )}

                      {delivery.driver_phone && (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(`tel:${delivery.driver_phone}`)}
                          style={styles.phoneRow}
                        >
                          <Ionicons name="call-outline" size={14} color="#fff" />
                          <Text style={styles.callBtnText}>
                            Call  {delivery.driver_phone}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {delivery.id && (
                        <OTPDisplay orderId={orderId} orderStatus={order?.status || ''} />
                      )}
                    </View>
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>📍 Delivery Status</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Status</Text>
                    <View style={[styles.inlineBadge, {
                      backgroundColor: getStatusColor(delivery.delivery_status || '')
                    }]}>
                      <Text style={styles.inlineBadgeText}>
                        {(delivery.delivery_status || '').replace(/_/g, ' ')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Address</Text>
                    <Text style={[styles.infoValue, { flex: 1, textAlign: 'right', marginLeft: 8 }]}>
                      {delivery.delivery_address || order?.delivery_address}
                    </Text>
                  </View>
                  {delivery.vehicle_latitude && delivery.vehicle_longitude && (
                    <>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Driver GPS</Text>
                        <Text style={styles.infoValue}>
                          {Number(delivery.vehicle_latitude).toFixed(5)},{' '}
                          {Number(delivery.vehicle_longitude).toFixed(5)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.openMapBtn, { marginTop: 12 }]}
                        onPress={() => setFullMap(true)}
                      >
                        <Text style={styles.openMapBtnText}>
                          🗺️ See Driver on Map
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            ) : (
              <View style={styles.emptySection}>
                <Text style={styles.emptyEmoji}>🛵</Text>
                <Text style={styles.emptyTitle}>No driver assigned yet</Text>
                <Text style={styles.emptySub}>
                  A driver will be assigned once your order is confirmed.
                  Check back soon!
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── LOCATION TAB ── */}
        {activeTab === 'location' && (
          <View>
            {(() => {
              if (mapPins.length === 0) return null;
              // No Google Maps key in this build → skip the native map (it would crash).
              if (!mapsAvailable) return null;

              const center = customerCoords || driverCoords!;
              const delta = customerCoords && driverCoords
                ? Math.max(0.02, Math.abs(customerCoords.latitude - driverCoords.latitude) * 2.5)
                : 0.01;

              return (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setFullMap(true)}
                  style={[styles.section, { padding: 0, overflow: 'hidden' }]}
                >
                  <MapView
                    style={styles.mapPreview}
                    pointerEvents="none"
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    toolbarEnabled={false}
                    initialRegion={{ ...center, latitudeDelta: delta, longitudeDelta: delta }}
                    region={{ ...center, latitudeDelta: delta, longitudeDelta: delta }}
                  >
                    {customerCoords && (
                      <Marker coordinate={customerCoords} title="Your delivery location" pinColor="#FF8000" />
                    )}
                    {driverCoords && (
                      <Marker
                        coordinate={driverCoords}
                        title={delivery?.driver_name || 'Your driver'}
                        pinColor="#1D9E75"
                      />
                    )}
                  </MapView>
                  <View style={styles.expandHint} pointerEvents="none">
                    <Ionicons name="expand" size={14} color="#fff" />
                    <Text style={styles.expandHintText}>Tap to open full map</Text>
                  </View>
                </TouchableOpacity>
              );
            })()}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🏠 Your Delivery Location</Text>
              <Text style={styles.locationAddress}>
                {order?.delivery_address || 'No address provided'}
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>🛵 Driver Live Location</Text>
              {delivery?.vehicle_latitude && delivery?.vehicle_longitude ? (
                <View>
                  <View style={styles.liveLocationCard}>
                    <View style={styles.liveDot} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.liveLocationTitle}>
                        {delivery.driver_name
                          ? `${delivery.driver_name} is live`
                          : 'Driver is live'}
                      </Text>
                      <Text style={styles.liveLocationCoords}>
                        {Number(delivery.vehicle_latitude).toFixed(5)},{' '}
                        {Number(delivery.vehicle_longitude).toFixed(5)}
                      </Text>
                      {delivery.vehicle_name && (
                        <Text style={styles.liveLocationCoords}>
                          🚗 {delivery.vehicle_name}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.noLocationBox}>
                  <Text style={styles.noLocationEmoji}>📍</Text>
                  <Text style={styles.noLocationTitle}>
                    Driver location not available yet
                  </Text>
                  <Text style={styles.noLocationSub}>
                    {delivery?.driver_name
                      ? `${delivery.driver_name} has been assigned but hasn't started sharing location yet.`
                      : 'Location will appear once the driver starts heading to you.'}
                    {'\n\n'}Screen refreshes every 10 seconds automatically.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.tipBox}>
              <Text style={styles.tipTitle}>💡 Tip</Text>
              <Text style={styles.tipText}>
                Tap the map to open it full screen and follow your driver live.
              </Text>
            </View>

            <Text style={styles.autoRefresh}>Auto-refreshing every 10 seconds 🔄</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {fullMap && (
        <FullScreenMap
          pins={mapPins}
          onClose={() => setFullMap(false)}
          emptyText="Driver location not available yet."
        />
      )}
    </SafeAreaView>
  );
}

const etaStyles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff4e5', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#ffd8a8',
  },
  emoji: { fontSize: 22 },
  title: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  sub: { fontSize: 12, color: '#888', marginTop: 2 },
});

const otpStyles = StyleSheet.create({
  waitingBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff8e1', borderRadius: 10, padding: 14,
    marginTop: 12, borderWidth: 1, borderColor: '#ffe082',
  },
  waitingText: { flex: 1, fontSize: 13, color: '#666', lineHeight: 18 },
  otpBox: {
    backgroundColor: '#f0fff4', borderRadius: 16, padding: 20,
    marginTop: 12, alignItems: 'center',
    borderWidth: 2, borderColor: '#1D9E75',
  },
  otpBoxTitle: {
    fontSize: 16, fontWeight: 'bold', color: '#1D9E75', marginBottom: 6,
  },
  otpBoxSub: {
    fontSize: 12, color: '#666', textAlign: 'center',
    marginBottom: 16, lineHeight: 17,
  },
  otpDigitsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  otpDigit: {
    width: 56, height: 64, borderRadius: 12, backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
    elevation: 3, shadowColor: '#e74c3c',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4,
    borderWidth: 2, borderColor: '#e74c3c',
  },
  otpDigitText: { fontSize: 28, fontWeight: 'bold', color: '#e74c3c' },
  otpWarning: {
    fontSize: 11, color: '#e74c3c', textAlign: 'center', fontWeight: '600',
  },
  verifiedBox: {
    backgroundColor: '#f0fff4', borderRadius: 12, padding: 20,
    marginTop: 12, alignItems: 'center', borderWidth: 1.5, borderColor: '#2ecc71',
  },
  verifiedEmoji: { fontSize: 36, marginBottom: 8 },
  verifiedTitle: { fontSize: 16, fontWeight: 'bold', color: '#2ecc71', marginBottom: 4 },
  verifiedSub: { fontSize: 13, color: '#666', textAlign: 'center' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, color: '#888', fontSize: 14 },
  noOrderTitle: { marginTop: 12, fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  noOrderSub: { marginTop: 6, fontSize: 14, color: '#888', textAlign: 'center', paddingHorizontal: 32 },
  emptyBtn: { marginTop: 20, backgroundColor: '#FF8000', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyLink: { marginTop: 14, color: '#888', fontSize: 14, textDecorationLine: 'underline' },
  header: {
    backgroundColor: '#FF8000', paddingBottom: 14,
    paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { padding: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  backBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginTop: 4,
  },
  headerBadgeText: {
    color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize',
  },
  refreshBtn: { padding: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  refreshText: { fontSize: 20 },
  tabs: {
    flexDirection: 'row', backgroundColor: '#fff',
    elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2,
  },
  tab: {
    flex: 1, paddingVertical: 11, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  driverAvatarImage: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: '#2a2a2a',
  },
  tabActive: { borderBottomColor: '#FF8000' },
  tabText: { fontSize: 11, color: '#888', fontWeight: '500' },
  tabTextActive: { color: '#FF8000', fontWeight: '700' },
  content: { flex: 1 },
  section: {
    backgroundColor: '#fff', margin: 16, marginBottom: 0,
    borderRadius: 14, padding: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 3,
  },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 16 },
  mapPreview: { width: '100%', height: 220 },
  expandHint: {
    position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
  },
  expandHintText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  stepRow: { flexDirection: 'row', marginBottom: 0 },
  stepLeft: { alignItems: 'center', marginRight: 14 },
  stepCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center',
  },
  stepCircleCompleted: { backgroundColor: '#e8f8f0' },
  stepCircleCurrent: { backgroundColor: '#fde8e8', borderWidth: 2, borderColor: '#e74c3c' },
  stepCircleCancelled: { backgroundColor: '#fde8e8' },
  stepEmoji: { fontSize: 18 },
  stepLine: { width: 2, height: 28, backgroundColor: '#f0f0f0', marginVertical: 2 },
  stepLineCompleted: { backgroundColor: '#FF8000' },
  stepInfo: { flex: 1, justifyContent: 'center', paddingBottom: 28 },
  stepLabel: { fontSize: 14, color: '#333', fontWeight: '600' },
  stepLabelCurrent: { color: '#FF8000', fontWeight: '700' },
  stepLabelInactive: { color: '#aaa', fontWeight: '400' },
  stepSub: { fontSize: 12, color: '#888', marginTop: 2 },
  cancelledBox: {
    backgroundColor: '#fff', margin: 16, marginTop: 12, borderRadius: 14,
    padding: 20, alignItems: 'center', borderWidth: 1.5, borderColor: '#fde8e8',
  },
  cancelledEmoji: { fontSize: 36, marginBottom: 8 },
  cancelledTitle: { fontSize: 16, fontWeight: 'bold', color: '#e63723', marginBottom: 6 },
  cancelledSub: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18 },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  infoLabel: { fontSize: 13, color: '#888' },
  infoValue: { fontSize: 13, color: '#333', fontWeight: '500' },
  inlineBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  inlineBadgeText: {
    color: '#fff', fontSize: 11, fontWeight: '600', textTransform: 'capitalize',
  },
  foodRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f5f5f5',
  },
  foodName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  foodQty: { fontSize: 12, color: '#888', marginTop: 2 },
  foodNote: { fontSize: 11, color: '#999', fontStyle: 'italic', marginTop: 2 },
  foodUnitPrice: { fontSize: 12, color: '#888' },
  foodSubtotal: { fontSize: 13, fontWeight: '700', color: '#FF8000', marginTop: 2 },
  totalDivider: { height: 1, backgroundColor: '#e0e0e0', marginVertical: 8 },
  grandTotalLabel: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a' },
  grandTotalValue: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  driverCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a1a', borderRadius: 16,
    padding: 14, gap: 14,
  },
  driverAvatar: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#FF8000',
    justifyContent: 'center', alignItems: 'center',
  },
  driverAvatarText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  driverDetail: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 3 },
  locationAddress: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 12 },
  liveLocationCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f0fff4', borderRadius: 10, padding: 12, marginBottom: 12,
  },
  liveDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FF8000' },
  liveLocationTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a' },
  liveLocationCoords: { fontSize: 12, color: '#888', marginTop: 2 },
  noLocationBox: { alignItems: 'center', paddingVertical: 20 },
  noLocationEmoji: { fontSize: 36, marginBottom: 8 },
  noLocationTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  noLocationSub: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18 },
  openMapBtn: {
    backgroundColor: '#ea580c', borderRadius: 10, padding: 13, alignItems: 'center',
  },
  openMapBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  tipBox: {
    backgroundColor: '#fffbe6', margin: 16, marginTop: 12, borderRadius: 12,
    padding: 14, borderLeftWidth: 4, borderLeftColor: '#FF8000',
  },
  tipTitle: { fontSize: 13, fontWeight: 'bold', color: '#FF8000', marginBottom: 4 },
  tipText: { fontSize: 13, color: '#555', lineHeight: 18 },
  emptySection: {
    backgroundColor: '#fff', margin: 16, borderRadius: 14,
    padding: 30, alignItems: 'center',
  },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  emptySub: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18 },
  autoRefresh: {
    textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 16, marginBottom: 4,
  },
  phoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FF8000', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 8, alignSelf: 'flex-start',
  },
driverPhone: { fontSize: 13, color: '#fff', fontWeight: '600' },
callBtn: {
  backgroundColor: '#FF8000', paddingHorizontal: 12,
  paddingVertical: 5, borderRadius: 15,
},
callBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

const ratingStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', margin: 16, marginTop: 12,
    borderRadius: 14, padding: 20, alignItems: 'center',
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.06,
    shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  title: { fontSize: 16, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  sub:   { fontSize: 13, color: '#888', marginBottom: 16 },
  starsRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  btn: {
    backgroundColor: '#FF8000', borderRadius: 12,
    paddingVertical: 13, paddingHorizontal: 36,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  doneText: { fontSize: 14, color: '#FF8000', fontWeight: '600' },
});

const complaintStyles = StyleSheet.create({
  input: {
    width: '100%', minHeight: 90, borderWidth: 1, borderColor: '#e5e5e5',
    borderRadius: 10, padding: 12, fontSize: 14, color: '#1a1a1a',
    textAlignVertical: 'top', marginTop: 10, marginBottom: 14,
  },
});