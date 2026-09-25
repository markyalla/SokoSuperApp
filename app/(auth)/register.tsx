import React, { useMemo, useState } from 'react';
import { View, TouchableOpacity, Image, StyleSheet, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Modal, FlatList } from 'react-native';
import { Text } from '../../src/components/Text';
import { TextInput } from '../../src/components/TextInput';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { accountService } from '../../src/store/accountService';
import { useAuthStore } from '../../src/store/authStore';

const GENDER_OPTIONS = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Other', value: 'other' },
  { label: 'Private', value: 'prefer_not_to_say' },
];

// Ghana first (the app's current primary market), then the rest of Africa
// alphabetically — this app is pan-African, not Ghana-only long term.
const AFRICAN_COUNTRIES = [
  { iso2: 'GH', name: 'Ghana', dialCode: '233', flag: '🇬🇭' },
  { iso2: 'DZ', name: 'Algeria', dialCode: '213', flag: '🇩🇿' },
  { iso2: 'AO', name: 'Angola', dialCode: '244', flag: '🇦🇴' },
  { iso2: 'BJ', name: 'Benin', dialCode: '229', flag: '🇧🇯' },
  { iso2: 'BW', name: 'Botswana', dialCode: '267', flag: '🇧🇼' },
  { iso2: 'BF', name: 'Burkina Faso', dialCode: '226', flag: '🇧🇫' },
  { iso2: 'BI', name: 'Burundi', dialCode: '257', flag: '🇧🇮' },
  { iso2: 'CV', name: 'Cabo Verde', dialCode: '238', flag: '🇨🇻' },
  { iso2: 'CM', name: 'Cameroon', dialCode: '237', flag: '🇨🇲' },
  { iso2: 'CF', name: 'Central African Republic', dialCode: '236', flag: '🇨🇫' },
  { iso2: 'TD', name: 'Chad', dialCode: '235', flag: '🇹🇩' },
  { iso2: 'KM', name: 'Comoros', dialCode: '269', flag: '🇰🇲' },
  { iso2: 'CG', name: 'Congo (Republic)', dialCode: '242', flag: '🇨🇬' },
  { iso2: 'CD', name: 'Congo (DRC)', dialCode: '243', flag: '🇨🇩' },
  { iso2: 'CI', name: "Côte d'Ivoire", dialCode: '225', flag: '🇨🇮' },
  { iso2: 'DJ', name: 'Djibouti', dialCode: '253', flag: '🇩🇯' },
  { iso2: 'EG', name: 'Egypt', dialCode: '20', flag: '🇪🇬' },
  { iso2: 'GQ', name: 'Equatorial Guinea', dialCode: '240', flag: '🇬🇶' },
  { iso2: 'ER', name: 'Eritrea', dialCode: '291', flag: '🇪🇷' },
  { iso2: 'SZ', name: 'Eswatini', dialCode: '268', flag: '🇸🇿' },
  { iso2: 'ET', name: 'Ethiopia', dialCode: '251', flag: '🇪🇹' },
  { iso2: 'GA', name: 'Gabon', dialCode: '241', flag: '🇬🇦' },
  { iso2: 'GM', name: 'Gambia', dialCode: '220', flag: '🇬🇲' },
  { iso2: 'GN', name: 'Guinea', dialCode: '224', flag: '🇬🇳' },
  { iso2: 'GW', name: 'Guinea-Bissau', dialCode: '245', flag: '🇬🇼' },
  { iso2: 'KE', name: 'Kenya', dialCode: '254', flag: '🇰🇪' },
  { iso2: 'LS', name: 'Lesotho', dialCode: '266', flag: '🇱🇸' },
  { iso2: 'LR', name: 'Liberia', dialCode: '231', flag: '🇱🇷' },
  { iso2: 'LY', name: 'Libya', dialCode: '218', flag: '🇱🇾' },
  { iso2: 'MG', name: 'Madagascar', dialCode: '261', flag: '🇲🇬' },
  { iso2: 'MW', name: 'Malawi', dialCode: '265', flag: '🇲🇼' },
  { iso2: 'ML', name: 'Mali', dialCode: '223', flag: '🇲🇱' },
  { iso2: 'MR', name: 'Mauritania', dialCode: '222', flag: '🇲🇷' },
  { iso2: 'MU', name: 'Mauritius', dialCode: '230', flag: '🇲🇺' },
  { iso2: 'MA', name: 'Morocco', dialCode: '212', flag: '🇲🇦' },
  { iso2: 'MZ', name: 'Mozambique', dialCode: '258', flag: '🇲🇿' },
  { iso2: 'NA', name: 'Namibia', dialCode: '264', flag: '🇳🇦' },
  { iso2: 'NE', name: 'Niger', dialCode: '227', flag: '🇳🇪' },
  { iso2: 'NG', name: 'Nigeria', dialCode: '234', flag: '🇳🇬' },
  { iso2: 'RW', name: 'Rwanda', dialCode: '250', flag: '🇷🇼' },
  { iso2: 'ST', name: 'Sao Tome and Principe', dialCode: '239', flag: '🇸🇹' },
  { iso2: 'SN', name: 'Senegal', dialCode: '221', flag: '🇸🇳' },
  { iso2: 'SC', name: 'Seychelles', dialCode: '248', flag: '🇸🇨' },
  { iso2: 'SL', name: 'Sierra Leone', dialCode: '232', flag: '🇸🇱' },
  { iso2: 'SO', name: 'Somalia', dialCode: '252', flag: '🇸🇴' },
  { iso2: 'ZA', name: 'South Africa', dialCode: '27', flag: '🇿🇦' },
  { iso2: 'SS', name: 'South Sudan', dialCode: '211', flag: '🇸🇸' },
  { iso2: 'SD', name: 'Sudan', dialCode: '249', flag: '🇸🇩' },
  { iso2: 'TZ', name: 'Tanzania', dialCode: '255', flag: '🇹🇿' },
  { iso2: 'TG', name: 'Togo', dialCode: '228', flag: '🇹🇬' },
  { iso2: 'TN', name: 'Tunisia', dialCode: '216', flag: '🇹🇳' },
  { iso2: 'UG', name: 'Uganda', dialCode: '256', flag: '🇺🇬' },
  { iso2: 'ZM', name: 'Zambia', dialCode: '260', flag: '🇿🇲' },
  { iso2: 'ZW', name: 'Zimbabwe', dialCode: '263', flag: '🇿🇼' },
];

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setAuth } = useAuthStore();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [country, setCountry] = useState(AFRICAN_COUNTRIES[0]);
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [profileImage, setProfileImage] = useState<{ uri: string; name: string; type: string } | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      setDateOfBirth(`${y}-${m}-${d}`);
    }
  };

  const pickImage = async () => {
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
    if (!result.canceled) {
      const asset = result.assets[0];
      const ext = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      setProfileImage({
        uri: asset.uri,
        name: `profile.${ext}`,
        type: asset.mimeType ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      });
    }
  };

  const getStrength = () => {
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s;
  };

  const strengthColor = ['#E24B4A', '#EF9F27'][getStrength() - 1] ?? '#eee';

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return AFRICAN_COUNTRIES;
    return AFRICAN_COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.dialCode.includes(q)
    );
  }, [countrySearch]);

  const selectCountry = (c: typeof AFRICAN_COUNTRIES[number]) => {
    setCountry(c);
    setCountryPickerVisible(false);
    setCountrySearch('');
  };

  const handleRegister = async () => {
    if (!fullName || !email || !phoneNumber || !password || !confirmPassword) {
      Alert.alert('Validation Error', 'Please fill in all required fields.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Validation Error', 'Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Validation Error', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await accountService.register({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        confirm_password: confirmPassword,
        phone_number: `${country.dialCode}${phoneNumber.trim().replace(/^0+/, '')}`,
        country: country.name,
        gender: gender || 'other',
        date_of_birth: dateOfBirth || undefined,
        profile_image: profileImage ?? undefined,
      });
      await setAuth({ access: res.tokens.access, refresh: res.tokens.refresh }, res.user, res.kyc_status);
      router.replace('/(auth)/kyc');
    } catch (error: any) {
      Alert.alert('Registration Failed', error?.response?.data?.error || error?.message || 'Please review your details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Top branding — fixed, does not scroll with the form */}
      <View style={[styles.topSection, { paddingTop: insets.top + 32 }]}>
        <View style={styles.logoBox}>
          <Image source={require('../../assets/mysokoapp-logo.png')} style={styles.logoImage} resizeMode="contain" />
        </View>
        
        <Text style={styles.tagline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          Your Pan-African SuperApp
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Text style={styles.formTitle}>Create account</Text>
          <Text style={styles.formSubtitle}>Join MySokoApp — it only takes a minute</Text>

          {/* Avatar */}
          <TouchableOpacity style={styles.avatarWrap} onPress={pickImage} activeOpacity={0.8}>
            {profileImage ? (
              <Image source={{ uri: profileImage.uri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="camera-outline" size={28} color="#0F6E56" />
              </View>
            )}
            <Text style={styles.avatarLabel}>Upload profile photo (optional)</Text>
          </TouchableOpacity>

          {/* Section: Personal */}
          <Text style={styles.sectionDivider}>Personal information</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Full name <Text style={styles.req}>*</Text></Text>
            <View style={styles.inputWrap}>
              <Ionicons name="person-outline" size={17} color="#aaa" style={styles.icon} />
              <TextInput value={fullName} onChangeText={setFullName} style={styles.input} placeholder="Kofi Mensah" placeholderTextColor="#bbb" />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Phone <Text style={styles.req}>*</Text></Text>
            <View style={styles.phoneRow}>
              <TouchableOpacity
                style={styles.countryBtn}
                onPress={() => setCountryPickerVisible(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.countryFlag}>{country.flag}</Text>
                <Text style={styles.countryDialCode}>+{country.dialCode}</Text>
                <Ionicons name="chevron-down" size={14} color="#888" />
              </TouchableOpacity>
              <View style={[styles.inputWrap, { flex: 1 }]}>
                <TextInput
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  style={styles.input}
                  placeholder="24 123 4567"
                  placeholderTextColor="#bbb"
                  keyboardType="phone-pad"
                />
              </View>
            </View>
          </View>

          <Modal
            visible={countryPickerVisible}
            animationType="slide"
            transparent
            onRequestClose={() => setCountryPickerVisible(false)}
          >
            <View style={styles.modalOverlay}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setCountryPickerVisible(false)}
              />
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select country</Text>
                  <TouchableOpacity onPress={() => setCountryPickerVisible(false)}>
                    <Ionicons name="close" size={22} color="#666" />
                  </TouchableOpacity>
                </View>
                <View style={styles.modalSearchWrap}>
                  <Ionicons name="search-outline" size={16} color="#aaa" style={{ marginRight: 6 }} />
                  <TextInput
                    value={countrySearch}
                    onChangeText={setCountrySearch}
                    placeholder="Search country"
                    placeholderTextColor="#bbb"
                    style={styles.modalSearchInput}
                  />
                </View>
                <FlatList
                  data={filteredCountries}
                  keyExtractor={(item) => item.iso2}
                  keyboardShouldPersistTaps="handled"
                  style={{ maxHeight: 380 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.countryRow, item.iso2 === country.iso2 && styles.countryRowActive]}
                      onPress={() => selectCountry(item)}
                    >
                      <Text style={styles.countryRowFlag}>{item.flag}</Text>
                      <Text style={styles.countryRowName}>{item.name}</Text>
                      <Text style={styles.countryRowDial}>+{item.dialCode}</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.modalEmpty}>No country matches "{countrySearch}"</Text>
                  }
                />
              </View>
            </View>
          </Modal>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email <Text style={styles.req}>*</Text></Text>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={17} color="#aaa" style={styles.icon} />
              <TextInput value={email} onChangeText={setEmail} style={styles.input} placeholder="you@example.com" placeholderTextColor="#bbb" autoCapitalize="none" keyboardType="email-address" />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Gender</Text>
            <View style={styles.genderRow}>
              {GENDER_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, gender === opt.value && styles.chipActive]}
                  onPress={() => setGender(opt.value)}
                >
                  <Text style={[styles.chipText, gender === opt.value && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Date of birth</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
              <View style={styles.inputWrap} pointerEvents="none">
                <Ionicons name="calendar-outline" size={17} color="#aaa" style={styles.icon} />
                <TextInput
                  value={dateOfBirth}
                  style={styles.input}
                  placeholder="Select date of birth"
                  placeholderTextColor="#bbb"
                  editable={false}
                />
              </View>
            </TouchableOpacity>
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={dateOfBirth ? new Date(dateOfBirth) : new Date(2000, 0, 1)}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onDateChange}
              maximumDate={new Date()}
            />
          )}

          {/* Section: Security */}
          <Text style={styles.sectionDivider}>Security</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Password <Text style={styles.req}>*</Text></Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={17} color="#aaa" style={styles.icon} />
              <TextInput value={password} onChangeText={setPassword} style={[styles.input, { paddingRight: 40 }]} placeholder="Min. 8 characters" placeholderTextColor="#bbb" secureTextEntry={!showPassword} />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={17} color="#aaa" />
              </TouchableOpacity>
            </View>
            {/* Strength bar */}
            {password.length > 0 && (
              <View style={styles.strengthTrack}>
                <View style={[styles.strengthBar, { width: `${getStrength() * 25}%` as any, backgroundColor: strengthColor }]} />
              </View>
            )}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Confirm password <Text style={styles.req}>*</Text></Text>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={17} color="#aaa" style={styles.icon} />
              <TextInput value={confirmPassword} onChangeText={setConfirmPassword} style={[styles.input, { paddingRight: 40 }]} placeholder="Repeat password" placeholderTextColor="#bbb" secureTextEntry={!showConfirm} />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowConfirm(!showConfirm)}>
                <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={17} color="#aaa" />
              </TouchableOpacity>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator size="large" color="#FF8000" style={{ marginTop: 16 }} />
          ) : (
            <TouchableOpacity style={styles.regBtn} onPress={handleRegister} activeOpacity={0.85}>
              <Text style={styles.regBtnText}>Create account</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>
          )}

          <View style={styles.signinRow}>
            <Text style={styles.signinText}>Already have an account?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={styles.signinLink}> Sign in</Text>
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
  scroll: { paddingBottom: 40 },
  topSection: { backgroundColor: '#FF8000', paddingTop: 32, paddingBottom: 44, alignItems: 'center', borderBottomLeftRadius: 36, borderBottomRightRadius: 36 },
  logoBox: { width: 200, height: 50, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 10, paddingHorizontal: 12 },
  logoImage: { width: '100%', height: '100%' },
  brand: { fontSize: 22, fontWeight: '600', color: '#fff' },
  tagline: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 3 },
  form: { padding: 20, paddingTop: 24 },
  formTitle: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  formSubtitle: { fontSize: 13, color: '#888', marginBottom: 22 },
  avatarWrap: { alignItems: 'center', marginBottom: 22 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E1F5EE', borderWidth: 2, borderColor: '#9FE1CB', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarImage: { width: 80, height: 80, borderRadius: 40, marginBottom: 8 },
  avatarLabel: { fontSize: 12, color: '#888' },
  sectionDivider: { fontSize: 11, fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14, marginTop: 6, paddingBottom: 6, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  req: { color: '#D85A30' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f7f7', borderWidth: 0.5, borderColor: '#e0e0e0', borderRadius: 12, paddingHorizontal: 12 },
  icon: { marginRight: 8 },
  input: { flex: 1, paddingVertical: 13, fontSize: 14, color: '#1a1a1a' },
  eyeBtn: { padding: 4 },
  phoneRow: { flexDirection: 'row', gap: 8 },
  countryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#f7f7f7', borderWidth: 0.5, borderColor: '#e0e0e0',
    borderRadius: 12, paddingHorizontal: 10,
  },
  countryFlag: { fontSize: 18 },
  countryDialCode: { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingBottom: 24, maxHeight: '75%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 14 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  modalSearchWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7f7f7', borderWidth: 0.5, borderColor: '#e0e0e0', borderRadius: 12, paddingHorizontal: 12, marginHorizontal: 20, marginBottom: 10 },
  modalSearchInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: '#1a1a1a' },
  countryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  countryRowActive: { backgroundColor: '#FFF4E8' },
  countryRowFlag: { fontSize: 20 },
  countryRowName: { flex: 1, fontSize: 14, color: '#1a1a1a' },
  countryRowDial: { fontSize: 13, color: '#888', fontWeight: '500' },
  modalEmpty: { textAlign: 'center', color: '#888', fontSize: 13, paddingVertical: 30 },
  genderRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20, borderWidth: 0.5, borderColor: '#e0e0e0', backgroundColor: '#f7f7f7' },
  chipActive: { backgroundColor: '#FF8000', borderColor: '#FF8000' },
  chipText: { fontSize: 13, color: '#666' },
  chipTextActive: { color: '#fff', fontWeight: '500' },
  strengthTrack: { height: 3, backgroundColor: '#eee', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  strengthBar: { height: 3, borderRadius: 2 },
  regBtn: { backgroundColor: '#FF8000', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 },
  regBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  signinRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 22 },
  signinText: { fontSize: 14, color: '#888' },
  signinLink: { fontSize: 14, color: '#FF8000', fontWeight: '600' },
});