import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { useAuthStore } from '../../../src/store/authStore';
import { deliveryApi } from '../../../src/api/delivery';
import { PayerType, VehicleType, VEHICLE_RATES, describeTripScope, TripScope } from '../../../src/types/delivery';
import { AFRICAN_COUNTRIES, GHANA_REGIONS } from '../../../src/data/africaGeo';

const VEHICLES: { key: VehicleType; label: string; icon: string }[] = [
  { key: 'bicycle',   label: 'Bicycle',   icon: 'bicycle-outline' },
  { key: 'motorbike', label: 'Motorbike', icon: 'speedometer-outline' },
  { key: 'car',       label: 'Car',       icon: 'car-outline' },
  { key: 'van',       label: 'Van',       icon: 'bus-outline' },
  { key: 'truck',     label: 'Truck',     icon: 'cube-outline' },
];

export default function DeliveryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { tokens } = useAuthStore();

  const [vehicleType, setVehicleType]       = useState<VehicleType>('motorbike');
  const [payerType, setPayerType]           = useState<PayerType>('sender');
  const [itemName, setItemName]             = useState('');
  const [pickupAddress, setPickupAddress]   = useState('');
  // Structured dropoff — Country → Region (Ghana only, for now) → Town/Municipality
  // → specific area/Landmark, in that order, so the backend can run a scoped
  // geocode instead of guessing from one freeform string. The landmark is the
  // most precise piece but often won't be on OpenStreetMap (e.g. a specific
  // suburb or street within a town); town is the reliable fallback anchor, so
  // two addresses in the same town still land near each other even when the
  // landmark itself can't be found. See src/data/africaGeo.ts.
  const [dropoffCountry, setDropoffCountry]   = useState('Ghana');
  const [dropoffRegion, setDropoffRegion]     = useState('');
  const [dropoffTown, setDropoffTown]         = useState('');
  const [dropoffLandmark, setDropoffLandmark] = useState('');
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [regionPickerVisible, setRegionPickerVisible]   = useState(false);
  const [packageDesc, setPackageDesc]       = useState('');
  const [receiverName, setReceiverName]     = useState('');
  const [receiverPhone, setReceiverPhone]   = useState('');
  const [receiverLoc, setReceiverLoc]       = useState('');
  const [loading, setLoading]               = useState(false);
  const [locLoading, setLocLoading]         = useState(true);
  const [userLocation, setUserLocation]     = useState<Location.LocationObject | null>(null);
  // Town/region/country from the phone's own OS-level geocoder (Google/Apple),
  // captured alongside the display address below. Sent to the backend so trip-
  // scope classification trusts this instead of re-deriving it from a separate
  // OpenStreetMap reverse-geocode, which has much sparser coverage of Ghanaian
  // towns and can disagree with what the customer already sees on this screen
  // (e.g. resolving to a small suburb like "Adweso" instead of "Koforidua").
  const [pickupTown, setPickupTown]         = useState('');
  const [pickupRegion, setPickupRegion]     = useState('');
  const [pickupCountry, setPickupCountry]   = useState('');

  // Paystack WebView state
  const [paystackUrl, setPaystackUrl]         = useState('');
  const [paystackRef, setPaystackRef]         = useState('');
  const [paystackVisible, setPaystackVisible] = useState(false);
  const [paystackLoading, setPaystackLoading] = useState(true);
  // Set right after booking, from the backend's trip-scope classification —
  // shown in the confirmation alert so the customer sees what the fee was
  // actually based on (same town, same region, cross-region, ...).
  const [tripScopeMsg, setTripScopeMsg] = useState<string | null>(null);

  // On mount: get GPS then reverse-geocode to fill pickup address
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setLocLoading(false); return; }

        // Use cached position first (instant) — avoids GPS timeout errors
        let loc = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
        if (!loc) {
          // No cache — fresh with 10-second timeout
          const freshPromise = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 10000),
          );
          loc = await Promise.race([freshPromise, timeoutPromise]);
        }

        setUserLocation(loc);
        // Reverse-geocode GPS → readable street address for pickup field
        const [place] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (place) {
          const parts = [place.streetNumber, place.street, place.district, place.city]
            .filter(Boolean);
          if (parts.length > 0) setPickupAddress(parts.join(', '));
          if (place.city) setPickupTown(place.city);
          if (place.region) setPickupRegion(place.region);
          if (place.country) setPickupCountry(place.country);
        }
      } catch {
        // Location unavailable — user fills in manually
      } finally {
        setLocLoading(false);
      }
    })();
  }, []);

  const rate = VEHICLE_RATES[vehicleType];
  const isGhana = dropoffCountry === 'Ghana';
  // Composed for display/storage; the backend geocodes off the structured
  // fields below (landmark → town → region → country fallback), not this string.
  const dropoffAddress = [dropoffLandmark, dropoffTown, dropoffRegion, dropoffCountry].filter(Boolean).join(', ');

  // Called after WebView closes — verifies payment with Paystack and updates DB
  const confirmPayment = async () => {
    setPaystackVisible(false);
    if (!tokens?.access || !paystackRef) {
      router.push('/delivery/track');
      return;
    }
    try {
      const { payment_status } = await deliveryApi.verifyPayment(tokens.access, paystackRef);
      const base = payment_status === 'success'
        ? 'Delivery booked and payment confirmed!'
        : 'Payment not confirmed yet. You can pay later from My Deliveries.';
      Alert.alert(
        payment_status === 'success' ? 'Payment Confirmed' : 'Payment Pending',
        tripScopeMsg ? `${base}\n\n${tripScopeMsg}` : base,
        [{ text: 'OK', onPress: () => router.push('/delivery/track') }],
      );
    } catch {
      router.push('/delivery/track');
    }
  };

  // Detect Paystack redirect URLs inside the WebView
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

  const handleRequest = async () => {
    if (!itemName || !pickupAddress || !dropoffTown || (isGhana && !dropoffRegion) || !packageDesc || !receiverName || !receiverPhone) {
      Alert.alert('Missing fields', 'Please fill in all required fields, including the dropoff region and town/community.');
      return;
    }
    if (!tokens?.access) {
      Alert.alert('Not signed in', 'Please sign in first.');
      router.push('/login');
      return;
    }

    setLoading(true);
    try {
      // Use live GPS coords for pickup; geocode pickup address as fallback
      let pickupLat = userLocation?.coords.latitude ?? 0;
      let pickupLng = userLocation?.coords.longitude ?? 0;
      if (!pickupLat || !pickupLng) {
        try {
          const g = await Location.geocodeAsync(pickupAddress);
          if (g.length > 0) { pickupLat = g[0].latitude; pickupLng = g[0].longitude; }
        } catch { /* backend will geocode via Nominatim */ }
      }

      // Dropoff is resolved server-side from the structured town/region/country
      // fields (scoped Nominatim lookup + region/country centroid fallback) —
      // a device-side freeform geocode of an informal Ghanaian address is not
      // reliable enough to trust for pricing, so we don't attempt one here.

      const result = await deliveryApi.requestRider(tokens.access, {
        order_id:                   orderId || undefined,
        item_name:                  itemName,
        vehicle_type:               vehicleType,
        pickup_address:             pickupAddress,
        pickup_lat:                 pickupLat,
        pickup_lng:                 pickupLng,
        pickup_town:                pickupTown,
        pickup_region:              pickupRegion,
        pickup_country:             pickupCountry,
        dropoff_address:            dropoffAddress,
        dropoff_lat:                0,
        dropoff_lng:                0,
        dropoff_landmark:           dropoffLandmark,
        dropoff_town:               dropoffTown,
        dropoff_region:             dropoffRegion,
        dropoff_country:            dropoffCountry,
        package_description:        packageDesc,
        receiver_name:              receiverName,
        receiver_phone:             receiverPhone,
        receiver_specific_location: receiverLoc,
        payer_type:                 payerType,
      });

      const scopeMsg = describeTripScope(
        result.trip_scope as TripScope | undefined,
        result.pickup_town, result.pickup_region,
        result.dropoff_town, result.dropoff_region,
      );
      setTripScopeMsg(scopeMsg);

      if (payerType === 'sender' && result.checkout_url) {
        // Open Paystack in WebView modal — no external browser
        setPaystackUrl(result.checkout_url);
        setPaystackRef(result.reference ?? '');
        setPaystackLoading(true);
        setPaystackVisible(true);
      } else if (payerType === 'receiver') {
        const base = `The receiver (${receiverName}) will be prompted to pay GH₵ ${result.estimated_price.toFixed(2)} from their SokoApp.`;
        Alert.alert(
          'Delivery Created',
          scopeMsg ? `${base}\n\n${scopeMsg}` : base,
          [{ text: 'OK', onPress: () => router.push('/delivery/track') }],
        );
      } else {
        router.push('/delivery/track');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Unable to create delivery. Try again.';
      Alert.alert('Request failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Request Delivery</Text>
        <TouchableOpacity onPress={() => router.push('/delivery/track')} style={styles.historyBtn}>
          <Ionicons name="time-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Vehicle selector */}
          <Text style={styles.sectionLabel}>Vehicle Type</Text>
          <View style={styles.vehicleRow}>
            {VEHICLES.map((v) => (
              <TouchableOpacity
                key={v.key}
                style={[styles.vehicleCard, vehicleType === v.key && styles.vehicleCardActive]}
                onPress={() => setVehicleType(v.key)}
                activeOpacity={0.8}
              >
                <Ionicons name={v.icon as any} size={22} color={vehicleType === v.key ? '#fff' : '#FF8000'} />
                <Text style={[styles.vehicleLabel, vehicleType === v.key && styles.vehicleLabelActive]}>{v.label}</Text>
                <Text style={[styles.vehiclePrice, vehicleType === v.key && { color: '#ffe0b2' }]}>
                  GH₵{VEHICLE_RATES[v.key].base_fee}+{VEHICLE_RATES[v.key].per_km_rate}/km
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Who Pays */}
          <Text style={styles.sectionLabel}>Who Pays?</Text>
          <View style={styles.payerRow}>
            {([
              { key: 'sender' as PayerType,   label: "I'll Pay",      icon: 'wallet-outline' },
              { key: 'receiver' as PayerType, label: 'Receiver Pays', icon: 'person-outline' },
            ]).map((p) => (
              <TouchableOpacity
                key={p.key}
                style={[styles.payerCard, payerType === p.key && styles.payerCardActive]}
                onPress={() => setPayerType(p.key)}
                activeOpacity={0.8}
              >
                <Ionicons name={p.icon as any} size={20} color={payerType === p.key ? '#FF8000' : '#9ca3af'} />
                <Text style={[styles.payerLabel, payerType === p.key && styles.payerLabelActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {payerType === 'receiver' && (
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color="#1D9E75" />
              <Text style={styles.infoText}>
                The receiver's phone number must be registered on SokoApp. They will pay before the package is released.
              </Text>
            </View>
          )}

          {/* Parcel info */}
          <Text style={styles.sectionLabel}>Parcel Info</Text>
          <TextInput style={styles.input} placeholder="Item name (e.g. Laptop)" placeholderTextColor="#9ca3af" value={itemName} onChangeText={setItemName} />
          <TextInput style={[styles.input, styles.multiline]} placeholder="Package description" placeholderTextColor="#9ca3af" value={packageDesc} onChangeText={setPackageDesc} multiline />

          {/* Addresses */}
          <Text style={styles.sectionLabel}>Pickup</Text>
          <View style={styles.addressRow}>
            <View style={styles.addressDot} />
            <View style={{ flex: 1 }}>
              <TextInput
                style={[styles.input, { marginBottom: 0 }]}
                placeholder={locLoading ? 'Detecting your location…' : 'Pickup address'}
                placeholderTextColor="#9ca3af"
                value={pickupAddress}
                onChangeText={setPickupAddress}
              />
              {locLoading && (
                <ActivityIndicator size="small" color="#FF8000" style={styles.locIndicator} />
              )}
            </View>
          </View>

          <View style={styles.addressLine} />

          <Text style={styles.sectionLabel}>Dropoff</Text>
          <View style={styles.addressRow}>
            <View style={[styles.addressDot, { backgroundColor: '#FF8000' }]} />
            <View style={{ flex: 1, gap: 8 }}>
              <TouchableOpacity
                style={styles.pickerField}
                onPress={() => setCountryPickerVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerFieldText}>{dropoffCountry}</Text>
                <Ionicons name="chevron-down" size={16} color="#9ca3af" />
              </TouchableOpacity>

              {isGhana ? (
                <TouchableOpacity
                  style={styles.pickerField}
                  onPress={() => setRegionPickerVisible(true)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.pickerFieldText, !dropoffRegion && styles.pickerFieldPlaceholder]}>
                    {dropoffRegion || 'Select region'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color="#9ca3af" />
                </TouchableOpacity>
              ) : (
                <TextInput
                  style={[styles.input, { marginBottom: 0 }]}
                  placeholder="Region / State (optional)"
                  placeholderTextColor="#9ca3af"
                  value={dropoffRegion}
                  onChangeText={setDropoffRegion}
                />
              )}

              <TextInput
                style={[styles.input, { marginBottom: 0 }]}
                placeholder="Town / Municipality (e.g. Koforidua)"
                placeholderTextColor="#9ca3af"
                value={dropoffTown}
                onChangeText={setDropoffTown}
              />

              <TextInput
                style={[styles.input, { marginBottom: 0 }]}
                placeholder="Specific area / landmark (optional, e.g. Trom)"
                placeholderTextColor="#9ca3af"
                value={dropoffLandmark}
                onChangeText={setDropoffLandmark}
              />
            </View>
          </View>

          {/* Receiver details */}
          <Text style={styles.sectionLabel}>Receiver Details</Text>
          <TextInput style={styles.input} placeholder="Receiver name" placeholderTextColor="#9ca3af" value={receiverName} onChangeText={setReceiverName} />
          <TextInput
            style={styles.input}
            placeholder="Receiver phone (must be on SokoApp)"
            placeholderTextColor="#9ca3af"
            value={receiverPhone}
            onChangeText={setReceiverPhone}
            keyboardType="phone-pad"
          />
          <TextInput style={styles.input} placeholder="Location notes (optional)" placeholderTextColor="#9ca3af" value={receiverLoc} onChangeText={setReceiverLoc} />

          {/* Price info */}
          <View style={styles.priceBox}>
            <Ionicons name="cash-outline" size={18} color="#FF8000" />
            <Text style={styles.priceText}>
              Base GH₵ {rate.base_fee} + GH₵ {rate.per_km_rate}/km · final price calculated on distance
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.7 }]}
            onPress={handleRequest}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="navigate-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.submitBtnText}>
                    {payerType === 'sender' ? 'Book & Pay' : 'Book (Receiver Pays)'}
                  </Text>
                </>
            }
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Paystack WebView Modal */}
      <Modal visible={paystackVisible} animationType="slide" onRequestClose={confirmPayment}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.webHeader}>
            <TouchableOpacity onPress={confirmPayment} style={styles.backBtn}>
              <Ionicons name="close" size={22} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.webHeaderTitle}>Complete Payment</Text>
            <View style={{ width: 30 }} />
          </View>

          {paystackLoading && (
            <View style={styles.webLoading}>
              <ActivityIndicator size="large" color="#FF8000" />
              <Text style={styles.webLoadingText}>Loading payment page…</Text>
            </View>
          )}

          <WebView
            source={{ uri: paystackUrl }}
            onLoadEnd={() => setPaystackLoading(false)}
            onNavigationStateChange={handleWebViewNav}
            style={{ flex: 1 }}
            javaScriptEnabled
            domStorageEnabled
            // Card payments open the bank's 3-D Secure page as a new window;
            // load it in this WebView instead of silently dropping it.
            setSupportMultipleWindows={false}
            thirdPartyCookiesEnabled
          />

          {!paystackLoading && (
            <TouchableOpacity style={styles.donePayBtn} onPress={confirmPayment}>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={styles.donePayBtnText}>I've Completed Payment</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Modal>

      {/* Dropoff Country Picker */}
      <Modal visible={countryPickerVisible} animationType="slide" transparent onRequestClose={() => setCountryPickerVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Dropoff Country</Text>
              <TouchableOpacity onPress={() => setCountryPickerVisible(false)}>
                <Ionicons name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={AFRICAN_COUNTRIES}
              keyExtractor={(item) => item.iso2}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.sheetRow}
                  onPress={() => {
                    setDropoffCountry(item.name);
                    setDropoffRegion('');
                    setCountryPickerVisible(false);
                  }}
                >
                  <Text style={styles.sheetRowText}>{item.name}</Text>
                  {dropoffCountry === item.name && <Ionicons name="checkmark" size={18} color="#FF8000" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Dropoff Region Picker (Ghana only) */}
      <Modal visible={regionPickerVisible} animationType="slide" transparent onRequestClose={() => setRegionPickerVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Dropoff Region</Text>
              <TouchableOpacity onPress={() => setRegionPickerVisible(false)}>
                <Ionicons name="close" size={22} color="#374151" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={GHANA_REGIONS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.sheetRow}
                  onPress={() => {
                    setDropoffRegion(item);
                    setRegionPickerVisible(false);
                  }}
                >
                  <Text style={styles.sheetRowText}>{item}</Text>
                  {dropoffRegion === item && <Ionicons name="checkmark" size={18} color="#FF8000" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
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
  historyBtn: { padding: 4 },
  form: { padding: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginTop: 16, marginBottom: 8 },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleCard: {
    width: '30.5%', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 14, padding: 10, borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  vehicleCardActive: { backgroundColor: '#FF8000', borderColor: '#FF8000' },
  vehicleLabel: { fontSize: 11, fontWeight: '700', color: '#374151', marginTop: 4 },
  vehicleLabelActive: { color: '#fff' },
  vehiclePrice: { fontSize: 9, color: '#9ca3af', marginTop: 2, textAlign: 'center' },
  payerRow: { flexDirection: 'row', gap: 8 },
  payerCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 12, padding: 14,
    borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  payerCardActive: { borderColor: '#FF8000', backgroundColor: '#fff7ed' },
  payerLabel: { fontSize: 13, fontWeight: '600', color: '#9ca3af' },
  payerLabelActive: { color: '#FF8000' },
  infoBox: {
    flexDirection: 'row', gap: 8, backgroundColor: '#ecfdf5',
    borderRadius: 10, padding: 12, marginTop: 8, alignItems: 'flex-start',
  },
  infoText: { flex: 1, fontSize: 12, color: '#374151', lineHeight: 18 },
  input: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 13, fontSize: 14, color: '#111827',
    borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 10,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addressDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#1D9E75', flexShrink: 0 },
  addressLine: { width: 2, height: 10, backgroundColor: '#e5e7eb', marginLeft: 5, marginBottom: 10 },
  locIndicator: { position: 'absolute', right: 12, top: 15 },
  priceBox: {
    flexDirection: 'row', gap: 8, backgroundColor: '#fff7ed',
    borderRadius: 10, padding: 12, marginTop: 4, alignItems: 'flex-start',
  },
  priceText: { flex: 1, fontSize: 12, color: '#374151', lineHeight: 18 },
  submitBtn: {
    backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  // WebView modal
  webHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
    backgroundColor: '#fff',
  },
  webHeaderTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#111827' },
  webLoading: {
    ...StyleSheet.absoluteFill, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: 12,
  },
  webLoadingText: { fontSize: 14, color: '#6b7280' },
  donePayBtn: {
    backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, paddingVertical: 16,
    marginHorizontal: 16, marginBottom: 12, borderRadius: 14,
  },
  donePayBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pickerField: {
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 13, borderWidth: 1, borderColor: '#e5e7eb',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  pickerFieldText: { flex: 1, fontSize: 14, color: '#111827', marginRight: 8 },
  pickerFieldPlaceholder: { color: '#9ca3af' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '75%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  sheetRowText: { flex: 1, fontSize: 14, color: '#111827', marginRight: 8 },
});
