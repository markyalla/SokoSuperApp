import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, StatusBar, Image } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { createPortfolioItem, updatePortfolioItem, listMyPortfolio } from '../../../src/api';
import { useAuthStore } from '../../../src/store/authStore';
import { API_BASE_URL } from '../../../src/config/api';

// Creating a brand-new portfolio item always happens from here via SokoIndex.
// Editing an existing item (from SokoAccount) passes ?id=<portfolioId> to
// prefill the form and PUT instead of POST.
export default function CreatePortfolioScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tokens } = useAuthStore() as any;

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<[string, string, string, string]>(['', '', '', '']);
  const [previews, setPreviews] = useState<[string, string, string, string]>(['', '', '', '']);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const res = await listMyPortfolio();
        const item = (res.data ?? []).find((p: any) => p.id === id);
        if (item) {
          setTitle(item.title);
          setDescription(item.description ?? '');
          const paths: [string, string, string, string] = [
            item.image_path_1 ?? '', item.image_path_2 ?? '', item.image_path_3 ?? '', item.image_path_4 ?? '',
          ];
          setImages(paths);
          setPreviews(paths);
        }
      } catch {
        Alert.alert('Error', 'Could not load this portfolio item.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  const handlePickImage = async (slot: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please grant access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';

    setUploadingSlot(slot);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: asset.uri,
        name: `portfolio.${ext}`,
        type: asset.mimeType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      } as any);
      formData.append('bucket', 'sokoindex-portfolios');

      const res = await fetch(`${API_BASE_URL}/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens?.access}`, 'Content-Type': 'multipart/form-data' },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');

      setImages((prev) => { const next = [...prev] as [string, string, string, string]; next[slot] = json.path; return next; });
      setPreviews((prev) => { const next = [...prev] as [string, string, string, string]; next[slot] = json.url; return next; });
    } catch (e: any) {
      Alert.alert('Upload failed', e.message || 'Could not upload image.');
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !images[0]) {
      Alert.alert('Error', 'A title and at least one photo are required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        image_path_1: images[0],
        image_path_2: images[1] || undefined,
        image_path_3: images[2] || undefined,
        image_path_4: images[3] || undefined,
      };
      if (isEdit) {
        await updatePortfolioItem(id, payload);
        Alert.alert('Updated', 'Your work items was updated and is pending re-approval.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        await createPortfolioItem(payload);
        Alert.alert('Submitted', 'Your works item is pending admin approval.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (e: any) {
      Alert.alert('Failed', e.response?.data?.error || 'Could not save portfolio item');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF8000" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <View style={[styles.headerBar, { paddingTop: insets.top + 14 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Edit work Item' : 'New work Items'}</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.formCard}>
          <Text style={styles.label}>Title</Text>
          <TextInput style={styles.input} placeholder="e.g. Custom wooden dining table" placeholderTextColor="#9ca3af" value={title} onChangeText={setTitle} />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe the work you did"
            placeholderTextColor="#9ca3af"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Photos (first is required, up to 4)</Text>
          <View style={styles.imagesRow}>
            {[0, 1, 2, 3].map((slot) => (
              <TouchableOpacity key={slot} style={styles.imageBox} onPress={() => handlePickImage(slot)} disabled={uploadingSlot === slot}>
                {uploadingSlot === slot ? (
                  <ActivityIndicator color="#FF8000" />
                ) : previews[slot] ? (
                  <Image source={{ uri: previews[slot] }} style={styles.imagePreview} resizeMode="cover" />
                ) : (
                  <Ionicons name="camera-outline" size={22} color="#FF8000" />
                )}
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.btn} onPress={handleSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{isEdit ? 'Save Changes' : 'Submit for Approval'}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' },
  container: { padding: 16, paddingBottom: 32, backgroundColor: '#f9fafb' },
  headerBar: { backgroundColor: '#FF8000', paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center', marginRight: 40 },
  formCard: { backgroundColor: '#fff', borderRadius: 18, padding: 16, marginTop: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  label: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14, fontSize: 15, color: '#111827',
  },
  textArea: { textAlignVertical: 'top', minHeight: 80 },
  imagesRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  imageBox: {
    flex: 1, height: 90, backgroundColor: '#fff7ed', borderWidth: 1.5, borderColor: '#FF800044',
    borderStyle: 'dashed', borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  imagePreview: { width: '100%', height: '100%' },
  btn: { backgroundColor: '#FF8000', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
