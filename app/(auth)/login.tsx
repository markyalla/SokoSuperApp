import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { Text } from '../../src/components/Text';
import { TextInput } from '../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { accountService } from '../../src/store/accountService';
import { useAuthStore } from '../../src/store/authStore';

export default function LoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setAuth } = useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!identifier || !password) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const res = await accountService.login(identifier, password);
      await setAuth(res.tokens, res.user, res.kyc_status);
      router.replace('/home');
      // Everyone lands on home and can browse the apps; identity verification
      // is prompted for (not forced) until it's done.
      if (res.kyc_status === 'pending' || res.kyc_status === 'rejected') {
        setTimeout(() => {
          Alert.alert(
            res.kyc_status === 'rejected' ? 'Verification needs attention' : 'Verify your identity',
            res.kyc_status === 'rejected'
              ? 'Your identity verification was not approved. Please resubmit to place orders, book deliveries or hire artisans.'
              : 'To place orders, book deliveries or hire artisans, complete your identity verification.',
            [
              { text: 'Later', style: 'cancel' },
              { text: 'Verify now', onPress: () => router.push('/(auth)/kyc' as any) },
            ],
          );
        }, 600);
      } else {
        const isDriver = res.user?.roles?.includes('driver');
        if (isDriver) {
          setTimeout(() => {
            Alert.alert(
              'Welcome back, Driver! 🚗',
              'Head to your Driver Dashboard and turn on your location to start receiving delivery requests.',
              [
                { text: 'Not now', style: 'cancel' },
                { text: 'Open Dashboard', onPress: () => router.push('/driver' as any) },
              ]
            );
          }, 600);
        }
      }
    } catch (error: any) {
      const data = error.response?.data;
      if (data?.requires_verification && data?.email) {
        // Registered but never entered the sign-up code — the server has just emailed a fresh one.
        router.push({ pathname: '/(auth)/verify-otp', params: { email: data.email, mode: 'register' } });
        Alert.alert('Verify your email', data.error || `We've sent a new code to ${data.email}.`);
        return;
      }
      Alert.alert('Login failed', error.response?.data?.error || 'Please check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePing = async () => {
    try {
      const res = await accountService.ping();
      Alert.alert('Backend reachable', `Status: ${res.status}`);
    } catch (err: any) {
      Alert.alert('Backend unreachable', err?.message || 'Network error');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.topSection, { paddingTop: insets.top + 40 }]}>
            <View style={styles.logoBox}>
              <Image source={require('../../assets/mysokoapp-logo.png')} style={styles.logoImage} resizeMode="contain" />
            </View>
            
            <Text style={styles.tagline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Your Pan-African SuperApp
            </Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Sign in</Text>
            <Text style={styles.formSubtitle}>Welcome back — enter your details below</Text>

            <Text style={styles.label}>EMAIL OR PHONE</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={18} color="#aaa" style={styles.inputIcon} />
              <TextInput
                value={identifier}
                onChangeText={setIdentifier}
                style={styles.input}
                placeholder="e.g. kofi@soko.com"
                placeholderTextColor="#bbb"
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <Text style={styles.label}>PASSWORD</Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color="#aaa" style={styles.inputIcon} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                style={[styles.input, { paddingRight: 44 }]}
                placeholder="Enter your password"
                placeholderTextColor="#bbb"
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#aaa" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.forgotRow} onPress={() => router.push('/(auth)/forgot-password')}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading} activeOpacity={0.85}>
              {loading ? <ActivityIndicator color="#fff" /> : <>
                <Text style={styles.loginBtnText}>Login</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>}
            </TouchableOpacity>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.registerRow}>
              <Text style={styles.registerText}>Don't have an account?</Text>
              <TouchableOpacity onPress={() => router.push('/register')}>
                <Text style={styles.registerLink}> Create account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  scroll: { flexGrow: 1, paddingBottom: 32 },
  topSection: { backgroundColor: '#FF8000', paddingTop: 40, paddingBottom: 56, alignItems: 'center', borderBottomLeftRadius: 36, borderBottomRightRadius: 36 },
  logoBox: { width: 220, height: 56, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 12, paddingHorizontal: 12 },
  logoImage: { width: '100%', height: '100%' },
  brand: { fontSize: 26, fontWeight: '600', color: '#fff', letterSpacing: -0.3 },
  tagline: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  formCard: { marginHorizontal: 16, marginTop: -24, backgroundColor: '#fff', borderRadius: 24, padding: 20, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  formTitle: { fontSize: 22, fontWeight: '700', color: '#111827', marginBottom: 4 },
  formSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 24 },
  label: { fontSize: 11, fontWeight: '600', color: '#9ca3af', letterSpacing: 0.5, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14, marginBottom: 16, paddingHorizontal: 14 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, paddingVertical: 14, fontSize: 15, color: '#111827' },
  eyeBtn: { padding: 4 },
  forgotRow: { alignItems: 'flex-end', marginBottom: 20, marginTop: -8 },
  forgotText: { fontSize: 13, color: '#FF8000' },
  loginBtn: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 12 },
  dividerLine: { flex: 1, height: 0.6, backgroundColor: '#e5e7eb' },
  dividerText: { fontSize: 12, color: '#9ca3af' },
  registerRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  registerText: { fontSize: 14, color: '#6b7280' },
  registerLink: { fontSize: 14, color: '#FF8000', fontWeight: '600' },
});