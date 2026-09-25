import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Linking, Modal, RefreshControl, ScrollView, StatusBar, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Text } from '../../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview'; // ✅ added
import { deliveryApi } from '../../../src/api/delivery';
import { useAuthStore } from '../../../src/store/authStore';
import { DeliveryOrderItem, describeTripScope } from '../../../src/types/delivery';
import { rateParcelDelivery, getCustomerOTP, fileParcelComplaint } from '../../../src/api';
import { wsService } from '../../../src/services/websocket';

const OTP_ACTIVE_STATUSES = ['picked_up', 'in_transit', 'arrived_at_customer'];

function ParcelOTPDisplay({ deliveryId, status }: { deliveryId: string; status: string }) {
  const [otp, setOtp] = useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const active = OTP_ACTIVE_STATUSES.includes(status.toLowerCase());

  useEffect(() => {
    if (!active) {
      setOtp(null);
      return;
    }
    const fetchOtp = async () => {
      try {
        const res = await getCustomerOTP(deliveryId);
        if (res.data?.otp) setOtp(res.data.otp);
      } catch {
        // silent — keep showing the waiting state and retry on next poll
      }
    };
    fetchOtp();
    pollRef.current = setInterval(fetchOtp, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [deliveryId, active]);

  if (!active) return null;

  if (!otp) {
    return (
      <View style={otpStyles.waitingBox}>
        <ActivityIndicator size="small" color="#FF8000" />
        <Text style={otpStyles.waitingText}>
          Waiting for the driver to generate your delivery code...
        </Text>
      </View>
    );
  }

  return (
    <View style={otpStyles.otpBox}>
      <Text style={otpStyles.otpBoxTitle}>🔐 Your Delivery Code</Text>
      <Text style={otpStyles.otpBoxSub}>
        Give this code to the driver to confirm you received your parcel:
      </Text>
      <View style={otpStyles.otpDigitsRow}>
        {otp.split('').map((digit, idx) => (
          <View key={idx} style={otpStyles.otpDigit}>
            <Text style={otpStyles.otpDigitText}>{digit}</Text>
          </View>
        ))}
      </View>
      <Text style={otpStyles.otpWarning}>
        ⚠️ Do not share this code until you receive your parcel
      </Text>
    </View>
  );
}

type TabKey = 'sent' | 'to_pay';

const STATUS_COLORS: Record<string, string> = {
  pending:            '#f59e0b',
  broadcast:          '#6366f1',
  accepted:           '#1D9E75',
  arrived_at_vendor:  '#0ea5e9',
  picked_up:          '#FF8000',
  in_transit:         '#FF8000',
  arrived_at_customer:'#16a34a',
  delivered:          '#1D9E75',
  failed:             '#ef4444',
  cancelled:          '#6b7280',
};

function statusColor(s: string) { return STATUS_COLORS[s] ?? '#6b7280'; }

function PaymentBadge({ status }: { status: string }) {
  const paid = status === 'success';
  return (
    <View style={[styles.payBadge, { backgroundColor: paid ? '#ecfdf5' : '#fff7ed' }]}>
      <Ionicons name={paid ? 'checkmark-circle-outline' : 'time-outline'} size={11} color={paid ? '#1D9E75' : '#FF8000'} />
      <Text style={[styles.payBadgeText, { color: paid ? '#1D9E75' : '#FF8000' }]}>{paid ? 'Paid' : 'Unpaid'}</Text>
    </View>
  );
}

export default function DeliveryTrackScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAuthStore();

  const [tab, setTab] = useState<TabKey>('sent');
  const [sentList, setSentList]   = useState<DeliveryOrderItem[]>([]);
  const [toPayList, setToPayList] = useState<DeliveryOrderItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected]           = useState<DeliveryOrderItem | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [paying, setPaying]               = useState(false);
  const [starChoice, setStarChoice]       = useState(0);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [complaintOpen, setComplaintOpen]       = useState(false);
  const [complaintText, setComplaintText]       = useState('');
  const [complaintLoading, setComplaintLoading] = useState(false);
  const [complaintSent, setComplaintSent]       = useState(false);

  // ✅ Paystack WebView state
  const [paystackUrl, setPaystackUrl]         = useState('');
  const [paystackRef, setPaystackRef]         = useState('');
  const [paystackVisible, setPaystackVisible] = useState(false);
  const [paystackLoading, setPaystackLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!tokens?.access) return;
    try {
      const [sent, toPay] = await Promise.all([
        deliveryApi.listUserDeliveries(tokens.access),
        deliveryApi.listReceiverDeliveries(tokens.access),
      ]);
      setSentList(sent ?? []);
      setToPayList(toPay ?? []);
    } catch {
      // silent on background refresh
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tokens?.access]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 15_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Instant refresh when the backend pushes a delivery_status event
  useEffect(() => {
    return wsService.addHandler((event) => {
      if (event.type === 'delivery_status') fetchAll();
    });
  }, [fetchAll]);

  const openDetail = async (id: string) => {
    setStarChoice(0);
    setComplaintOpen(false);
    setComplaintText('');
    setComplaintSent(false);
    setDetailLoading(true);
    setDetailVisible(true);
    try {
      const detail = await deliveryApi.getDeliveryDetail(tokens?.access ?? '', id);
      setSelected(detail);
    } catch {
      Alert.alert('Error', 'Could not load delivery details.');
      setDetailVisible(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRateDelivery = async () => {
    if (!selected || !tokens?.access || starChoice === 0) return;
    setRatingLoading(true);
    try {
      await rateParcelDelivery(selected.id, starChoice);
      setSelected(prev => prev ? { ...prev, customer_rating: starChoice } : prev);
      setStarChoice(0);
    } catch {
      Alert.alert('Error', 'Could not submit rating. Try again.');
    } finally {
      setRatingLoading(false);
    }
  };

  const handleFileParcelComplaint = async () => {
    if (!selected || !complaintText.trim()) return;
    setComplaintLoading(true);
    try {
      await fileParcelComplaint(selected.id, 'general', complaintText.trim());
      setComplaintSent(true);
      setComplaintOpen(false);
      setComplaintText('');
    } catch {
      Alert.alert('Error', 'Could not submit your report. Try again.');
    } finally {
      setComplaintLoading(false);
    }
  };

  // ✅ handlePay now opens WebView instead of browser
  const handlePay = async (delivery: DeliveryOrderItem) => {
    if (!tokens?.access) return;
    try {
      setPaying(true);
      const res = await deliveryApi.initiatePayment(tokens.access, delivery.id);
      setPaystackUrl(res.checkout_url);
      setPaystackRef(res.reference);
      setDetailVisible(false);      // close detail sheet first
      setPaystackLoading(true);
      setPaystackVisible(true);     // open WebView modal
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Payment initialisation failed.';
      Alert.alert('Payment Error', msg);
    } finally {
      setPaying(false);
    }
  };

  // Verify payment with backend then show outcome to user
  const confirmPayment = async () => {
    setPaystackVisible(false);
    if (!tokens?.access || !paystackRef) return;
    try {
      const { payment_status } = await deliveryApi.verifyPayment(tokens.access, paystackRef);
      if (payment_status === 'success') {
        Alert.alert(
          'Payment Successful 🎉',
          'Your delivery payment has been confirmed.',
          [{ text: 'OK', onPress: fetchAll }],
        );
      } else {
        // Payment not confirmed yet (user may have cancelled); just refresh silently
        fetchAll();
      }
    } catch {
      fetchAll();
    }
  };

  // Watch URL changes inside WebView — fire verify when Paystack closes or redirects back
  const handleWebViewNav = (navState: { url: string }) => {
    const url = navState.url;
    if (
      url.includes('paystack.com/close') ||
      url.includes('trxref=') ||
      url.includes('payment_status=success')
    ) {
      confirmPayment();
    }
  };

  const activeList = tab === 'sent' ? sentList : toPayList;

  const renderCard = ({ item }: { item: DeliveryOrderItem }) => (
    <TouchableOpacity style={styles.card} onPress={() => openDetail(item.id)} activeOpacity={0.85}>
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Ionicons name="cube-outline" size={20} color="#FF8000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardId}>#{item.id.slice(0, 8).toUpperCase()}</Text>
          <Text style={styles.cardDesc} numberOfLines={1}>{item.description}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(item.status) + '22' }]}>
          <Text style={[styles.statusText, { color: statusColor(item.status) }]}>
            {item.status.replace(/_/g, ' ')}
          </Text>
        </View>
      </View>

      <View style={styles.cardRoute}>
        <Ionicons name="radio-button-on-outline" size={13} color="#1D9E75" />
        <Text style={styles.cardRouteText} numberOfLines={1}>{item.pickup_address}</Text>
      </View>
      <View style={styles.cardRoute}>
        <Ionicons name="location-outline" size={13} color="#FF8000" />
        <Text style={styles.cardRouteText} numberOfLines={1}>{item.dropoff_address}</Text>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.cardAmount}>GH₵ {item.total_amount?.toFixed(2)}</Text>
        <Text style={styles.cardVehicle}>{item.vehicle_type}</Text>
        <PaymentBadge status={item.payment_status} />
      </View>

      {tab === 'to_pay' && item.payment_status !== 'success' && (
        <TouchableOpacity
          style={styles.inlinePayBtn}
          onPress={() => handlePay(item)}
          disabled={paying}
        >
          <Ionicons name="card-outline" size={14} color="#fff" />
          <Text style={styles.inlinePayBtnText}>Pay GH₵ {item.total_amount?.toFixed(2)}</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Deliveries</Text>
        <TouchableOpacity onPress={() => router.push('/delivery')} style={styles.newBtn}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'sent' && styles.tabActive]} onPress={() => setTab('sent')}>
          <Text style={[styles.tabText, tab === 'sent' && styles.tabTextActive]}>Sent</Text>
          {sentList.length > 0 && <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{sentList.length}</Text></View>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'to_pay' && styles.tabActive]} onPress={() => setTab('to_pay')}>
          <Text style={[styles.tabText, tab === 'to_pay' && styles.tabTextActive]}>To Pay</Text>
          {toPayList.length > 0 && (
            <View style={[styles.tabBadge, { backgroundColor: '#FF8000' }]}>
              <Text style={styles.tabBadgeText}>{toPayList.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#FF8000" /></View>
      ) : (
        <FlatList
          data={activeList}
          keyExtractor={(i) => i.id}
          contentContainerStyle={activeList.length === 0 ? styles.emptyContainer : styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll(); }} tintColor="#FF8000" />
          }
          renderItem={renderCard}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="bicycle-outline" size={60} color="#e5e7eb" />
              <Text style={styles.emptyTitle}>{tab === 'sent' ? 'No deliveries yet' : 'No pending payments'}</Text>
              <Text style={styles.emptyText}>{tab === 'sent' ? 'Book a delivery to get started.' : 'Packages assigned to you for payment will appear here.'}</Text>
              {tab === 'sent' && (
                <TouchableOpacity style={styles.bookBtn} onPress={() => router.push('/delivery')}>
                  <Text style={styles.bookBtnText}>Book a Delivery</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* Detail Modal — unchanged */}
      <Modal visible={detailVisible} animationType="slide" transparent onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Delivery Details</Text>
              <TouchableOpacity onPress={() => setDetailVisible(false)}>
                <Ionicons name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>

            {detailLoading ? (
              <ActivityIndicator size="large" color="#FF8000" style={{ marginVertical: 40 }} />
            ) : selected && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.detailGrid}>
                  {[
                    { label: 'Status',   value: selected.status.replace(/_/g, ' ').toUpperCase(), color: statusColor(selected.status) },
                    { label: 'Payment',  value: selected.payment_status === 'success' ? 'Paid ✓' : 'Unpaid', color: selected.payment_status === 'success' ? '#1D9E75' : '#FF8000' },
                    { label: 'Vehicle',  value: (selected.vehicle_type ?? 'N/A').charAt(0).toUpperCase() + (selected.vehicle_type ?? '').slice(1), color: '#374151' },
                    { label: 'Distance', value: selected.distance_km ? `${selected.distance_km.toFixed(1)} km` : '—', color: '#374151' },
                    { label: 'Cost',     value: `GH₵ ${selected.total_amount?.toFixed(2)}`, color: '#FF8000' },
                    { label: 'Pays',     value: selected.payer_type === 'receiver' ? 'Receiver' : 'Sender', color: '#6366f1' },
                  ].map(({ label, value, color }) => (
                    <View key={label} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{label}</Text>
                      <Text style={[styles.detailValue, { color }]}>{value}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>Route</Text>
                <View style={styles.routeRow}>
                  <Ionicons name="radio-button-on-outline" size={14} color="#1D9E75" />
                  <Text style={styles.routeText}>{selected.pickup_address}</Text>
                </View>
                <View style={[styles.routeRow, { marginTop: 6 }]}>
                  <Ionicons name="location-outline" size={14} color="#FF8000" />
                  <Text style={styles.routeText}>{selected.dropoff_address}</Text>
                </View>
                {(() => {
                  const scopeMsg = describeTripScope(
                    selected.trip_scope,
                    selected.pickup_town, selected.pickup_region,
                    selected.dropoff_town, selected.dropoff_region,
                  );
                  return scopeMsg ? (
                    <View style={styles.tripScopeBox}>
                      <Text style={styles.tripScopeText}>{scopeMsg}</Text>
                    </View>
                  ) : null;
                })()}

                <View style={styles.divider} />
                <Text style={styles.sectionTitle}>Parcel</Text>
                <Text style={styles.descText}>{selected.description}</Text>

                {selected.rider_name && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.sectionTitle}>Driver</Text>
                    <View style={styles.driverCard}>
                      {selected.rider_profile_image ? (
                        <Image
                          source={{ uri: selected.rider_profile_image }}
                          style={styles.driverAvatarImage}
                          defaultSource={require('../../../assets/default-avatar.png')}
                        />
                      ) : (
                        <View style={styles.driverAvatar}>
                          <Text style={styles.driverAvatarText}>
                            {selected.rider_name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.driverInfo}>
                        <Text style={styles.driverName}>{selected.rider_name}</Text>
                        {selected.rider_phone && (
                          <TouchableOpacity
                            style={styles.phoneRow}
                            onPress={() => Linking.openURL(`tel:${selected.rider_phone}`)}
                          >
                            <Ionicons name="call-outline" size={13} color="#FF8000" />
                            <Text style={styles.phoneText}>{selected.rider_phone}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    <View style={styles.divider} />
                    {complaintSent ? (
                      <View style={styles.ratingDoneBox}>
                        <Ionicons name="checkmark-circle" size={16} color="#FF8000" />
                        <Text style={styles.ratingDoneText}>Thanks — our team will review your report</Text>
                      </View>
                    ) : !complaintOpen ? (
                      <TouchableOpacity onPress={() => setComplaintOpen(true)} activeOpacity={0.7}>
                        <Text style={styles.reportLink}>Report a Problem</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.ratingBox}>
                        <TextInput
                          style={styles.complaintInput}
                          placeholder="Describe the issue"
                          value={complaintText}
                          onChangeText={setComplaintText}
                          multiline
                          numberOfLines={4}
                        />
                        <TouchableOpacity
                          style={[styles.rateBtn, { backgroundColor: '#dc2626' }, complaintLoading && { opacity: 0.6 }]}
                          onPress={handleFileParcelComplaint}
                          disabled={complaintLoading}
                          activeOpacity={0.85}
                        >
                          {complaintLoading
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={styles.rateBtnText}>File Complaint</Text>
                          }
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setComplaintOpen(false); setComplaintText(''); }} style={{ marginTop: 10 }}>
                          <Text style={{ color: '#888', fontSize: 13 }}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                )}

                {OTP_ACTIVE_STATUSES.includes(selected.status.toLowerCase()) && (
                  <>
                    <View style={styles.divider} />
                    <ParcelOTPDisplay deliveryId={selected.id} status={selected.status} />
                  </>
                )}

                {selected.status === 'delivered' && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.sectionTitle}>Rate Your Driver</Text>
                    {(selected.customer_rating ?? 0) > 0 ? (
                      <View style={styles.ratingDoneBox}>
                        <Ionicons name="star" size={16} color="#FF8000" />
                        <Text style={styles.ratingDoneText}>
                          You rated this driver {selected.customer_rating} star{selected.customer_rating === 1 ? '' : 's'}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.ratingBox}>
                        <View style={styles.starsRow}>
                          {[1, 2, 3, 4, 5].map(n => (
                            <TouchableOpacity key={n} onPress={() => setStarChoice(n)} activeOpacity={0.7}>
                              <Ionicons
                                name={n <= starChoice ? 'star' : 'star-outline'}
                                size={34}
                                color="#FF8000"
                              />
                            </TouchableOpacity>
                          ))}
                        </View>
                        {starChoice > 0 && (
                          <TouchableOpacity
                            style={[styles.rateBtn, ratingLoading && { opacity: 0.6 }]}
                            onPress={handleRateDelivery}
                            disabled={ratingLoading}
                            activeOpacity={0.85}
                          >
                            {ratingLoading
                              ? <ActivityIndicator color="#fff" size="small" />
                              : <Text style={styles.rateBtnText}>Submit Rating</Text>
                            }
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </>
                )}

                {selected.payment_status !== 'success' && (
                  <TouchableOpacity
                    style={[styles.payBtn, paying && { opacity: 0.7 }]}
                    onPress={() => handlePay(selected)}
                    disabled={paying}
                  >
                    {paying
                      ? <ActivityIndicator color="#fff" />
                      : <>
                          <Ionicons name="card-outline" size={18} color="#fff" />
                          <Text style={styles.payBtnText}>Pay GH₵ {selected.total_amount?.toFixed(2)}</Text>
                        </>
                    }
                  </TouchableOpacity>
                )}
                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ✅ Paystack WebView Modal */}
      <Modal
        visible={paystackVisible}
        animationType="slide"
        onRequestClose={confirmPayment}
      >
        <SafeAreaView style={styles.safe}>
          {/* WebView header */}
          <View style={styles.webHeader}>
            <TouchableOpacity onPress={confirmPayment} style={styles.backBtn}>
              <Ionicons name="close" size={22} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.webHeaderTitle}>Complete Payment</Text>
            <View style={{ width: 30 }} />
          </View>

          {/* Loading overlay while page loads */}
          {paystackLoading && (
            <View style={styles.webLoading}>
              <ActivityIndicator size="large" color="#FF8000" />
              <Text style={styles.webLoadingText}>Loading payment page...</Text>
            </View>
          )}

          <WebView
            source={{ uri: paystackUrl }}
            onLoadEnd={() => setPaystackLoading(false)}
            onNavigationStateChange={handleWebViewNav}
            style={{ flex: 1 }}
            javaScriptEnabled
            domStorageEnabled
          />

          {/* Manual confirmation button — shown after WebView loads */}
          {!paystackLoading && (
            <TouchableOpacity
              style={styles.donePayBtn}
              onPress={confirmPayment}
            >
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={styles.donePayBtnText}>I've Completed Payment</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Modal>

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
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700', marginLeft: 12 },
  newBtn: { padding: 4 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#FF8000' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#9ca3af' },
  tabTextActive: { color: '#FF8000' },
  tabBadge: { backgroundColor: '#1D9E75', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16 },
  emptyContainer: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginTop: 8 },
  emptyText: { fontSize: 13, color: '#6b7280', textAlign: 'center', paddingHorizontal: 40 },
  bookBtn: { marginTop: 16, backgroundColor: '#FF8000', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  bookBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14,
    marginBottom: 12, elevation: 2,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  cardId: { fontSize: 11, color: '#9ca3af', fontWeight: '600' },
  cardDesc: { fontSize: 14, fontWeight: '700', color: '#111827', marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  cardRoute: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardRouteText: { flex: 1, fontSize: 12, color: '#6b7280' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  cardAmount: { fontSize: 14, fontWeight: '700', color: '#111827' },
  cardVehicle: { fontSize: 11, color: '#9ca3af', textTransform: 'capitalize', flex: 1 },
  payBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  payBadgeText: { fontSize: 10, fontWeight: '700' },
  inlinePayBtn: {
    marginTop: 10, backgroundColor: '#FF8000', borderRadius: 10,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  inlinePayBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  detailItem: { width: '50%', paddingVertical: 8, paddingHorizontal: 4 },
  detailLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  routeText: { flex: 1, fontSize: 13, color: '#374151' },
  tripScopeBox: {
    backgroundColor: '#fff7ed', borderRadius: 10, padding: 10, marginTop: 10,
  },
  tripScopeText: { fontSize: 12, color: '#9a5b00', fontWeight: '600' },
  descText: { fontSize: 13, color: '#374151', lineHeight: 19 },
  payBtn: {
    marginTop: 20, backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  payBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // ✅ WebView modal styles
  webHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    backgroundColor: '#fff',
  },
  donePayBtn: {
  backgroundColor: '#FF8000',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  paddingVertical: 16,
  marginHorizontal: 16,
  marginBottom: 12,
  borderRadius: 14,
},
donePayBtnText: {
  color: '#fff',
  fontSize: 16,
  fontWeight: '700',
},
  webHeaderTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#111827' },
  webLoading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    gap: 12,
  },
  webLoadingText: { fontSize: 14, color: '#6b7280' },
  ratingBox: { alignItems: 'center', paddingVertical: 8 },
  starsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  rateBtn: {
    backgroundColor: '#FF8000', borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 32, alignItems: 'center',
  },
  rateBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  ratingDoneBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff7ed', borderRadius: 10, padding: 12,
  },
  ratingDoneText: { fontSize: 13, color: '#FF8000', fontWeight: '600' },
  reportLink: { color: '#dc2626', fontSize: 14, fontWeight: '600' },
  complaintInput: {
    width: '100%', minHeight: 90, borderWidth: 1, borderColor: '#e5e5e5',
    borderRadius: 10, padding: 12, fontSize: 14, color: '#1a1a1a',
    textAlignVertical: 'top', marginBottom: 14,
  },
  driverCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff7ed',
    alignItems: 'center', justifyContent: 'center',
  },
  driverAvatarText: { fontSize: 18, fontWeight: '700', color: '#FF8000' },
  driverAvatarImage: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f3f4f6' },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 4 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  phoneText: { fontSize: 13, color: '#FF8000', fontWeight: '600' },
});

const otpStyles = StyleSheet.create({
  waitingBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f9fafb', borderRadius: 12, padding: 14,
  },
  waitingText: { flex: 1, fontSize: 12, color: '#6b7280' },
  otpBox: {
    backgroundColor: '#fff7ed', borderRadius: 14, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#fed7aa',
  },
  otpBoxTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  otpBoxSub: { fontSize: 12, color: '#6b7280', textAlign: 'center', marginBottom: 14 },
  otpDigitsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  otpDigit: {
    width: 42, height: 52, borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: '#FF8000', alignItems: 'center', justifyContent: 'center',
  },
  otpDigitText: { fontSize: 24, fontWeight: '700', color: '#FF8000' },
  otpWarning: { fontSize: 11, color: '#b45309', textAlign: 'center' },
});