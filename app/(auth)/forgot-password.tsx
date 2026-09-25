import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../../src/components/Text';
import { TextInput } from '../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../src/config/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendOTP = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Request failed');
      router.push({ pathname: '/(auth)/verify-otp', params: { email: trimmed } });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      <View style={[styles.topSection, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.logoBox}>
          <Ionicons name="lock-open-outline" size={28} color="#fff" />
        </View>
        <Text style={styles.brand}>Forgot Password?</Text>
        <Text style={styles.tagline}>We'll send a reset code to your email</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.formTitle}>Enter your email</Text>
        <Text style={styles.formSubtitle}>
          We'll send a 6-digit code to confirm it's you.
        </Text>

        <Text style={styles.label}>EMAIL ADDRESS</Text>
        <View style={styles.inputWrap}>
          <Ionicons name="mail-outline" size={18} color="#aaa" style={styles.icon} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholder="e.g. kofi@soko.com"
            placeholderTextColor="#bbb"
            autoCapitalize="none"
            keyboardType="email-address"
            autoFocus
          />
        </View>

        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.7 }]}
          onPress={handleSendOTP}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <>
                <Text style={styles.btnText}>Send Reset Code</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.backLink} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.backLinkText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    </View>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#fff' },
  container:   { flex: 1, backgroundColor: '#f5f5f5' },
  topSection:  {
    backgroundColor: '#FF8000', paddingTop: 16, paddingBottom: 44,
    alignItems: 'center', borderBottomLeftRadius: 36, borderBottomRightRadius: 36,
    position: 'relative',
  },
  backBtn:     { position: 'absolute', top: 16, left: 20, padding: 4 },
  logoBox:     {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center',
    justifyContent: 'center', marginBottom: 10,
  },
  brand:       { fontSize: 22, fontWeight: '700', color: '#fff' },
  tagline:     { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },

  form:        { flex: 1, padding: 24, paddingTop: 32 },
  formTitle:   { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  formSubtitle:{ fontSize: 14, color: '#888', marginBottom: 28 },

  label:       { fontSize: 11, fontWeight: '600', color: '#aaa', letterSpacing: 0.5, marginBottom: 6 },
  inputWrap:   {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderWidth: 0.5, borderColor: '#e0e0e0', borderRadius: 12,
    paddingHorizontal: 14, marginBottom: 24,
  },
  icon:        { marginRight: 10 },
  input:       { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1a1a1a' },

  btn:         {
    backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  btnText:     { color: '#fff', fontSize: 16, fontWeight: '600' },

  backLink:    { alignItems: 'center', marginTop: 24 },
  backLinkText:{ fontSize: 14, color: '#FF8000', fontWeight: '600' },
});
