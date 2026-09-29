import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Image, ActivityIndicator, StatusBar, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../../../../src/components/Text';
import { TextInput } from '../../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getSokoIndexBooking, cancelSokoIndexBooking, confirmSokoIndexBookingCompletion,
  rateSokoIndexBooking, recommendArtisanForBooking, fileSokoIndexComplaint,
  acceptSokoIndexBooking, rejectSokoIndexBooking, completeSokoIndexBooking,
  initializeSokoIndexPayment, verifySokoIndexPayment,
} from '../../../../src/api';
import { SokoIndexBooking } from '../../../../src/types/sokoindex';
import PaystackModal from '../../../../src/components/PaystackModal';
import ImagePreviewModal from '../../../../src/components/ImagePreviewModal';
import { friendlyError } from '../../../../src/utils/friendlyError';

const STATUS_COLOR: Record<string, string> = {
  pending: '#d97706', accepted: '#2563eb', awaiting_confirmation: '#0891b2',
  completed: '#16a34a', rejected: '#dc2626', cancelled: '#6b7280',
};

type ModalKind = 'reject' | 'rate' | 'recommend' | 'complaint' | null;

export default function BookingDetailScreen() {
  const { id, as } = useLocalSearchParams<{ id: string; as?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isArtisanView = as === 'artisan';

  const [booking, setBooking] = useState<SokoIndexBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [textInput, setTextInput] = useState('');
  const [rateScore, setRateScore] = useState(5);
  const [paying, setPaying] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const fetchBooking = useCallback(async () => {
    try {
      const res = await getSokoIndexBooking(id);
      setBooking(res.data);
    } catch {
      Alert.alert('Error', 'Could not load this booking.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchBooking(); }, [fetchBooking]);

  const withBusy = async (fn: () => Promise<any>) => {
    setBusy(true);
    try { await fn(); await fetchBooking(); }
    catch (e: any) { Alert.alert('Error', friendlyError(e, 'Action failed')); }
    finally { setBusy(false); }
  };

  const handleAccept = () => withBusy(() => acceptSokoIndexBooking(id));
  const handleComplete = () => withBusy(() => completeSokoIndexBooking(id));
  const handleCancel = () => withBusy(() => cancelSokoIndexBooking(id));
  const handleConfirmCompletion = () => withBusy(() => confirmSokoIndexBookingCompletion(id));

  const handleReject = () => withBusy(async () => {
    await rejectSokoIndexBooking(id, textInput.trim());
    setModal(null); setTextInput('');
  });

  const handleRate = () => withBusy(async () => {
    await rateSokoIndexBooking(id, rateScore, textInput.trim());
    setModal(null); setTextInput(''); setRateScore(5);
    Alert.alert('Thank you', 'Your rating has been submitted.');
  });

  const handleRecommend = () => withBusy(async () => {
    await recommendArtisanForBooking(id, textInput.trim());
    setModal(null); setTextInput('');
    Alert.alert('Thanks', 'Artisan recommended.');
  });

  const handleComplaint = () => withBusy(async () => {
    if (!textInput.trim()) { Alert.alert('Error', 'Please describe the issue'); return; }
    await fileSokoIndexComplaint(id, 'general', textInput.trim());
    setModal(null); setTextInput('');
    Alert.alert('Complaint filed', 'Our team will review it shortly.');
  });

  const handleUnlockJobs = async () => {
    setPaying(true);
    try {
      const res = await initializeSokoIndexPayment('artisan_unlock');
      setPaymentRef(res.data.reference);
      setCheckoutUrl(res.data.checkout_url);
    } catch (e: any) {
      Alert.alert('Error', friendlyError(e, 'Could not start payment'));
      setPaying(false);
    }
  };

  const handlePaymentDone = async () => {
    try { await verifySokoIndexPayment(paymentRef); } catch { /* webhook may already have settled it */ }
    setPaying(false);
    fetchBooking();
  };

  if (loading || !booking) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#FF8000" /></View>;
  }

  const color = STATUS_COLOR[booking.status] ?? '#9ca3af';
  const jobsLocked = isArtisanView && !!booking.contact_unlock_required && !booking.artisan_unlocked;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Booking Details</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <View style={styles.identityRow}>
              {booking.artisan?.profile_image_path ? (
                <TouchableOpacity onPress={() => setPreviewImage(booking.artisan!.profile_image_path)}>
                  <Image source={{ uri: booking.artisan.profile_image_path }} style={styles.avatar} />
                </TouchableOpacity>
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="hammer-outline" size={18} color="#FF8000" />
                </View>
              )}
              <Text style={styles.artisanName}>{booking.artisan?.display_name ?? 'Artisan'}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: color + '22' }]}>
              <Text style={[styles.statusText, { color }]}>{booking.status.replace(/_/g, ' ')}</Text>
            </View>
          </View>
          <Text style={styles.trade}>{booking.artisan?.trade_category}</Text>
          <Text style={styles.label}>Job Description</Text>
          <Text style={styles.desc}>{booking.description}</Text>

          {booking.status === 'rejected' && booking.rejection_reason ? (
            <View style={styles.noteBox}>
              <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
              <Text style={styles.noteText}>{booking.rejection_reason}</Text>
            </View>
          ) : null}

          {!isArtisanView && booking.artisan_phone ? (
            <View style={styles.phoneBox}>
              <Ionicons name="call-outline" size={16} color="#16a34a" />
              <Text style={styles.phoneText}>{booking.artisan_phone}</Text>
            </View>
          ) : null}
        </View>

        {/* Customer details, shown to the artisan so bookings feel like a real request */}
        {isArtisanView && booking.customer && (
          <View style={styles.card}>
            <Text style={styles.label}>Booked By</Text>
            <View style={styles.identityRow}>
              {booking.customer.profile_image_url ? (
                <TouchableOpacity onPress={() => setPreviewImage(booking.customer!.profile_image_url ?? null)}>
                  <Image source={{ uri: booking.customer.profile_image_url }} style={styles.avatar} />
                </TouchableOpacity>
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person-outline" size={18} color="#FF8000" />
                </View>
              )}
              <Text style={styles.artisanName}>{booking.customer.full_name}</Text>
            </View>
            {booking.customer.phone_number ? (
              <View style={styles.phoneBox}>
                <Ionicons name="call-outline" size={16} color="#16a34a" />
                <Text style={styles.phoneText}>{booking.customer.phone_number}</Text>
              </View>
            ) : null}
            {booking.customer.email ? (
              <View style={[styles.phoneBox, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="mail-outline" size={16} color="#2563eb" />
                <Text style={[styles.phoneText, { color: '#2563eb' }]}>{booking.customer.email}</Text>
              </View>
            ) : null}
            {booking.customer.location_text ? (
              <View style={[styles.phoneBox, { backgroundColor: '#f9fafb' }]}>
                <Ionicons name="location-outline" size={16} color="#6b7280" />
                <Text style={[styles.phoneText, { color: '#6b7280' }]}>{booking.customer.location_text}</Text>
              </View>
            ) : null}
            {jobsLocked ? (
              <TouchableOpacity style={styles.unlockBox} onPress={handleUnlockJobs} disabled={paying}>
                <Ionicons name="lock-closed-outline" size={16} color="#FF8000" />
                {paying ? <ActivityIndicator color="#FF8000" /> : (
                  <Text style={styles.unlockText}>Unlock incoming jobs to see contact info & respond</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Artisan actions */}
        {isArtisanView && (
          <View style={styles.actionsCard}>
            {booking.status === 'pending' && jobsLocked && (
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleUnlockJobs} disabled={paying}>
                {paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Unlock to Accept or Reject</Text>}
              </TouchableOpacity>
            )}
            {booking.status === 'pending' && !jobsLocked && (
              <View style={styles.row}>
                <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleAccept} disabled={busy}>
                  <Text style={styles.btnPrimaryText}>Accept</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnOutlineDanger]} onPress={() => setModal('reject')} disabled={busy}>
                  <Text style={styles.btnOutlineDangerText}>Reject</Text>
                </TouchableOpacity>
              </View>
            )}
            {booking.status === 'accepted' && (
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleComplete} disabled={busy}>
                <Text style={styles.btnPrimaryText}>Mark Job Complete</Text>
              </TouchableOpacity>
            )}
            {booking.status === 'awaiting_confirmation' && (
              <Text style={styles.hintText}>Waiting for customer to confirm completion.</Text>
            )}
          </View>
        )}

        {/* Customer actions */}
        {!isArtisanView && (
          <View style={styles.actionsCard}>
            {booking.status === 'pending' && (
              <TouchableOpacity style={[styles.btn, styles.btnOutlineDanger]} onPress={handleCancel} disabled={busy}>
                <Text style={styles.btnOutlineDangerText}>Cancel Booking</Text>
              </TouchableOpacity>
            )}
            {booking.status === 'awaiting_confirmation' && (
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleConfirmCompletion} disabled={busy}>
                <Text style={styles.btnPrimaryText}>Confirm Work Completed</Text>
              </TouchableOpacity>
            )}
            {booking.status === 'completed' && (
              <View style={{ gap: 10 }}>
                <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setModal('rate')} disabled={busy}>
                  <Text style={styles.btnPrimaryText}>Rate this Artisan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setModal('recommend')} disabled={busy}>
                  <Text style={styles.btnOutlineText}>Recommend Artisan</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnOutlineDanger]} onPress={() => setModal('complaint')} disabled={busy}>
                  <Text style={styles.btnOutlineDangerText}>Report a Problem</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Reject reason / Rate / Recommend / Complaint modal */}
      <Modal visible={!!modal} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            {modal === 'reject' && (
              <>
                <Text style={styles.modalTitle}>Reason for rejecting</Text>
                <TextInput style={styles.modalInput} placeholder="Let the customer know why" value={textInput} onChangeText={setTextInput} multiline numberOfLines={3} />
                <TouchableOpacity style={styles.modalSubmit} onPress={handleReject} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Reject Booking</Text>}
                </TouchableOpacity>
              </>
            )}
            {modal === 'rate' && (
              <>
                <Text style={styles.modalTitle}>Rate this artisan</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => setRateScore(s)}>
                      <Ionicons name={s <= rateScore ? 'star' : 'star-outline'} size={30} color="#f59e0b" />
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={styles.modalInput} placeholder="Optional comment" value={textInput} onChangeText={setTextInput} multiline numberOfLines={3} />
                <TouchableOpacity style={styles.modalSubmit} onPress={handleRate} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Submit Rating</Text>}
                </TouchableOpacity>
              </>
            )}
            {modal === 'recommend' && (
              <>
                <Text style={styles.modalTitle}>Recommend this artisan</Text>
                <TextInput style={styles.modalInput} placeholder="Why would you recommend them? (optional)" value={textInput} onChangeText={setTextInput} multiline numberOfLines={3} />
                <TouchableOpacity style={styles.modalSubmit} onPress={handleRecommend} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>Recommend</Text>}
                </TouchableOpacity>
              </>
            )}
            {modal === 'complaint' && (
              <>
                <Text style={styles.modalTitle}>What went wrong?</Text>
                <TextInput style={styles.modalInput} placeholder="Describe the issue" value={textInput} onChangeText={setTextInput} multiline numberOfLines={4} />
                <TouchableOpacity style={[styles.modalSubmit, { backgroundColor: '#dc2626' }]} onPress={handleComplaint} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>File Complaint</Text>}
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity onPress={() => { setModal(null); setTextInput(''); }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <PaystackModal
        visible={!!checkoutUrl && paying}
        checkoutUrl={checkoutUrl}
        onClose={() => setPaying(false)}
        onDone={handlePaymentDone}
      />

      <ImagePreviewModal
        visible={!!previewImage}
        images={previewImage ? [previewImage] : []}
        onClose={() => setPreviewImage(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: '#FF8000', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
  artisanName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  trade: { fontSize: 12, color: '#FF8000', fontWeight: '600', marginTop: 2, marginBottom: 12 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  label: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', marginBottom: 4 },
  desc: { fontSize: 14, color: '#374151', lineHeight: 20 },
  noteBox: { flexDirection: 'row', gap: 8, backgroundColor: '#fef2f2', borderRadius: 10, padding: 10, marginTop: 12 },
  noteText: { flex: 1, fontSize: 12, color: '#991b1b' },
  phoneBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f0fdf4', borderRadius: 10, padding: 10, marginTop: 12 },
  phoneText: { fontSize: 14, fontWeight: '700', color: '#16a34a' },
  unlockBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff7ed', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FF8000' },
  unlockText: { fontSize: 12, fontWeight: '700', color: '#FF8000', flexShrink: 1, textAlign: 'center' },
  actionsCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16 },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#FF8000' },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnOutline: { backgroundColor: '#FF8000' },
  btnOutlineText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnOutlineDanger: { borderWidth: 1.5, borderColor: '#dc2626' },
  btnOutlineDangerText: { color: '#dc2626', fontWeight: '700', fontSize: 14 },
  hintText: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  modalInput: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#111827', textAlignVertical: 'top', minHeight: 80,
  },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 14 },
  modalSubmit: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  modalSubmitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalCancel: { textAlign: 'center', color: '#6b7280', fontSize: 13, marginTop: 12 },
});
