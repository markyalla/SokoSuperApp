import React, { useState, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../../src/components/Text';
import { TextInput } from '../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../src/config/api';
import { accountService } from '../../src/store/accountService';
import { useAuthStore } from '../../src/store/authStore';

const OTP_LENGTH = 6;

export default function VerifyOTPScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // mode=register: verifying a new sign-up (success logs in).
  // Otherwise: the forgot-password flow (success leads to reset-password).
  const { email, mode } = useLocalSearchParams<{ email: string; mode?: string }>();
  const isSignup = mode === 'register';
  const { setAuth } = useAuthStore();

  const [digits, setDigits]   = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const inputs = useRef<Array<React.ElementRef<typeof TextInput> | null>>([]);

  const handleChange = (text: string, index: number) => {
    const digit = text.replace(/[^0-9]/g, '').slice(-1);
    const next  = [...digits];
    next[index] = digit;
    setDigits(next);
    if (digit && index < OTP_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const otp = digits.join('');

  const handleVerify = async () => {
    if (otp.length < OTP_LENGTH) {
      Alert.alert('Incomplete', 'Please enter all 6 digits.');
      return;
    }
    setLoading(true);
    if (isSignup) {
      try {
        const res = await accountService.verifyEmail(email, otp);
        await setAuth(res.tokens, res.user, res.kyc_status);
        router.replace('/home');
        const kycDone = res.kyc_status === 'approved' || res.kyc_status === 'submitted';
        setTimeout(() => {
          Alert.alert(
            'Email verified ✅',
            kycDone
              ? 'Welcome to MySokoApp! Your account is ready.'
              : "Welcome to MySokoApp! Explore the apps — to place orders, book deliveries or hire artisans you'll need to verify your identity.",
            kycDone
              ? [{ text: 'OK' }]
              : [
                  { text: 'Later', style: 'cancel' },
                  { text: 'Verify now', onPress: () => router.push('/(auth)/kyc' as any) },
                ],
          );
        }, 400);
      } catch (err: any) {
        setDigits(Array(OTP_LENGTH).fill(''));
        inputs.current[0]?.focus();
        Alert.alert('Invalid Code', err?.response?.data?.error || err?.message || 'Please try again.');
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      const res  = await fetch(`${API_BASE_URL}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Verification failed');
      // The API exchanges the OTP for a one-time token that reset-password requires.
      router.replace({ pathname: '/(auth)/reset-password', params: { email, resetToken: json.reset_token } });
    } catch (err: any) {
      Alert.alert('Invalid Code', err.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      if (isSignup) {
        await accountService.resendVerification(email);
      } else {
        await fetch(`${API_BASE_URL}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
      }
      setDigits(Array(OTP_LENGTH).fill(''));
      inputs.current[0]?.focus();
      Alert.alert('Sent', 'A new code has been sent to your email.');
    } catch {
      Alert.alert('Error', 'Failed to resend. Try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

        <View style={[styles.topSection, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.logoBox}>
            <Ionicons name="keypad-outline" size={28} color="#fff" />
          </View>
          <Text style={styles.brand}>{isSignup ? 'Verify your email' : 'Enter OTP'}</Text>
          <Text style={styles.tagline}>Code sent to {email}</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formTitle}>Check your email</Text>
          <Text style={styles.formSubtitle}>
            Enter the 6-digit code we sent to{'\n'}
            <Text style={{ color: '#FF8000', fontWeight: '600' }}>{email}</Text>
          </Text>

          <View style={styles.otpRow}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={(r) => { inputs.current[i] = r; }}
                style={[styles.otpBox, d ? styles.otpBoxFilled : null]}
                value={d}
                onChangeText={(t) => handleChange(t, i)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
                keyboardType="number-pad"
                maxLength={1}
                textAlign="center"
                selectTextOnFocus
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.btn, (loading || otp.length < OTP_LENGTH) && { opacity: 0.7 }]}
            onPress={handleVerify}
            disabled={loading || otp.length < OTP_LENGTH}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.btnText}>Verify Code</Text>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                </>
            }
          </TouchableOpacity>

          <View style={styles.resendRow}>
            <Text style={styles.resendLabel}>Didn't get a code? </Text>
            <TouchableOpacity onPress={handleResend} disabled={resending}>
              {resending
                ? <ActivityIndicator size="small" color="#FF8000" />
                : <Text style={styles.resendLink}>Resend</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: '#fff' },
  container:    { flex: 1, backgroundColor: '#f5f5f5' },
  topSection:   {
    backgroundColor: '#FF8000', paddingTop: 16, paddingBottom: 44,
    alignItems: 'center', borderBottomLeftRadius: 36, borderBottomRightRadius: 36,
    position: 'relative',
  },
  backBtn:      { position: 'absolute', top: 16, left: 20, padding: 4 },
  logoBox:      {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center',
    justifyContent: 'center', marginBottom: 10,
  },
  brand:        { fontSize: 22, fontWeight: '700', color: '#fff' },
  tagline:      { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  form:         { flex: 1, padding: 24, paddingTop: 32 },
  formTitle:    { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  formSubtitle: { fontSize: 14, color: '#888', marginBottom: 32, lineHeight: 22 },

  otpRow:       { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 32 },
  otpBox:       {
    width: 46, height: 56, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#e0e0e0',
    backgroundColor: '#fff', fontSize: 22, fontWeight: '700', color: '#111827',
  },
  otpBoxFilled: { borderColor: '#FF8000', backgroundColor: '#fff8f0' },

  btn:          {
    backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  btnText:      { color: '#fff', fontSize: 16, fontWeight: '600' },

  resendRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  resendLabel:  { fontSize: 14, color: '#888' },
  resendLink:   { fontSize: 14, color: '#FF8000', fontWeight: '600' },
});
