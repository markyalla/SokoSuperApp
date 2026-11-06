import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { createSusuGroup } from '../../../src/api';

type CyclePeriod = 'weekly' | 'monthly';

export default function CreateGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cyclePeriod, setCyclePeriod] = useState<CyclePeriod>('monthly');
  const [maxMembers, setMaxMembers] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !amount || !maxMembers) {
      Alert.alert('Validation', 'Please fill in all fields.');
      return;
    }

    const parsedAmount = parseFloat(amount);
    const parsedMax = parseInt(maxMembers, 10);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Validation', 'Enter a valid contribution amount.');
      return;
    }
    if (isNaN(parsedMax) || parsedMax < 2 || parsedMax > 50) {
      Alert.alert('Validation', 'Max members must be between 2 and 50.');
      return;
    }

    try {
      setLoading(true);
      await createSusuGroup({
        name: name.trim(),
        contribution_amount: parsedAmount,
        cycle_period: cyclePeriod,
        max_members: parsedMax,
      });
      Alert.alert('Success', 'Group created! Share the group with friends to fill positions.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Failed to create group.';
      Alert.alert('Error', msg);
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
        <Text style={styles.headerTitle}>Create Group</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

          <Text style={styles.label}>Group Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Family Savings Club"
            placeholderTextColor="#9ca3af"
            value={name}
            onChangeText={setName}
            maxLength={150}
          />

          <Text style={styles.label}>Contribution Amount (GH₵)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 100.00"
            placeholderTextColor="#9ca3af"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Cycle Period</Text>
          <View style={styles.toggle}>
            {(['weekly', 'monthly'] as CyclePeriod[]).map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.toggleOption, cyclePeriod === c && styles.toggleActive]}
                onPress={() => setCyclePeriod(c)}
              >
                <Text style={[styles.toggleText, cyclePeriod === c && styles.toggleTextActive]}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Max Members (2 – 50)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 10"
            placeholderTextColor="#9ca3af"
            value={maxMembers}
            onChangeText={setMaxMembers}
            keyboardType="number-pad"
          />

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color="#1D9E75" />
            <Text style={styles.infoText}>
              You will be assigned position #1 as the group admin. The group opens for others to join once created.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.createBtn, loading && { opacity: 0.7 }]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.createBtnText}>Create Group</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
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
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '700' },
  form: { padding: 20, gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4, marginTop: 12 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 4,
  },
  toggleOption: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  toggleActive: { backgroundColor: '#fff' },
  toggleText: { fontSize: 14, color: '#9ca3af', fontWeight: '500' },
  toggleTextActive: { color: '#FF8000', fontWeight: '700' },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#ecfdf5',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
    alignItems: 'flex-start',
  },
  infoText: { flex: 1, fontSize: 13, color: '#374151', lineHeight: 19 },
  createBtn: {
    backgroundColor: '#FF8000',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
