import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, StatusBar, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text } from '../../src/components/Text';
import { TextInput } from '../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../src/config/api';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { email, resetToken } = useLocalSearchParams<{ email: string; resetToken: string }>();

  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew]                 = useState(false);
  const [showConfirm, setShowConfirm]         = useState(false);
  const [loading, setLoading]                 = useState(false);

  const handleReset = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Required', 'Please fill in both password fields.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          reset_token:      resetToken,
          new_password:     newPassword,
          confirm_password: confirmPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Reset failed');

      Alert.alert(
        'Password Updated',
        'Your password has been changed. Please log in with your new password.',
        [{ text: 'Login', onPress: () => router.replace('/(auth)/login') }],
      );
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

        <View style={[styles.topSection, { paddingTop: insets.top + 24 }]}>
          <View style={styles.logoBox}>
            <Ionicons name="shield-checkmark-outline" size={28} color="#fff" />
          </View>
          <Text style={styles.brand}>Create New Password</Text>
          <Text style={styles.tagline}>Choose a strong password to secure your account</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formTitle}>New Password</Text>
          <Text style={styles.formSubtitle}>
            Resetting password for{' '}
            <Text style={{ color: '#FF8000', fontWeight: '600' }}>{email}</Text>
          </Text>

          {/* Email — pre-filled and locked */}
          <Text style={styles.label}>EMAIL</Text>
          <View style={[styles.inputWrap, styles.inputDisabled]}>
            <Ionicons name="mail-outline" size={18} color="#bbb" style={styles.icon} />
            <TextInput
              value={email}
              editable={false}
              style={[styles.input, { color: '#9ca3af' }]}
            />
            <Ionicons name="lock-closed-outline" size={14} color="#ccc" />
          </View>

          {/* New password */}
          <Text style={styles.label}>NEW PASSWORD</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#aaa" style={styles.icon} />
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              style={[styles.input, { paddingRight: 44 }]}
              placeholder="Min. 8 characters"
              placeholderTextColor="#bbb"
              secureTextEntry={!showNew}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNew(!showNew)}>
              <Ionicons name={showNew ? 'eye-off-outline' : 'eye-outline'} size={18} color="#aaa" />
            </TouchableOpacity>
          </View>

          {/* Confirm password */}
          <Text style={styles.label}>CONFIRM PASSWORD</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={18} color="#aaa" style={styles.icon} />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              style={[styles.input, { paddingRight: 44 }]}
              placeholder="Repeat your password"
              placeholderTextColor="#bbb"
              secureTextEntry={!showConfirm}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirm(!showConfirm)}>
              <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color="#aaa" />
            </TouchableOpacity>
          </View>

          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle-outline" size={14} color="#dc2626" />
              <Text style={styles.errorText}>Passwords do not match</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={handleReset}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Text style={styles.btnText}>Save New Password</Text>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                </>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: '#fff' },
  container:     { flex: 1, backgroundColor: '#f5f5f5' },
  topSection:    {
    backgroundColor: '#FF8000', paddingTop: 24, paddingBottom: 44,
    alignItems: 'center', borderBottomLeftRadius: 36, borderBottomRightRadius: 36,
  },
  logoBox:       {
    width: 56, height: 56, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center',
    justifyContent: 'center', marginBottom: 10,
  },
  brand:         { fontSize: 22, fontWeight: '700', color: '#fff' },
  tagline:       { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4, textAlign: 'center', paddingHorizontal: 32 },

  form:          { flex: 1, padding: 24, paddingTop: 32 },
  formTitle:     { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  formSubtitle:  { fontSize: 14, color: '#888', marginBottom: 28 },

  label:         { fontSize: 11, fontWeight: '600', color: '#aaa', letterSpacing: 0.5, marginBottom: 6 },
  inputWrap:     {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderWidth: 0.5, borderColor: '#e0e0e0', borderRadius: 12,
    paddingHorizontal: 14, marginBottom: 16,
  },
  inputDisabled: { backgroundColor: '#f9fafb' },
  icon:          { marginRight: 10 },
  input:         { flex: 1, paddingVertical: 14, fontSize: 15, color: '#1a1a1a' },
  eyeBtn:        { padding: 4 },

  errorRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8, marginBottom: 12 },
  errorText:     { fontSize: 12, color: '#dc2626' },

  btn:           {
    backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 8,
  },
  btnText:       { color: '#fff', fontSize: 16, fontWeight: '600' },
});
