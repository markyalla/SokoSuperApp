import React, { useState, useEffect, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../../src/components/Text';
import { TextInput } from '../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { accountService } from '../../src/store/accountService';
import { useAuthStore } from '../../src/store/authStore';
import { API_BASE_URL } from '../../src/config/api';
import { friendlyError } from '../../src/utils/friendlyError';

// Strips everything but letters/digits and uppercases, so dashes, spaces, and
// minor OCR noise don't cause false mismatches when comparing ID numbers.
const normalizeId = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// placeholder/hint follow the selected type so the example matches the card
// the user is actually holding (Ghana formats — the primary market).
const ID_TYPE_OPTIONS = [
  { label: 'National ID',         value: 'national_id',     icon: 'card-outline',             placeholder: 'GHA-123456789-0', hint: 'Ghana Card number, printed under your photo' },
  { label: 'NHIA ID',             value: 'nhia_id',         icon: 'medical-outline',          placeholder: '12345678',        hint: 'Health insurance (NHIS) membership number' },
  { label: 'Voter ID',            value: 'voter_id',        icon: 'checkmark-circle-outline', placeholder: '1234567890',      hint: '10-digit number on your voter ID card' },
  { label: 'Tax ID (TIN)',        value: 'tin',             icon: 'receipt-outline',          placeholder: 'P0012345678',     hint: 'Taxpayer Identification Number from the Ghana Revenue Authority' },
  { label: 'Passport ID',         value: 'passport',        icon: 'airplane-outline',         placeholder: 'G1234567',        hint: 'Passport number, top right of the photo page' },
  { label: "Driver's License ID", value: 'drivers_license', icon: 'car-outline',              placeholder: 'ABC-12345678-12345', hint: 'Licence number on the front of your DVLA card' },
];

export default function KYCSubmissionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens, setKycStatus } = useAuthStore();

  const [idType, setIdType]           = useState('national_id');
  const [idNumber, setIdNumber]       = useState('');
  const [address, setAddress]         = useState('');
  const [city, setCity]               = useState('');
  const [country, setCountry]         = useState('');
  const [idImage, setIdImage]         = useState<{ uri: string; name: string; type: string } | null>(null);
  const [uploading, setUploading]     = useState(false);
  const [loading, setLoading]         = useState(false);

  // Best-effort on-device check that the typed ID number actually appears on
  // the photographed card — runs OCR once per image, then re-compares against
  // it on every keystroke without re-scanning. Never blocks submission; it's
  // just a heads-up so the user can catch a typo before the human review.
  const [recognizedText, setRecognizedText] = useState<string | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);

  useEffect(() => {
    if (!idImage) { setRecognizedText(null); return; }
    let cancelled = false;
    setOcrRunning(true);
    setRecognizedText(null);
    // Wrapped so a missing native module (e.g. Expo Go) rejects instead of throwing synchronously.
    Promise.resolve()
      .then(() => TextRecognition.recognize(idImage.uri))
      .then(result => { if (!cancelled) setRecognizedText(result.text); })
      .catch(() => { if (!cancelled) setRecognizedText(null); })
      .finally(() => { if (!cancelled) setOcrRunning(false); });
    return () => { cancelled = true; };
  }, [idImage?.uri]);

  const idMatch = useMemo(() => {
    const entered = normalizeId(idNumber);
    if (recognizedText == null || entered.length < 4) return null;
    return normalizeId(recognizedText).includes(entered);
  }, [idNumber, recognizedText]);

  const pickIDImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please grant access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 2],
      quality: 0.85,
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      setIdImage({
        uri: asset.uri,
        name: `kyc_id.${ext}`,
        type: asset.mimeType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      });
    }
  };

  const uploadIDImage = async (): Promise<string | undefined> => {
    if (!idImage) return undefined;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', { uri: idImage.uri, name: idImage.name, type: idImage.type } as any);
      formData.append('bucket', 'kyc');
      const res = await fetch(`${API_BASE_URL}/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens?.access}`, 'Content-Type': 'multipart/form-data' },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      return json.path as string;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!tokens?.access) {
      Alert.alert('Authentication required', 'Please log in again.');
      router.replace('/(auth)/login');
      return;
    }
    if (!idNumber || !address || !city || !country) {
      Alert.alert('Validation Error', 'Please fill in all required fields.');
      return;
    }
    if (!idImage) {
      Alert.alert('ID Image Required', 'Please upload a photo of your ID card.');
      return;
    }

    setLoading(true);
    try {
      const idImagePath = await uploadIDImage();
      await accountService.submitKYC(tokens.access, {
        id_type:      idType as any,
        id_number:    idNumber,
        id_image_url: idImagePath,
        address,
        city,
        country,
        id_mismatch:  idMatch === false,
      });
      await setKycStatus('submitted');
      router.replace('/home' as any);
      Alert.alert(
        'Verification submitted ✅',
        "Thanks! We're reviewing your details. You'll be notified once your identity is verified.",
      );
    } catch (error: any) {
      Alert.alert('Submission failed', friendlyError(error, 'Try again later.'));
    } finally {
      setLoading(false);
    }
  };

  const busy = uploading || loading;
  const selectedIdType = ID_TYPE_OPTIONS.find((o) => o.value === idType) ?? ID_TYPE_OPTIONS[0];

  const handleBack = () => {
    if (tokens?.access) {
      router.replace('/home' as any);
    } else {
      router.replace('/(auth)/login');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <View style={[styles.topSection, { paddingTop: insets.top + 24 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.logoBox}>
          <Ionicons name="shield-checkmark-outline" size={28} color="#fff" />
        </View>
        <Text style={styles.brand}>Identity Verification</Text>
        <Text style={styles.tagline}>Secure your account</Text>
      </View>

    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.form}>
          <Text style={styles.formTitle}>Complete your profile</Text>
          <Text style={styles.formSubtitle}>Verify your identity to access all SokoApp features</Text>

          {/* ID Type */}
          <Text style={styles.sectionDivider}>DOCUMENT DETAILS</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>IDENTIFICATION TYPE <Text style={styles.req}>*</Text></Text>
            <View style={styles.chipGrid}>
              {ID_TYPE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, idType === opt.value && styles.chipActive]}
                  onPress={() => setIdType(opt.value)}
                >
                  <Ionicons
                    name={opt.icon as any}
                    size={16}
                    color={idType === opt.value ? '#fff' : '#FF8000'}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.chipText, idType === opt.value && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ID Number */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{selectedIdType.label.toUpperCase()} NUMBER <Text style={styles.req}>*</Text></Text>
            <View style={styles.inputWrap}>
              <Ionicons name={selectedIdType.icon as any} size={17} color="#aaa" style={styles.icon} />
              <TextInput
                value={idNumber}
                onChangeText={setIdNumber}
                style={styles.input}
                placeholder={selectedIdType.placeholder}
                placeholderTextColor="#bbb"
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.fieldHint}>{selectedIdType.hint}</Text>
          </View>

          {/* ID Image */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>FRONT PHOTO OF ID <Text style={styles.req}>*</Text></Text>
            <TouchableOpacity style={styles.imageUploadBox} onPress={pickIDImage} activeOpacity={0.8}>
              {idImage ? (
                <Image source={{ uri: idImage.uri }} style={styles.idImagePreview} resizeMode="cover" />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="camera-outline" size={32} color="#FF8000" />
                  <Text style={styles.imagePlaceholderText}>Tap to upload ID photo</Text>
                  <Text style={styles.imagePlaceholderSub}>JPG or PNG — front side only</Text>
                </View>
              )}
            </TouchableOpacity>
            {idImage && (
              <TouchableOpacity onPress={pickIDImage} style={styles.changeImageBtn}>
                <Ionicons name="refresh-outline" size={14} color="#FF8000" />
                <Text style={styles.changeImageText}>Change photo</Text>
              </TouchableOpacity>
            )}

            {idImage && ocrRunning && (
              <View style={styles.ocrHintRow}>
                <ActivityIndicator size="small" color="#FF8000" />
                <Text style={styles.ocrHintText}>Scanning ID photo…</Text>
              </View>
            )}
            {idImage && !ocrRunning && idMatch === true && (
              <View style={styles.ocrHintRow}>
                <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                <Text style={[styles.ocrHintText, { color: '#16a34a' }]}>
                  ID number matches the photo
                </Text>
              </View>
            )}
            {idImage && !ocrRunning && idMatch === false && (
              <View style={styles.ocrHintRow}>
                <Ionicons name="alert-circle" size={16} color="#d97706" />
                <Text style={[styles.ocrHintText, { color: '#d97706' }]}>
                  We couldn't find this ID number on the photo — double-check for typos before submitting
                </Text>
              </View>
            )}
          </View>

          {/* Address */}
          <Text style={styles.sectionDivider}>ADDRESS INFORMATION</Text>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>RESIDENTIAL ADDRESS <Text style={styles.req}>*</Text></Text>
            <View style={styles.inputWrap}>
              <Ionicons name="location-outline" size={17} color="#aaa" style={styles.icon} />
              <TextInput
                value={address}
                onChangeText={setAddress}
                style={styles.input}
                placeholder="123 Cocoa Street"
                placeholderTextColor="#bbb"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.label}>CITY <Text style={styles.req}>*</Text></Text>
              <View style={styles.inputWrap}>
                <TextInput value={city} onChangeText={setCity} style={styles.input} placeholder="Koforidua" placeholderTextColor="#bbb" />
              </View>
            </View>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.label}>COUNTRY <Text style={styles.req}>*</Text></Text>
              <View style={styles.inputWrap}>
                <TextInput value={country} onChangeText={setCountry} style={styles.input} placeholder="Ghana" placeholderTextColor="#bbb" />
              </View>
            </View>
          </View>

          {busy ? (
            <View style={styles.busyBox}>
              <ActivityIndicator size="large" color="#FF8000" />
              <Text style={styles.busyText}>{uploading ? 'Uploading ID image…' : 'Submitting Profile…'}</Text>
            </View>
          ) : (
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} activeOpacity={0.85}>
              <Text style={styles.submitBtnText}>Submit</Text>
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.backLink} onPress={handleBack}>
            <Text style={styles.backLinkText}>{tokens?.access ? 'Skip for now' : 'Return to Login'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  scroll: { paddingBottom: 40 },
  topSection: {
    backgroundColor: '#FF8000', paddingTop: 24, paddingBottom: 44,
    alignItems: 'center', borderBottomLeftRadius: 36, borderBottomRightRadius: 36,
  },
  backBtn: {
    position: 'absolute', top: 16, left: 16, zIndex: 10,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  logoBox: {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center',
    justifyContent: 'center', marginBottom: 10,
  },
  // Full-width + centred rather than shrink-wrapped: some Android system
  // fonts under-measure shrink-wrapped text and drop the last word.
  brand:   { alignSelf: 'stretch', textAlign: 'center', fontSize: 22, fontWeight: '600', color: '#fff' },
  tagline: { alignSelf: 'stretch', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 3, paddingHorizontal: 24 },
  form:    { padding: 20, paddingTop: 24 },
  formTitle:    { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  formSubtitle: { fontSize: 13, color: '#888', marginBottom: 22 },
  sectionDivider: {
    fontSize: 11, fontWeight: '600', color: '#aaa',
    letterSpacing: 0.5, marginBottom: 14, marginTop: 12,
    paddingBottom: 6, borderBottomWidth: 0.5, borderBottomColor: '#eee',
  },
  fieldGroup: { marginBottom: 14 },
  // Labels are written in capitals in the JSX — textTransform: 'uppercase'
  // makes Android measure the lowercase width and clip the last word.
  label: { fontSize: 11, fontWeight: '600', color: '#aaa', letterSpacing: 0.4, marginBottom: 6 },
  fieldHint: { fontSize: 12, color: '#999', marginTop: 6, lineHeight: 16 },
  req:   { color: '#D85A30' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f7f7',
    borderWidth: 0.5, borderColor: '#e0e0e0', borderRadius: 12, paddingHorizontal: 12,
  },
  icon:  { marginRight: 8 },
  input: { flex: 1, paddingVertical: 13, fontSize: 14, color: '#1a1a1a' },
  row:   { flexDirection: 'row', gap: 12 },

  // ID type chips — 2 per row
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    width: '48%', paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#f7f7f7',
  },
  chipActive:     { backgroundColor: '#FF8000', borderColor: '#FF8000' },
  chipText:       { flexShrink: 1, fontSize: 13, color: '#555' },
  chipTextActive: { color: '#fff', fontWeight: '500' },

  // ID image upload
  imageUploadBox: {
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 14,
    borderStyle: 'dashed', overflow: 'hidden', backgroundColor: '#fafafa',
    minHeight: 140,
  },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  imagePlaceholderText: { fontSize: 14, color: '#FF8000', fontWeight: '600', marginTop: 8 },
  imagePlaceholderSub:  { fontSize: 11, color: '#aaa', marginTop: 4 },
  idImagePreview: { width: '100%', height: 180 },
  changeImageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-end', marginTop: 6,
  },
  changeImageText: { fontSize: 12, color: '#FF8000', fontWeight: '600' },
  ocrHintRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10,
  },
  ocrHintText: { flex: 1, fontSize: 12, color: '#888', lineHeight: 16 },

  busyBox:  { alignItems: 'center', marginTop: 24, gap: 10 },
  busyText: { fontSize: 13, color: '#888' },

  submitBtn: {
    backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16,
  },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backLink:      { alignItems: 'center', marginTop: 22 },
  backLinkText:  { fontSize: 14, color: '#FF8000', fontWeight: '600' },
});
