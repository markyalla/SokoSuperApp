import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Image, StatusBar, Alert, ActivityIndicator, Modal } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../../src/store/authStore';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../../src/config/api';
import { updateProfile, deleteAccount } from '../../../src/api';
import { useAuthedImage } from '../../../src/hooks/useAuthedImage';
import { friendlyError } from '../../../src/utils/friendlyError';

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Read the first non-null, non-empty-string key from obj.
 * Handles both snake_case (new, after models.go json tags) and
 * PascalCase (old data already persisted in SecureStore before the fix).
 */
function pick(obj: any, ...keys: string[]): any {
  if (obj == null) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return 'N/A'; }
}

function kycColor(status?: string) {
  switch (status?.toLowerCase()) {
    case 'approved':     return '#16a34a';
    case 'pending':      return '#d97706';
    case 'under_review': return '#2563eb';
    case 'rejected':     return '#dc2626';
    default:             return '#9ca3af';
  }
}

function driverStatusColor(status?: string) {
  switch (status?.toLowerCase()) {
    case 'active':    return '#16a34a';
    case 'pending':   return '#d97706';
    case 'suspended': return '#dc2626';
    case 'offline':   return '#9ca3af';
    default:          return '#9ca3af';
  }
}

// ─── sub-components ──────────────────────────────────────────────────────────

function InfoRow({
  icon, label, value, children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={16} color="#FF8000" />
      </View>
      <View style={styles.infoBody}>
        <Text style={styles.infoLabel}>{label}</Text>
        {children ?? <Text style={styles.infoValue}>{value || 'N/A'}</Text>}
      </View>
    </View>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.badgeText}>{label.replace(/_/g, ' ').toUpperCase()}</Text>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

// ─── main screen ─────────────────────────────────────────────────────────────

export default function AccountScreen() {
  const router   = useRouter();
  const insets = useSafeAreaInsets();
  const { user: storeUser, kycStatus, clearAuth, tokens, updateUser, refreshUser } = useAuthStore() as any;
  const [avatarUploading, setAvatarUploading] = useState(false);

  // driver_profile.rating (and other server-computed fields) only change
  // server-side — refetch on every focus so they don't stay frozen at
  // whatever they were at login.
  useFocusEffect(
    useCallback(() => { refreshUser(); }, []),
  );

  // The store saves res.user directly (from setAuth(res.tokens, res.user, res.kyc_status)).
  // However some older sessions might have saved the full response object.
  // Normalise both shapes here.
  const u = storeUser?.user ?? storeUser ?? {};

  // ── Personal ──────────────────────────────────────────────────────────────
  const displayName  = pick(u, 'full_name', 'FullName', 'name') ?? 'Guest';
  const email        = pick(u, 'email', 'Email')                ?? 'Not available';
  const phone        = pick(u, 'phone_number', 'PhoneNumber')    ?? 'N/A';
  const gender       = (pick(u, 'gender', 'Gender') ?? 'N/A').toString().replace(/_/g, ' ');
  const dob          = pick(u, 'date_of_birth', 'DateOfBirth');
  // Empty string means no upload — treat as absent
  const profileImage = pick(u, 'profile_image_url', 'ProfileImageURL', 'profile_image');
  const profileImageURL = profileImage
    ? (profileImage.startsWith('http') ? profileImage : `${API_BASE_URL}/media/serve/${profileImage}`)
    : null;

  // ── Roles ─────────────────────────────────────────────────────────────────
  const roles: string[] = Array.isArray(u?.roles) ? u.roles : [];
  const isDriver: boolean =
    u?.is_driver === true || roles.some(r => r === 'driver');
  const isArtisan: boolean = roles.some(r => r === 'artisan');

  // ── KYC ───────────────────────────────────────────────────────────────────
  // Always show kycData even if status is pending/rejected
  const kycData = pick(u, 'kyc', 'KYC');
  const kycIDNumber = pick(kycData, 'id_number', 'IDNumber');
  const kycIDType   = pick(kycData, 'id_type', 'IDType', 'idType', 'document_type', 'DocumentType');
  const kycAddress  = pick(kycData, 'address',   'Address');
  const kycCity     = pick(kycData, 'city',       'City');
  const kycCountry  = pick(kycData, 'country',    'Country');
  const kycFullName = pick(kycData, 'full_name',  'FullName');
  const kycStatus_  = pick(kycData, 'status',     'Status') ?? kycStatus;
  const kycRejectionReason = pick(kycData, 'rejection_reason', 'RejectionReason');
  const kycAddress_full = [kycAddress, kycCity, kycCountry].filter(Boolean).join(', ');
  const kycIDImagePath = pick(kycData, 'id_image_url', 'IDImageURL');
  const kycIDImageURL = kycIDImagePath
    ? (kycIDImagePath.startsWith('http')
        ? kycIDImagePath
        : `${API_BASE_URL}/media/serve/${kycIDImagePath.replace(/^\/+/, '')}`)
    : null;
  // KYC photos are private — fetched with the user's token, then shown.
  const { uri: kycIDImageData, failed: kycIDImageFailed } = useAuthedImage(kycIDImageURL, tokens?.access);

  // ── Driver ────────────────────────────────────────────────────────────────
  // Always show driver data regardless of approval status
  const dp              = pick(u, 'driver_profile', 'DriverProfile');
  const dpStatus        = pick(dp, 'status',          'Status');
  const dpVehicleType   = pick(dp, 'vehicle_type',    'VehicleType');
  const dpVehicleModel  = pick(dp, 'vehicle_model',   'VehicleModel',  'vehicle_name');
  const dpVehiclePlate  = pick(dp, 'vehicle_plate',   'VehiclePlate');
  const dpVehicleColor  = pick(dp, 'vehicle_color',   'VehicleColor');
  const dpLicense       = pick(dp, 'license_number',  'LicenseNumber');
  const dpRating        = pick(dp, 'rating',          'Rating');
  const dpDeliveries    = pick(dp, 'total_deliveries','TotalDeliveries');
  const dpIsOnline      = dp?.is_online   ?? dp?.IsOnline   ?? false;
  const dpIsAvailable   = dp?.is_available ?? dp?.IsAvailable ?? false;

  // ── Profile photo ────────────────────────────────────────────────────────
  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please grant access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: `avatar.${ext}`,
        type: asset.mimeType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      } as any);
      formData.append('bucket', 'avatars');

      const res = await fetch(`${API_BASE_URL}/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens?.access}`, 'Content-Type': 'multipart/form-data' },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');

      // Persist the relative path server-side, but reflect the ready-to-use
      // full URL locally right away so the new photo shows without a reload.
      await updateProfile({ profile_image_url: json.path });
      await updateUser({ profile_image_url: json.url });
    } catch (e: any) {
      Alert.alert('Upload failed', friendlyError(e, 'Could not update your profile photo.'));
    } finally {
      setAvatarUploading(false);
    }
  };

  // ── Delete account (Google Play requirement) ─────────────────────────────
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      Alert.alert('Password required', 'Enter your password to confirm.');
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount(deletePassword);
      setDeleteModal(false);
      await clearAuth();
      Alert.alert('Account deleted', 'Your account and personal data have been deleted.');
      router.replace('/(auth)/login');
    } catch (e: any) {
      Alert.alert('Could not delete account', friendlyError(e, 'Please try again.'));
    } finally {
      setDeleting(false);
      setDeletePassword('');
    }
  };

  // ── Sign out ──────────────────────────────────────────────────────────────
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => { await clearAuth(); router.replace('/(auth)/login'); },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Account</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Hero card ────────────────────────────────────────────────────── */}
        <View style={styles.heroCard}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handlePickAvatar}
            disabled={avatarUploading}
            activeOpacity={0.8}
          >
            {profileImageURL ? (
              <Image
                source={{ uri: profileImageURL }}
                style={styles.avatar}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarInitial}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            {avatarUploading ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : (
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.heroName}>{displayName}</Text>
          <Text style={styles.heroEmail}>{email}</Text>

          <View style={styles.chipRow}>
            {roles.length > 0 ? (
              roles.map(r => (
                <View
                  key={r}
                  style={[
                    styles.chip,
                    r === 'driver' ? styles.chipDriver : r === 'artisan' ? styles.chipArtisan : styles.chipUser,
                  ]}
                >
                  <Text style={styles.chipText}>
                    {r === 'driver' ? '🚗  Driver' : r === 'artisan' ? '🛠️  Artisan' : '👤  User'}
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.chipUser}>
                <Text style={styles.chipText}>👤  User</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Personal Details ──────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionTitle title="Personal Details" />

          <InfoRow icon="person-outline"     label="Full Name"     value={displayName} />
          <InfoRow icon="mail-outline"        label="Email Address" value={email} />
          <InfoRow icon="call-outline"        label="Phone Number"  value={phone} />
          <InfoRow icon="male-female-outline" label="Gender"        value={gender} />
          <InfoRow icon="calendar-outline"    label="Date of Birth" value={formatDate(dob)} />

          <InfoRow icon="image-outline" label="Profile Photo">
            {profileImageURL ? (
              <Image source={{ uri: profileImageURL }} style={styles.photoThumb} resizeMode="cover" />
            ) : (
              <Text style={styles.noPhotoText}>No photo uploaded</Text>
            )}
          </InfoRow>
        </View>

        {/* ── KYC Verification ─────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => router.push('/(auth)/kyc' as any)}
        >
          {/* Header row with status badge */}
          <View style={styles.cardHeaderRow}>
            <SectionTitle title="Verification" />
            <View style={styles.cardHeaderRight}>
              <Badge
                label={String(kycStatus_ ?? 'Not Submitted')}
                color={kycColor(String(kycStatus_ ?? ''))}
              />
              <Ionicons name="chevron-forward" size={16} color="#d1d5db" style={{ marginLeft: 4 }} />
            </View>
          </View>

          {/* Always render KYC details if the object exists, regardless of status */}
          {kycData ? (
            <View style={styles.subSection}>
              {kycFullName ? (
                <InfoRow icon="person-outline" label="Verified Name" value={String(kycFullName)} />
              ) : null}
              <InfoRow
                icon="finger-print-outline"
                label="ID Type"
                value={kycIDType ? String(kycIDType).replace(/_/g, ' ').toUpperCase() : 'Not provided'}
              />
              <InfoRow
                icon="card-outline"
                label="ID Number"
                value={kycIDNumber ? String(kycIDNumber) : 'Not provided'}
              />
              <InfoRow
                icon="location-outline"
                label="Address"
                value={kycAddress_full || 'Not provided'}
              />
              <InfoRow icon="id-card-outline" label="ID Document">
                {kycIDImageData ? (
                  <Image source={{ uri: kycIDImageData }} style={styles.idImageThumb} resizeMode="cover" />
                ) : kycIDImageURL && !kycIDImageFailed ? (
                  <ActivityIndicator color="#FF8000" />
                ) : kycIDImageURL ? (
                  <Text style={styles.noPhotoText}>Couldn't load ID image</Text>
                ) : (
                  <Text style={styles.noPhotoText}>No image uploaded</Text>
                )}
              </InfoRow>
              {kycRejectionReason ? (
                <View style={styles.rejectionBox}>
                  <Ionicons name="alert-circle-outline" size={15} color="#FF8000" />
                  <Text style={styles.rejectionText}>{String(kycRejectionReason)}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Text style={styles.emptyText}>No Verification submission found. Tap to submit.</Text>
          )}
        </TouchableOpacity>

        {/* ── Driver Information ───────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <SectionTitle title="Driver Information" />
            {dp && (
              <Badge
                label={String(dpStatus ?? 'Submitted')}
                color={driverStatusColor(String(dpStatus ?? ''))}
              />
            )}
          </View>

          {dp ? (
            <>
              {/* Vehicle details — always visible regardless of approval */}
              <InfoRow icon="car-sport-outline" label="Vehicle Type"  value={dpVehicleType  ? String(dpVehicleType)  : 'N/A'} />
              <InfoRow icon="car-outline"        label="Vehicle Model" value={dpVehicleModel ? String(dpVehicleModel) : 'N/A'} />
              <InfoRow icon="color-palette-outline" label="Colour"    value={dpVehicleColor ? String(dpVehicleColor) : 'N/A'} />
              <InfoRow icon="list-outline"       label="Number Plate" value={dpVehiclePlate  ? String(dpVehiclePlate)  : 'N/A'} />
              <InfoRow icon="card-outline"       label="License No."  value={dpLicense       ? String(dpLicense)       : 'N/A'} />

              {/* Stats row */}
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{dpRating ?? '5.00'}</Text>
                  <Text style={styles.statLabel}>Rating</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{dpDeliveries ?? 0}</Text>
                  <Text style={styles.statLabel}>Deliveries</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: dpIsOnline ? '#FF8000' : '#9ca3af' }]}>
                    {dpIsOnline ? 'Yes' : 'No'}
                  </Text>
                  <Text style={styles.statLabel}>Online</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: dpIsAvailable ? '#FF8000' : '#9ca3af' }]}>
                    {dpIsAvailable ? 'Yes' : 'No'}
                  </Text>
                  <Text style={styles.statLabel}>Available</Text>
                </View>
              </View>

              {/* CTA depending on whether the driver role is active */}
              {isDriver ? (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.push('/driver/DriverDashboardScreen' as any)}
                >
                  <Ionicons name="speedometer-outline" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>View Assigned Orders</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.pendingBox}>
                  <Ionicons name="time-outline" size={15} color="#d97706" />
                  <Text style={styles.pendingText}>
                    Application is <Text style={{ fontWeight: '700' }}>
                      {String(dpStatus ?? 'pending').replace(/_/g, ' ')}
                    </Text> — awaiting admin review
                  </Text>
                </View>
              )}
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>
                Earn extra income delivering with SokoApp. Apply once, start earning fast.
              </Text>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => router.push('/driver/ApplyDriverScreen' as any)}
              >
                <Ionicons name="bicycle-outline" size={16} color="#fff" />
                <Text style={styles.outlineBtnText}>Apply to become a Driver</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── SokoIndex Artisan Portfolio ──────────────────────────────────── */}
        <View style={styles.card}>
          <SectionTitle title="Artisan Work" />
          {isArtisan ? (
            <>
              <Text style={styles.emptyText}>
                Manage your public profile, edit your work samples, and view booking requests.
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => router.push('/sokoindex/my-portfolio' as any)}
              >
                <Ionicons name="briefcase-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>View My Work</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.emptyText}>
                Are you a skilled artisan? List your services on SokoIndex and get booked by customers nearby.
              </Text>
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => router.push('/sokoindex/apply' as any)}
              >
                <Ionicons name="hammer-outline" size={16} color="#fff" />
                <Text style={styles.outlineBtnText}>Apply to become an Artisan</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── Sign out ─────────────────────────────────────────────────────── */}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteLink} onPress={() => setDeleteModal(true)}>
          <Text style={styles.deleteLinkText}>Delete my account</Text>
        </TouchableOpacity>

        <View style={{ height: 48 }} />
      </ScrollView>

      <Modal visible={deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Ionicons name="warning-outline" size={36} color="#dc2626" style={{ alignSelf: 'center' }} />
            <Text style={styles.modalTitle}>Delete your account?</Text>
            <Text style={styles.modalBody}>
              This permanently deletes your profile, photos, ID/KYC details and saved sessions. It cannot be undone.
              Records of past orders and payments are kept in anonymised form where the law requires it.
              Cash out any driver or shop earnings first.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter your password to confirm"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              value={deletePassword}
              onChangeText={setDeletePassword}
              editable={!deleting}
            />
            <TouchableOpacity style={styles.modalDeleteBtn} onPress={handleDeleteAccount} disabled={deleting}>
              {deleting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.modalDeleteText}>Delete permanently</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setDeleteModal(false); setDeletePassword(''); }} disabled={deleting}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
    </SafeAreaView>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  deleteLink:      { alignSelf: 'center', marginTop: 18, padding: 8 },
  deleteLinkText:  { color: '#dc2626', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  modalBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard:       { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  modalTitle:      { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center', marginTop: 8 },
  modalBody:       { fontSize: 14, color: '#4b5563', lineHeight: 20, marginTop: 10, textAlign: 'center' },
  modalInput:      { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginTop: 16, fontSize: 15, color: '#111827' },
  modalDeleteBtn:  { backgroundColor: '#dc2626', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  modalDeleteText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalCancelBtn:  { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  modalCancelText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  safe:        { flex: 1, backgroundColor: '#fff' },
  container:   { flex: 1, backgroundColor: '#f3f4f6' },

  header:      { backgroundColor: '#FF8000', paddingTop: 14, paddingBottom: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn:     { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },

  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingTop: 20 },

  // ── Hero
  heroCard:      { backgroundColor: '#fff', borderRadius: 20, alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, marginBottom: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  avatarWrap:    { marginBottom: 14, position: 'relative' },
  avatar:        { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: '#1D9E75', overflow: 'hidden' },
  avatarFallback:{ backgroundColor: '#FF8000', justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 45, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#FF8000', borderWidth: 2, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  heroName:      { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 },
  heroEmail:     { fontSize: 13, color: '#6b7280', marginBottom: 14 },
  chipRow:       { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  chip:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  chipUser:      { backgroundColor: '#dcfce7' },
  chipDriver:    { backgroundColor: '#dbeafe' },
  chipArtisan:   { backgroundColor: '#fef3c7' },
  chipText:      { fontSize: 12, fontWeight: '700', color: '#374151' },

  // ── Card
  card:           { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 16, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
  cardHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardHeaderRight:{ flexDirection: 'row', alignItems: 'center' },
  sectionTitle:   { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 14 },
  subSection:     { marginTop: 8, borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 12 },

  // ── InfoRow
  infoRow:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  infoIconWrap:{ width: 30, height: 30, borderRadius: 8, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 1 },
  infoBody:    { flex: 1 },
  infoLabel:   { fontSize: 11, color: '#9ca3af', fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  infoValue:   { fontSize: 14, fontWeight: '600', color: '#1f2937' },
  noPhotoText: { fontSize: 13, color: '#9ca3af', marginTop: 2 },

  // ── Badge
  badge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  // ── Photo thumb
  photoThumb:   { width: 52, height: 52, borderRadius: 10, marginTop: 4 },
  idImageThumb: { width: 120, height: 76, borderRadius: 8, marginTop: 4, borderWidth: 1, borderColor: '#e5e7eb' },

  // ── KYC rejection
  rejectionBox:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fef2f2', padding: 10, borderRadius: 8, marginTop: 4 },
  rejectionText: { flex: 1, fontSize: 12, color: '#FF8000', lineHeight: 18 },

  // ── Empty state
  emptyText: { fontSize: 13, color: '#6b7280', lineHeight: 20, marginBottom: 14 },

  // ── Driver stats
  statsRow:    { flexDirection: 'row', backgroundColor: '#f9fafb', borderRadius: 12, padding: 14, marginBottom: 14, marginTop: 4 },
  statBox:     { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, backgroundColor: '#e5e7eb', marginHorizontal: 4 },
  statValue:   { fontSize: 15, fontWeight: '700', color: '#111827' },
  statLabel:   { fontSize: 10, color: '#9ca3af', marginTop: 3, fontWeight: '600' },

  // ── Pending box
  pendingBox:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fffbeb', padding: 12, borderRadius: 10 },
  pendingText: { flex: 1, fontSize: 13, color: '#92400e', lineHeight: 18 },

  // ── Buttons
  primaryBtn:     { backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, gap: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  outlineBtn:     { backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12, gap: 8 },
  outlineBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // ── Sign out
  signOutBtn:  { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  signOutText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
