import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, ScrollView, Modal, Pressable, StatusBar, Image } from 'react-native';
import { Text } from '../../src/components/Text';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '../../src/config/api';

const APPS = [
  {
    key: 'account', name: 'SokoAccount', route: '/account',
    icon: 'person-circle-outline', image: require('../../assets/sokoaccount.png'), color: '#FF8000', bg: '#FFFFFF',
    subtitle: 'Profile',
    features: ['View & update Profile', 'Security settings', 'Notifications', 'Linked accounts'],
    featureIcons: ['id-card-outline', 'shield-checkmark-outline', 'notifications-outline', 'link-outline'],
    featureRoutes: ['/account', '/kyc', '/account', '/account'],
    btnColor: '#FF8000',
  },
  {
    key: 'delivery', name: 'SokoDelivery', route: '/delivery',
    icon: 'bicycle-outline', image: require('../../assets/sokodelivery.png'), color: '#FF8000', bg: '#FFFFFF',
    subtitle: 'Send & track packages',
    features: ['Book a delivery', 'Track active orders', 'Delivery history', 'Pricing & rates'],
    featureIcons: ['location-outline', 'map-outline', 'time-outline', 'receipt-outline'],
    featureRoutes: ['/delivery', '/delivery/track', '/delivery/track', '/delivery/price&rate'],
    btnColor: '#FF8000',
  },
  {
    key: 'shopper', name: 'SokoShopper', route: '/shopper',
    icon: 'bag-outline', image: require('../../assets/sokoshopper.png'), color: '#FF8000', bg: '#FFFFFF',
    subtitle: 'Shop from local vendors',
    features: ['Browse stores', 'My orders', 'Cart', 'Track order'],
    featureIcons: ['storefront-outline', 'receipt-outline', 'cart-outline', 'navigate-outline'],
    featureRoutes: ['/shopper', '/shopper/MyOrdersScreen', '/shopper/CartScreen', '/shopper/TrackOrderScreen'],
    btnColor: '#FF8000',
  },
  // SokoSusu hidden from users for now — re-enable by uncommenting.
  // {
  //   key: 'susu', name: 'SokoSusu', route: '/susu',
  //   icon: 'save-outline', image: require('../../assets/sokosusu.png'), color: '#FF8000', bg: '#FFFFFF',
  //   subtitle: 'Group savings',
  //   features: ['My susu groups', 'Create group', 'Discover groups', 'Contributions'],
  //   featureIcons: ['people-outline', 'add-circle-outline', 'search-outline', 'cash-outline'],
  //   featureRoutes: ['/susu', '/susu/CreateGroupScreen', '/susu/DiscoverScreen', '/susu'],
  //   btnColor: '#FF8000',
  // },
  {
    key: 'sokoindex', name: 'SokoIndex', route: '/sokoindex',
    icon: 'hammer-outline', image: require('../../assets/sokoindex.png'), color: '#FF8000', bg: '#FFFFFF',
    subtitle: 'Find & book artisans',
    features: ['Browse artisans', 'Become an artisan', 'My bookings', 'My work'],
    featureIcons: ['search-outline', 'hammer-outline', 'receipt-outline', 'briefcase-outline'],
    featureRoutes: ['/sokoindex', '/sokoindex/apply', '/sokoindex/my-bookings', '/sokoindex/my-portfolio'],
    btnColor: '#FF8000',
  },
  {
    key: 'traffic', name: 'SokoTraffic', route: '/traffic',
    icon: 'navigate-outline', color: '#FF8000', bg: '#FFFFFF',
    subtitle: 'Live-traffic routes',
    features: ['Plan a route', 'Compare routes by traffic', 'Navigate with Google Maps'],
    featureIcons: ['map-outline', 'git-compare-outline', 'navigate-outline'],
    featureRoutes: ['/traffic', '/traffic', '/traffic'],
    btnColor: '#FF8000',
  },
  // SokoLoan hidden from users for now — re-enable by uncommenting.
  // {
  //   key: 'loan', name: 'SokoLoan', route: '/coming-soon',
  //   icon: 'trending-up-outline', image: require('../../assets/sokoloan.png'), color: '#FF8000', bg: '#FFFFFF',
  //   subtitle: 'Quick credit access',
  //   features: ['Apply for a loan', 'Active loans', 'Credit score', 'Repayment schedule'],
  //   featureIcons: ['cash-outline', 'document-text-outline', 'star-outline', 'calendar-outline'],
  //   featureRoutes: ['/coming-soon', '/coming-soon', '/coming-soon', '/coming-soon'],
  //   btnColor: '#FF8000',
  // },
];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, kycStatus, logout, clearAuth } = useAuthStore() as any;
  const kycState = String(kycStatus ?? '').toLowerCase();
  const needsKyc = !kycState || kycState === 'pending' || kycState === 'rejected';
  const [selectedApp, setSelectedApp] = useState<typeof APPS[0] | null>(null);

  const handleLogout = async () => {
    const performLogout = logout || clearAuth;
    if (performLogout) await performLogout();
    router.replace('/login');
  };

  const firstName = (user?.user?.full_name || user?.full_name)?.split(' ')[0] ?? 'User';
  const userData = user?.user || user;
  const currentHour = new Date().getHours();
  const getGreeting = () => {
    if (currentHour >= 5 && currentHour < 12) return 'Good morning';
    if (currentHour >= 12 && currentHour < 17) return 'Good afternoon';
    if (currentHour >= 17 && currentHour < 21) return 'Good evening';
    return 'Good night';
  };
  const greetingText = getGreeting();
  const roles = userData?.roles || [];
  const isDriver = roles.includes('driver');

  const rawProfileImage = userData?.profile_image_url || userData?.ProfileImageURL;
  const profileImageURL = rawProfileImage
    ? (rawProfileImage.startsWith('http') ? rawProfileImage : `${API_BASE_URL}/api/v1/media/serve/${rawProfileImage}`)
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 25 }]}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={styles.greeting} numberOfLines={1}>{greetingText} 👋</Text>
              <Text style={styles.headerName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                Welcome, {firstName}
              </Text>
              <Text style={styles.tagline} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                Your Pan-African SuperApp
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <TouchableOpacity onPress={handleLogout} style={styles.logoutIconButton}>
                <Text style={styles.logoutText}>Logout</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.avatar} onPress={() => router.push('/account')}>
                {profileImageURL ? (
                  <Image source={{ uri: profileImageURL }} style={styles.avatarImage} resizeMode="cover" />
                ) : (
                  <Text style={styles.avatarText}>
                    {firstName.slice(0, 2).toUpperCase()}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Balance card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>SokoAccount</Text>
          <Text style={styles.balanceVal}>GH₵ 0.00</Text>

          <View style={styles.balanceDivider} />

          <View style={styles.quickActions}>
            {[
              { icon: 'arrow-up-outline', label: 'Send' },
              { icon: 'arrow-down-outline', label: 'Receive' },
              { icon: 'scan-outline', label: 'Scan' },
            ].map((q) => (
              <View key={q.label} style={styles.quickBtn}>
                <View style={styles.quickIcon}>
                  <Ionicons name={q.icon as any} size={18} color="#FF8000" />
                </View>
                <Text style={styles.quickLabel} numberOfLines={1}>{q.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Identity verification prompt — apps stay browsable, but ordering,
            deliveries and bookings need a verified identity. */}
        {needsKyc && (
          <TouchableOpacity
            style={styles.kycBanner}
            onPress={() => router.push('/kyc')}
            activeOpacity={0.9}
          >
            <Ionicons name="shield-checkmark-outline" size={22} color="#FF8000" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.driverBannerTitle}>
                {kycState === 'rejected' ? 'Resubmit identity verification' : 'Verify your identity'}
              </Text>
              <Text style={styles.driverBannerSub}>Required to order, send packages and book artisans</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#FF8000" />
          </TouchableOpacity>
        )}

        {/* Driver Application Banner */}
        {!isDriver && (
          <TouchableOpacity 
            style={styles.driverBanner}
            onPress={() => router.push('/driver/ApplyDriverScreen')}
            activeOpacity={0.9}
          >
            <View style={styles.driverBannerContent}>
              <View style={styles.driverBannerIcon}> 
                <Ionicons name="car-sport" size={22} color="#FF8000" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.driverBannerTitle}>Earn with MySokoApp</Text> 
                <Text style={styles.driverBannerSub}>Apply to become a driver today</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FF8000" />
            </View>
          </TouchableOpacity>
        )}

        {/* Apps grid */} 
        <Text style={styles.sectionTitle}>MySokoApps</Text>
        <View style={styles.appsGrid}>
          {APPS.map((app) => (
            <TouchableOpacity
              key={app.key}
              style={styles.appItem}
              onPress={() => setSelectedApp(app)}
              activeOpacity={0.75}
            > 
              <View style={[styles.appCircle, { backgroundColor: app.bg, borderColor: app.color + '44' }]}>
                {(app as any).image ? (
                  <Image source={(app as any).image} style={styles.appLogoImage} resizeMode="cover" />
                ) : (
                  <Ionicons name={app.icon as any} size={30} color={app.color} />
                )}
              </View>
              <Text
                style={styles.appName}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {app.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>
 
      {/* App detail modal */} 
      <Modal visible={!!selectedApp} transparent animationType="slide" onRequestClose={() => setSelectedApp(null)}>
        <Pressable style={styles.overlay} onPress={() => setSelectedApp(null)}>
          <Pressable style={styles.bottomSheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            {selectedApp && (
              <> 
                <View style={styles.sheetHeader}>
                  <View style={[styles.sheetIcon, { backgroundColor: selectedApp.bg }]}>
                    {(selectedApp as any).image ? (
                      <Image source={(selectedApp as any).image} style={styles.sheetLogoImage} resizeMode="cover" />
                    ) : (
                      <Ionicons name={selectedApp.icon as any} size={26} color={selectedApp.color} />
                    )}
                  </View>
                  <View>
                    <Text style={styles.sheetTitle}>{selectedApp.name}</Text>
                    <Text style={styles.sheetSubtitle}>{selectedApp.subtitle}</Text>
                  </View> 
                </View>
                {selectedApp.features.map((f, i) => (
                  <TouchableOpacity
                    key={f}
                    style={styles.featureRow}
                    onPress={() => {
                      setSelectedApp(null);
                      const route = selectedApp.featureRoutes?.[i] ?? selectedApp.route;
                      router.push(route as any);
                    }}
                  >
                    <Ionicons name={selectedApp.featureIcons[i] as any} size={20} color="#888" />
                    <Text style={styles.featureText}>{f}</Text>
                    <Ionicons name="chevron-forward" size={16} color="#bbb" style={{ marginLeft: 'auto' }} />
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.openBtn, { backgroundColor: selectedApp.btnColor }]}
                  onPress={() => { 
                    setSelectedApp(null); 
                    if (selectedApp.key === 'driver' && !isDriver) {
                      router.push('/driver/ApplyDriverScreen');
                    } else {
                      router.push(selectedApp.route as any);
                    }
                  }}
                > 
                  <Text style={styles.openBtnText}>Open {selectedApp.name}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSelectedApp(null)}>
                  <Text style={styles.cancelText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: { backgroundColor: '#FF8000', paddingHorizontal: 20, paddingTop: 25, paddingBottom: 40, borderBottomLeftRadius: 15, borderBottomRightRadius: 15 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { color: 'white', fontSize: 13 },
  headerName: { color: 'white', fontSize: 22, fontWeight: '600', marginTop: 2 },
  tagline: { color: 'white', fontSize: 12, marginTop: 2 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white', overflow: 'hidden' },
  avatarImage: { width: 42, height: 42, borderRadius: 21 },
  logoutIconButton: { padding: 8, backgroundColor: 'white', borderRadius: 12 },
  logoutText: { color: '#FF8000', fontSize: 13, fontWeight: '700' },
  avatarText: { color: '#FF8000', fontWeight: '600', fontSize: 15 },
  balanceCard: { marginHorizontal: 16, marginTop: -20, backgroundColor: 'white', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, elevation: 4, shadowColor: 'black', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  balanceLabel: { fontSize: 12, color: '#888', fontWeight: '600', marginBottom: 2 },
  balanceVal: { fontSize: 22, fontWeight: '800', color: 'black' },
  balanceDivider: { height: 1, backgroundColor: '#F0F0F0', marginTop: 10, marginBottom: 10 },
  driverBanner: { marginHorizontal: 16, marginTop: 16, backgroundColor: 'white', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#FF8000' },
  kycBanner: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#FFF4E8', borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center' },
  driverBannerContent: { flexDirection: 'row', alignItems: 'center' },
  driverBannerIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' },
  driverBannerTitle: { fontSize: 16, fontWeight: '700', color: 'black' },
  driverBannerSub: { fontSize: 12, color: 'black', opacity: 0.7, marginTop: 2 },
  quickActions: { flexDirection: 'row', justifyContent: 'space-between' },
  quickBtn: { flex: 1, alignItems: 'center', gap: 4 },
  quickIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFF4E8', alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11, fontWeight: '600', color: '#333' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: 'black', paddingHorizontal: 16, marginTop: 20, marginBottom: 14 },
  appsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  appItem: { width: '33.33%', alignItems: 'center', marginBottom: 22, paddingHorizontal: 6 },
  appCircle: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FF8000', marginBottom: 8, overflow: 'hidden' },
  appLogoImage: { width: '100%', height: '100%' },
  appName: { fontSize: 11, color: 'black', textAlign: 'center', lineHeight: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  bottomSheet: { backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 4, backgroundColor: 'white', borderRadius: 2, alignSelf: 'center', marginBottom: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 },
  sheetIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FF8000', overflow: 'hidden' },
  sheetLogoImage: { width: '100%', height: '100%' },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: 'black' },
  sheetSubtitle: { fontSize: 13, color: 'black', marginTop: 2 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderTopWidth: 0.5, borderTopColor: 'white' },
  featureText: { flex: 1, fontSize: 14, color: 'black' },
  openBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18, marginBottom: 10 },
  openBtnText: { color: 'white', fontSize: 15, fontWeight: '600' },
  cancelText: { textAlign: 'center', color: 'black', fontSize: 13, paddingVertical: 4 },
});