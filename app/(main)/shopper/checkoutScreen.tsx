import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';

import { WebView } from 'react-native-webview';

import * as WebBrowser from 'expo-web-browser';
WebBrowser.maybeCompleteAuthSession();
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../src/store/authStore';
import { createOrder, payOrder, getDeliveryFee, verifyPayment } from '../../../src/api';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function CheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, cartTotal, clearCart, user, tokens } = useAuthStore() as any;
  const token = tokens?.access;

  // ── all refs and state at the top ──
  const verifyingRef = useRef(false);

  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [webviewKey, setWebviewKey] = useState(0);

  // Location
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState(false);

  // Dynamic delivery fee
  const [deliveryFee, setDeliveryFee] = useState(15.00);
  const [deliveryFeeReason, setDeliveryFeeReason] = useState('Standard delivery fee');
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeBreakdown, setFeeBreakdown] = useState('');
  const [distanceKm, setDistanceKm] = useState<number | null>(null);

  // Paystack
  const [paystackUrl, setPaystackUrl] = useState('');
  const [paystackModal, setPaystackModal] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [paymentStep, setPaymentStep] = useState<'form' | 'processing' | 'webview'>('form');

  const total = cartTotal + deliveryFee;

  const items = Object.values(cart || {}).map((item: any) => ({
    product_id: String(item.id || ''),
    name: item.name || '',
    quantity: item.quantity || 1,
    unit_price: item.price || 0
  }));

  // ── Get dynamic delivery fee from server ──
 const getDeliveryFeeData = async (lat?: number, lng?: number) => {
    setFeeLoading(true);
    try {
      const storeIds = Array.from(new Set(Object.values(cart || {}).map((item: any) => item.store_id).filter((id): id is string => !!id)));
      const storeId = storeIds[0];

      const response = await getDeliveryFee(lat, lng, storeId);
      const data = response.data;
      setDeliveryFee(data.fee);
      setDeliveryFeeReason(data.reason);
      setFeeBreakdown(data.breakdown);
      setDistanceKm(data.distance_km);
    } catch (e) {
      console.log('Fee error:', e);
      setDeliveryFee(15.00);
      setDeliveryFeeReason('Standard delivery fee');
      setFeeBreakdown('Base: GHS 15.00');
    } finally {
      setFeeLoading(false);
    }
  };

    const getLocation = async () => {
    setLocationLoading(true);
    setLocationError(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError(true);
        await getDeliveryFeeData();
        return;
      }

      // Check cache with a slightly wider window (10 min)
      const cached = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
      if (cached) {
        const lat = cached.coords.latitude;
        const lng = cached.coords.longitude;
        setLocation({ latitude: lat, longitude: lng });
        setLocationLoading(false);
        await getDeliveryFeeData(lat, lng);
        // Silent background refresh
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(fresh => setLocation({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude }))
          .catch(() => {});
        return;
      }

      // No cache — use LOW accuracy first (network/cell-tower, very fast ~1-2s)
      // then upgrade silently in background
      const freshPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,  // ← cell tower, fast
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Location timeout')), 20000), // ← 20s
      );

      const loc = await Promise.race([freshPromise, timeoutPromise]);
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      setLocation({ latitude: lat, longitude: lng });
      setLocationLoading(false);
      await getDeliveryFeeData(lat, lng);

      // Now get precise GPS silently
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then(fresh => setLocation({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude }))
        .catch(() => {});

    } catch (e) {
      console.log('Location capture failed:', e);
      setLocationError(true);
      await getDeliveryFeeData();
    } finally {
      setLocationLoading(false);
    }
  };

    useEffect(() => {
      getLocation();
    }, []);

    const handleProceedToPayment = async () => {
      if (!deliveryAddress.trim()) {
        Alert.alert('Error', 'Please enter your delivery address');
        return;
      }
      if (items.length === 0) {
        Alert.alert('Error', 'Your cart is empty');
        return;
      }
      if (!user?.email) {
        Alert.alert('Error', 'User email not found. Please log out and log in again.');
        return;
      }
      setPaystackModal(false);
      setPaymentStep('processing');
      setLoading(true);
      verifyingRef.current = false;

      try {
        const orderResponse = await createOrder({
          store_id: (Object.values(cart || {})[0] as any)?.store_id,
          delivery_address: deliveryAddress.trim(),
          delivery_fee: deliveryFee,
          items,
          lat: location?.latitude || 0,
          lng: location?.longitude || 0,
        });

        const orderId = orderResponse.data.order_id;
        setPendingOrderId(orderId);

        const paymentResponse = await payOrder(orderId, 'paystack');

        setPaymentReference(paymentResponse.data.reference);

        const paymentUrl = paymentResponse.data.checkout_url;

        console.log('PAYSTACK URL:', paymentUrl);

        if (!paymentUrl) {
          throw new Error('No payment URL received from server');
        }

        setPaystackUrl(paymentUrl);
        setWebviewKey(prev => prev + 1);
        setPaymentStep('webview');
        setPaystackModal(true);
        setLoading(false);
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to initialize payment');
        setPaymentStep('form');
      } finally {
        setLoading(false);
      }
    };

  const handleNavigationStateChange = (navState: any) => {
    const { url } = navState;

    // Detect if Paystack has redirected to a success or callback URL
    if (url.includes('payment-success') || url.includes('callback') || url.includes('checkout/done')) {
      setPaystackModal(false);
      setPaymentStep('processing');
      handleVerifyPayment();
    }
  };

  const handleVerifyPayment = async (refOverride?: string) => {
    const ref = refOverride || paymentReference;
    const orderId = pendingOrderId;

    console.log('Verifying payment:', ref, 'Order:', orderId);

    if (!ref || !orderId) {
      Alert.alert('Error', 'Payment reference or order ID missing');
      setPaymentStep('form');
      verifyingRef.current = false;
      return;
    }

    setPaystackModal(false);
    setPaymentStep('processing');
    setLoading(true);

    try {
      const response = await verifyPayment(ref, orderId);
      const result = response.data;
      console.log('Verify result:', result);

      if (result.status === 'success') {
        clearCart();
          router.replace('/shopper/MyOrdersScreen' as any)
      ;
     } else {
        Alert.alert(
          '❌ Payment Failed',
          'Your payment was not successful. Please try again.',
          [
            {
              text: 'Try Again',
              onPress: () => {
                setPaymentStep('form');
                verifyingRef.current = false;
              }
            },
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => router.back()
            }
          ]
        );
      }
    } catch (e: any) {
      console.log('Verify error:', e.message);
      Alert.alert(
        'Verification Error',
        e.message || 'Could not verify payment. If payment was deducted, contact support.',
        [{
          text: 'View My Orders',
          onPress: () => router.push('/shopper/MyOrdersScreen' as any)
        }]
      );
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
  };

  const getFeeColor = () => {
    if (deliveryFee <= 5) return '#2ecc71';
    if (deliveryFee <= 8) return '#f39c12';
    return '#FF8000';
  };

  

  // ── PROCESSING ──
  if (paymentStep === 'processing') {
    return (
      <View style={styles.processingContainer}>
        <ActivityIndicator size="large" color="#FF8000" />
        <Text style={styles.processingTitle}>
          {pendingOrderId ? 'Verifying payment...' : 'Creating order...'}
        </Text>
        <Text style={styles.processingSub}>Please wait, do not close the app</Text>
      </View>
    );
  }

  // ── MAIN CHECKOUT FORM ──
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <View style={styles.container}>

        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

          {/* Location Banner */}
          <View style={[
            styles.locationBanner,
            locationLoading ? styles.locationBannerLoading :
            locationError ? styles.locationBannerError :
            styles.locationBannerSuccess
          ]}>
            {locationLoading ? (
              <View style={styles.locationBannerRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.locationBannerText}>Getting your GPS location...</Text>
              </View>
            ) : locationError ? (
              <View>
                <Text style={styles.locationBannerText}>⚠️ Could not get GPS location</Text>
                <Text style={styles.locationBannerSub}>Driver will use delivery address</Text>
                <TouchableOpacity onPress={getLocation} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>🔄 Try Again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.locationBannerRow}>
                <Text style={styles.locationBannerText}>✅ GPS location captured</Text>
              </View>
            )}
          </View>

          {/* Order Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📦 Order Summary</Text>
            {Object.values(cart || {}).map((item: any) => (
              <View key={item.id} style={styles.orderItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderItemName}>{item.name} × {item.quantity}</Text>
                  {item.holiday_pricing && (
                    <Text style={styles.holidayItemNote}>🎉 Holiday pricing applied</Text>
                  )}
                </View>
                <Text style={styles.orderItemPrice}>
                  GHS {(item.price * item.quantity).toFixed(2)}
                </Text>
              </View>
            ))}
            <View style={styles.divider} />
            {/* Dynamic Delivery Fee */}
            <View style={styles.orderItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderItemName}>Delivery fee</Text>
                {feeLoading ? (
                  <ActivityIndicator size="small" color="#888"
                    style={{ alignSelf: 'flex-start', marginTop: 2 }} />
                ) : (
                  <>
                    <View style={[styles.feeBadge, { backgroundColor: getFeeColor() }]}>
                      <Text style={styles.feeBadgeText}>{deliveryFeeReason}</Text>
                    </View>
                    {distanceKm !== null && (
                      <Text style={styles.distanceText}>
                        📏 {distanceKm} km from shop to drop off
                      </Text>
                    )}
                  </>
                )}
              </View>
              <Text style={[styles.orderItemPrice, { color: getFeeColor(), fontWeight: '700' }]}>
                GHS {deliveryFee.toFixed(2)}
              </Text>
            </View>

            {/* Fee breakdown */}
            {!feeLoading && feeBreakdown && deliveryFee > 15 && (
              <View style={styles.feeBreakdownBox}>
                <Text style={styles.feeBreakdownTitle}>Fee breakdown:</Text>
                {feeBreakdown.split(' | ').map((line, idx) => (
                  <Text key={idx} style={styles.feeBreakdownLine}>• {line}</Text>
                ))}
              </View>
            )}
            <View style={styles.divider} />
            <View style={styles.orderItem}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>GHS {total.toFixed(2)}</Text>
            </View>
            {deliveryFee > 15 && (
              <View style={styles.feeInfoBox}>
                <Text style={styles.feeInfoText}>
                  {deliveryFeeReason.toLowerCase().includes('holiday')
                    ? `🎉 It's a public holiday — delivery is busier than usual, so pricing is temporarily higher.`
                    : deliveryFeeReason.toLowerCase().includes('distance')
                    ? `ℹ️ Delivery is higher due to distance (${distanceKm ? distanceKm.toFixed(1) : 'extra'} km).`
                    : `ℹ️ Delivery fee is higher due to ${deliveryFee >= 20 ? 'late night' : 'evening'} hours.`}
                </Text>
              </View>
            )}
          </View>

          {/* Delivery Address */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📍 Delivery Address</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full delivery address"
              placeholderTextColor="#aaa"
              value={deliveryAddress}
              onChangeText={setDeliveryAddress}
              multiline
              numberOfLines={2}
            />
          </View>

          {/* Payment Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>💳 Payment</Text>
            <View style={styles.paystackInfo}>
              <View style={styles.paystackInfoRow}>
                <Text style={styles.paystackInfoEmoji}>🔒</Text>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.paystackInfoTitle}>Secured by Paystack</Text>
                  <Text style={styles.paystackInfoSub}>
                    Pay with Card, Mobile Money (MTN, Vodafone, AirtelTigo), or Bank Transfer
                  </Text>
                </View>
              </View>
              <View style={styles.paymentMethodsRow}>
                {['💳 Card', '📱 MoMo', '🏦 Bank'].map(method => (
                  <View key={method} style={styles.methodChip}>
                    <Text style={styles.methodChipText}>{method}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={{ height: 20 }} />
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerSummary}>
            <Text style={styles.footerItems}>Items: GHS {cartTotal.toFixed(2)}</Text>
            <Text style={styles.footerFee}>+ Delivery: GHS {deliveryFee.toFixed(2)}</Text>
            <Text style={styles.footerTotal}>= GHS {total.toFixed(2)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.payBtn, loading && styles.payBtnDisabled]}
            onPress={handleProceedToPayment}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : (
                <View style={styles.payBtnInner}>
                  <Text style={styles.payBtnText}>Pay GHS {total.toFixed(2)}</Text>
                  <Text style={styles.payBtnSub}>via Paystack 🔒</Text>
                </View>
              )
            }
          </TouchableOpacity>
        </View>

        {/* Paystack Payment Modal */}
        <Modal
          visible={paystackModal}
          animationType="slide"
          onRequestClose={() => setPaystackModal(false)}
        >
          <SafeAreaView style={styles.webviewSafe} edges={['left', 'right']}>
            <View style={[styles.webviewHeader, { paddingTop: insets.top }]}>
              <TouchableOpacity 
                onPress={() => {
                  setPaystackModal(false);
                  setPaymentStep('processing');
                  handleVerifyPayment();
                }} 
                style={styles.webviewCloseBtn}
              >
                <Text style={styles.webviewCloseBtnText}>Done / Close</Text>
              </TouchableOpacity>
              <Text style={styles.webviewTitle}>Secure Payment</Text>
              <View style={styles.webviewSecure}>
                <Text style={styles.webviewSecureText}>🔒 SSL</Text>
              </View>
            </View>
            
            <WebView
              key={webviewKey}
              source={{ uri: paystackUrl }}
              style={{ flex: 1 }}
              originWhitelist={['*']}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              onNavigationStateChange={handleNavigationStateChange}
              startInLoadingState={true}
              renderLoading={() => (
                <View style={styles.webviewLoading}>
                  <ActivityIndicator size="large" color="#e74c3c" />
                  <Text style={styles.webviewLoadingText}>Loading Paystack...</Text>
                </View>
              )}
            />
            
            <TouchableOpacity 
              style={styles.manualVerifyBtn} 
              onPress={() => { setPaystackModal(false); setPaymentStep('processing'); handleVerifyPayment(); }}
            >
               <Text style={styles.manualVerifyText}>I have completed the payment</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Modal>

      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  webviewSafe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    backgroundColor: '#FF8000', paddingBottom: 16,
    paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { padding: 4 },
  backBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  content: { flex: 1 },
  locationBanner: { margin: 16, marginBottom: 0, borderRadius: 12, padding: 14 },
  locationBannerLoading: { backgroundColor: '#d37a21' },
  locationBannerError: { backgroundColor: '#FF8000' },
  locationBannerSuccess: { backgroundColor: '#2ecc71' },
  locationBannerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locationBannerText: { color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 6 },
  locationBannerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 4 },
  retryBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start', marginTop: 8,
  },
  retryBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  section: {
    backgroundColor: '#fff', margin: 16, marginBottom: 0,
    borderRadius: 14, padding: 16, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 3,
  },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 14 },
  orderItem: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 8,
  },
  orderItemName: { fontSize: 14, color: '#555', flex: 1 },
  holidayItemNote: { fontSize: 11, fontWeight: '700', color: '#FF8000', marginTop: 2 },
  orderItemPrice: { fontSize: 14, color: '#333', fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 10 },
  totalLabel: { fontSize: 15, fontWeight: 'bold', color: '#1a1a1a' },
  totalValue: { fontSize: 16, fontWeight: 'bold', color: '#FF8000' },
  feeBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, marginTop: 4,
  },
  feeBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  feeInfoBox: {
    backgroundColor: '#fff8e1', borderRadius: 8, padding: 10,
    marginTop: 8, borderLeftWidth: 3, borderLeftColor: '#f39c12',
  },
  feeInfoText: { fontSize: 12, color: '#666', lineHeight: 16 },
  input: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    color: '#1a1a1a', backgroundColor: '#fafafa',
  },
  distanceText: {
  fontSize: 11, color: '#888', marginTop: 3,
  },
  feeBreakdownBox: {
    backgroundColor: '#f8f9fa', borderRadius: 8, padding: 10,
    marginTop: 8, borderWidth: 1, borderColor: '#e0e0e0',
  },
  feeBreakdownTitle: {
    fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 4,
  },
  feeBreakdownLine: {
    fontSize: 11, color: '#666', marginBottom: 2,
  },
  paystackInfo: {
    backgroundColor: '#f8f9ff', borderRadius: 10,
    padding: 14, borderWidth: 1, borderColor: '#e8eaf6',
  },
  paystackInfoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  paystackInfoEmoji: { fontSize: 24 },
  paystackInfoTitle: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  paystackInfoSub: { fontSize: 12, color: '#666', lineHeight: 16 },
  paymentMethodsRow: { flexDirection: 'row', gap: 8 },
  methodChip: {
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0',
  },
  methodChipText: { fontSize: 12, color: '#333', fontWeight: '600' },
  footer: {
    backgroundColor: '#fff', padding: 16, paddingBottom: 30,
    elevation: 8, shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 4,
  },
  footerSummary: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginBottom: 12, paddingHorizontal: 4,
  },
  footerItems: { fontSize: 12, color: '#888' },
  footerFee: { fontSize: 12, color: '#888' },
  footerTotal: { fontSize: 14, fontWeight: 'bold', color: '#FF8000' },
  payBtn: {
    backgroundColor: '#FF8000', paddingVertical: 16,
    borderRadius: 12, alignItems: 'center',
  },
  payBtnDisabled: { backgroundColor: '#f5b7b1' },
  payBtnInner: { alignItems: 'center' },
  payBtnText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  payBtnSub: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2 },
  webviewHeader: {
    backgroundColor: '#FF8000', paddingBottom: 14,
    paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  webviewCloseBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: 8,
  },
  webviewCloseBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  webviewTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  webviewSecure: {
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 8,
  },
  webviewSecureText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  webviewLoading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff',
  },
  webviewLoadingText: { marginTop: 12, color: '#888', fontSize: 14 },
  manualVerifyBtn: {
    backgroundColor: '#d87819', padding: 16,
    alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eee',
  },
  manualVerifyText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  processingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff',
  },
  processingTitle: { fontSize: 18, fontWeight: 'bold', color: '#1a1a1a', marginTop: 20 },
  processingSub: { fontSize: 14, color: '#888', marginTop: 8 },
});