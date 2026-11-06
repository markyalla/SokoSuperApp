import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator, Alert, RefreshControl, StatusBar, Modal, Dimensions, ScrollView } from 'react-native';
import { Text } from '../../../src/components/Text';
import { TextInput } from '../../../src/components/TextInput';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring,
  withRepeat, withDelay, Easing, FadeInDown,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../src/store/authStore';
import { shopperApi } from '../../../src/api/shopper';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Toast from '../../../src/components/Toast';
import { friendlyError } from '../../../src/utils/friendlyError';
import { GRID_COLUMNS, GRID_THRESHOLD, isGridRow, toGridRows } from '../../../src/utils/gridRows';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');

/**
 * GlowImage
 * Drop-in replacement for <Image>. Adds:
 *  1. A slow continuous "breathing" glow (shadow pulsing)
 *  2. A one-time diagonal shimmer sweep on mount
 * No BlurView, no extra touchables — safe to nest inside any TouchableOpacity.
 */
function GlowImage({
  uri,
  style,
  radius = 16,
  glowColor = '#FF8000',
  placeholderEmoji = '🍱',
  placeholderStyle,
  shimmerWidth,
}: {
  uri?: string | null;
  style: any;
  radius?: number;
  glowColor?: string;
  placeholderEmoji?: string;
  placeholderStyle?: any;
  shimmerWidth?: number;
}) {
  const pulse = useSharedValue(0.3);
  const shimmerX = useSharedValue(-1);

  useEffect(() => {
    const delay = Math.random() * 400;
    pulse.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1, true)
    );
    shimmerX.value = withDelay(300 + delay, withTiming(1.4, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, []);

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: 0.22 + pulse.value * 0.38,
    shadowRadius: 6 + pulse.value * 12,
    elevation: 3 + pulse.value * 7,
  }));

  const shimmerStyle = useAnimatedStyle(() => {
    const w = shimmerWidth || (typeof style?.width === 'number' ? style.width : 74);
    return {
      opacity: shimmerX.value < 1.3 ? 1 : 0,
      transform: [{ translateX: shimmerX.value * w * 2 - w }, { rotate: '18deg' }],
    };
  });

  return (
    <Animated.View
      style={[
        style,
        glowStyle,
        { shadowColor: glowColor, shadowOffset: { width: 0, height: 0 }, backgroundColor: 'transparent' },
      ]}
    >
      <View style={{ width: '100%', height: '100%', borderRadius: radius, overflow: 'hidden' }}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
        ) : (
          <View style={[{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF2E8' }, placeholderStyle]}>
            <Text style={{ fontSize: 24 }}>{placeholderEmoji}</Text>
          </View>
        )}
        {uri && (
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 40 }, shimmerStyle]}
          >
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

export default function ShopsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout, clearAuth, tokens } = useAuthStore() as any;
  const token = tokens?.access;
  const [stores, setStores] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [toast, setToast] = useState({ visible: false, message: '' });
  const [filtered, setFiltered] = useState<any[]>([]);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  // Product detail modal state — additive, doesn't touch existing add-to-cart flow
  const [detailProduct, setDetailProduct] = useState<any | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const sheetTranslateY = useSharedValue(SCREEN_H);
  const backdropOpacity = useSharedValue(0);

  const { addToCart, updateQuantity, cart, cartCount } = useAuthStore() as any;

  // Group stores into "Near You" (same country as the logged-in user) and
  // "Other Regions" — the API already returns same-country stores first
  // (a stable sort, nothing is hidden), this just makes that grouping visible.
  // Falls back to the plain flat list if we don't know the user's country or
  // there's nothing to split (all local, or all foreign).
  const sectionedStores = useMemo(() => {
    if (selectedCategory || !user?.country) return filtered;
    const mine = filtered.filter((s: any) => s.country === user.country);
    const others = filtered.filter((s: any) => s.country !== user.country);
    if (mine.length === 0 || others.length === 0) return filtered;
    return [
      { __sectionHeader: true, title: 'Near You', id: '__section_mine' },
      ...mine,
      { __sectionHeader: true, title: 'Other Regions', id: '__section_others' },
      ...others,
    ];
  }, [filtered, selectedCategory, user?.country]);

  useEffect(() => {
    if (!token) return;

    const initialize = async () => {
      setLoading(true);

      try {
        await Promise.all([
          loadCategories(),
          loadShops(),
        ]);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [token]);

  useEffect(() => {
    const query = search.trim().toLowerCase();

    if (selectedCategory) {
      const filteredProducts = products.filter(
        (product) =>
          product.name?.toLowerCase().includes(query) ||
          product.store_name?.toLowerCase().includes(query)
      );

      setFiltered(filteredProducts);
    } else {
      const filteredStores = stores.filter(
        (store) =>
          store.name?.toLowerCase().includes(query) ||
          store.address?.toLowerCase().includes(query)
      );

      setFiltered(filteredStores);
    }
  }, [search, stores, products, selectedCategory]);

  // Drives the modal's slide-up/fade animation
  useEffect(() => {
    if (detailVisible) {
      sheetTranslateY.value = withSpring(0, { damping: 18, stiffness: 160 });
      backdropOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.ease) });
    } else {
      sheetTranslateY.value = withTiming(SCREEN_H, { duration: 220, easing: Easing.in(Easing.ease) });
      backdropOpacity.value = withTiming(0, { duration: 180 });
    }
  }, [detailVisible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetTranslateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  const loadCategories = async () => {
    try {
      const data = await shopperApi.getCategories(token);

      setCategories([
        {
          id: 'all',
          name: 'All Stores',
          emoji: '🏢',
        },
        ...(Array.isArray(data) ? data : []),
      ]);
    } catch (error) {
      console.log('Categories Error:', error);
    }
  };

  const handleCategorySelect = async (categoryId: string) => {
    if (categoryId === 'all') {
      setSelectedCategory(null);
      setProducts([]);
      setFiltered(stores.filter(store => store.name?.toLowerCase().includes(search.trim().toLowerCase())));
      return;
    }

    setSelectedCategory(categoryId);
    setLoading(true);

    try {
      const data = await shopperApi.getProductsByCategory(token, categoryId);

      const categoryProducts = Array.isArray(data)
        ? data
        : [];

      setProducts(categoryProducts);
      setFiltered(categoryProducts);
    } catch (e: any) {
      console.error('Category Products Error:', e);

      Alert.alert(
        'Error',
        e.message || 'Unable to load products'
      );
    } finally {
      setLoading(false);
    }
  };

  const getProductId = (item: any) => String(item.id || item.product_id);

  // UNCHANGED from your original — adds to cart AND navigates to CartScreen
  const handleAddToCart = (item: any) => {
  const id = getProductId(item);

  addToCart({
    id,
    name: item.name,
    price: item.base_price,
    image_url: item.image_url,
    quantity: 1,
    store_id: String(item.store_id),
  });

  setToast({
    visible: true,
    message: `${item.name} added to cart!`,
  });
};
  

  // NEW — opens the detail modal. Only wired to tapping the product's image/info area,
  // never to the Add button, so your add-to-cart flow above is untouched.
  const openProductDetail = (item: any) => {
    setDetailProduct(item);
    setDetailVisible(true);
  };

  const closeProductDetail = () => {
    setDetailVisible(false);
    setTimeout(() => setDetailProduct(null), 220);
  };

  const handleModalIncrement = () => {
    if (!detailProduct) return;
    const id = getProductId(detailProduct);
    const current = cart[id];
    if (current) updateQuantity(id, current.quantity + 1);
  };

  const handleModalDecrement = () => {
    if (!detailProduct) return;
    const id = getProductId(detailProduct);
    const current = cart[id];
    if (current) updateQuantity(id, current.quantity - 1);
  };

  const loadShops = async () => {
    if (!token) return;

    try {
      const data = await shopperApi.getShops(token);

      if (Array.isArray(data)) {
        setStores(data);

        if (!selectedCategory) {
          setFiltered(data);
        }
      }
    } catch (e: any) {
      Alert.alert('Error', friendlyError(e));
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadShops(),
        loadCategories(),
      ]);
      if (selectedCategory && selectedCategory !== 'all') {
        await handleCategorySelect(selectedCategory);
      }
    } finally {
      setRefreshing(false);
    }
  }, [token, selectedCategory]);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: () => {
          const performLogout = logout || clearAuth;
          if (performLogout) performLogout();
          router.replace('/login');
        }
      }
    ]);
  };

  // UNCHANGED structure from your original — same TouchableOpacity, same onPress navigation.
  // Only the <Image> became <GlowImage>, and cardBody got a translucent "glass" background
  // instead of a flat one (no BlurView involved, so nothing can block the tap).
  const renderStore = ({ item, index }: { item: any; index: number }) => {
    const isOpen = item.is_open !== false;
    return (
      <Animated.View
        entering={FadeInDown.delay(Math.min(index, 6) * 70).duration(420).easing(Easing.out(Easing.cubic))}
        style={styles.cardWrapper}
      >
        <TouchableOpacity
          style={[styles.card, !isOpen && styles.cardClosed]}
          onPress={() => {
            if (!isOpen) {
              Alert.alert('Shop Closed', `${item.name} is currently closed.`);
              return;
            }
            router.push({ pathname: '/shopper/ShopDetailScreen', params: { shopId: String(item.id) } } as any);
          }}
          activeOpacity={0.85}
        >
          <GlowImage
            uri={item.cover_image_url || item.logo_url}
            style={styles.cardImage}
            radius={0}
            placeholderEmoji="🛍️"
            shimmerWidth={SCREEN_W - 32}
          />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.22)']} style={styles.cardImageFade} pointerEvents="none" />
          {!isOpen && (
            <View style={styles.closedOverlay}>
              <Text style={styles.closedOverlayText}>CLOSED</Text>
            </View>
          )}
          <View style={styles.cardBody}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardName}>{item.name}</Text>
              {item.category?.name && (
                <Text style={styles.categoryBadge}>{item.category.name}</Text>
              )}
            </View>
            <Text style={styles.cardAddress}>📍 {item.address}</Text>
            {item.description ? (
              <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
            ) : null}
            <View style={styles.cardFooter}>
              <View style={[styles.openBadge, !isOpen && styles.closedBadge]}>
                <Text style={[styles.openText, !isOpen && styles.closedText]}>
                  {isOpen ? '● Open' : '● Closed'}
                </Text>
              </View>
              {isOpen && <Text style={styles.orderNow}>Order now →</Text>}
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  // UNCHANGED structure from your original — plain row (not a TouchableOpacity),
  // "+ Add" button and qty stepper behave exactly as before.
  // The only addition: tapping the image/info area (a separate inner TouchableOpacity)
  // opens the detail modal — it doesn't wrap the Add button, so that's untouched.
  const renderProduct = ({ item }: { item: any }) => {
    const id = getProductId(item);
    const cartItem = cart[id];
    return (
      <TouchableOpacity
        style={styles.productCard}
        activeOpacity={0.9}
        onPress={() => openProductDetail(item)}
      >
        <GlowImage
          uri={item.image_url}
          style={styles.productImage}
          radius={24}
          placeholderEmoji="🍱"
        />

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.78)']}
          locations={[0, 0.45, 1]}
          style={styles.productFade}
          pointerEvents="none"
        />

        <View style={styles.productTextWrap} pointerEvents="none">
          <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.productStore} numberOfLines={1}>from {item.store_name || 'SokoApp'}</Text>
          <Text style={styles.productPrice}>GHS {(item.base_price || 0).toFixed(2)}</Text>
        </View>

        {cartItem ? (
          <View style={styles.cardQtyControls}>
            <TouchableOpacity
              style={styles.cardQtyBtn}
              onPress={(e) => { e.stopPropagation(); updateQuantity(id, cartItem.quantity - 1); }}
            >
              <Text style={styles.cardQtyBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.cardQtyCount}>{cartItem.quantity}</Text>
            <TouchableOpacity
              style={styles.cardQtyBtn}
              onPress={(e) => { e.stopPropagation(); updateQuantity(id, cartItem.quantity + 1); }}
            >
              <Text style={styles.cardQtyBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={(e) => { e.stopPropagation(); handleAddToCart(item); }}
          >
            <Ionicons name="add" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  // Compact cards used when there are many items, three across a row.
  const renderStoreCompact = (item: any) => {
    const isOpen = item.is_open !== false;
    return (
      <TouchableOpacity
        style={[styles.gridCard, !isOpen && styles.cardClosed]}
        onPress={() => {
          if (!isOpen) {
            Alert.alert('Shop Closed', `${item.name} is currently closed.`);
            return;
          }
          router.push({ pathname: '/shopper/ShopDetailScreen', params: { shopId: String(item.id) } } as any);
        }}
        activeOpacity={0.85}
      >
        <GlowImage
          uri={item.cover_image_url || item.logo_url}
          style={styles.gridImage}
          radius={0}
          placeholderEmoji="🛍️"
          shimmerWidth={GRID_CELL_W}
        />
        {!isOpen && (
          <View style={styles.gridClosedOverlay}>
            <Text style={styles.gridClosedText}>CLOSED</Text>
          </View>
        )}
        <View style={styles.gridBody}>
          <Text style={styles.gridName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.gridSub} numberOfLines={1}>{item.address}</Text>
          <Text style={[styles.gridStatus, !isOpen && styles.closedText]}>
            {isOpen ? '● Open' : '● Closed'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderProductCompact = (item: any) => {
    const id = getProductId(item);
    const cartItem = cart[id];
    return (
      <TouchableOpacity
        style={styles.gridCard}
        activeOpacity={0.9}
        onPress={() => openProductDetail(item)}
      >
        <GlowImage
          uri={item.image_url}
          style={styles.gridImage}
          radius={0}
          placeholderEmoji="🍱"
          shimmerWidth={GRID_CELL_W}
        />
        {cartItem ? (
          <View style={styles.gridQtyBadge}>
            <Text style={styles.gridQtyBadgeText}>{cartItem.quantity}</Text>
          </View>
        ) : null}
        <View style={styles.gridBody}>
          <Text style={styles.gridName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.gridPriceRow}>
            <Text style={styles.gridPrice} numberOfLines={1}>GHS {(item.base_price || 0).toFixed(2)}</Text>
            <TouchableOpacity
              style={styles.gridAddBtn}
              hitSlop={8}
              onPress={(e) => {
                e.stopPropagation();
                if (cartItem) updateQuantity(id, cartItem.quantity + 1);
                else handleAddToCart(item);
              }}
              accessibilityLabel={`Add ${item.name} to cart`}
            >
              <Ionicons name="add" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const baseListData: any[] = selectedCategory ? filtered : sectionedStores;
  const useGrid = filtered.length > GRID_THRESHOLD;
  const listData: any[] = useGrid ? toGridRows(baseListData, GRID_COLUMNS) : baseListData;

  const renderGridRow = (row: { items: any[] }, index: number) => (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 6) * 60).duration(380).easing(Easing.out(Easing.cubic))}
      style={styles.gridRow}
    >
      {row.items.map((it) => (
        <View key={String(it.id)} style={styles.gridCell}>
          {selectedCategory ? renderProductCompact(it) : renderStoreCompact(it)}
        </View>
      ))}
      {Array.from({ length: GRID_COLUMNS - row.items.length }).map((_, i) => (
        <View key={`pad_${i}`} style={styles.gridCell} />
      ))}
    </Animated.View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF8000" />
        <Text style={styles.loadingText}>Loading shops...</Text>
      </View>
    );
  }

  const modalQuantity = detailProduct ? (cart[getProductId(detailProduct)]?.quantity || 0) : 0;
  const modalPrice = detailProduct ? (detailProduct.base_price || 0).toFixed(2) : '0.00';
  const modalTotal = detailProduct
    ? ((detailProduct.base_price || 0) * (modalQuantity || 1)).toFixed(2)
    : '0.00';

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => router.replace('/home')} style={styles.backIconButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerGreeting}>Hello, {user?.full_name?.split(' ')[0] || 'User'} 👋</Text>
          <Text style={styles.headerSub}>What are you looking for today?</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/shopper/MyOrdersScreen' as any)} style={styles.ordersIconButton}>
          <Ionicons name="receipt-outline" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push('/shopper/CartScreen' as any)} style={styles.cartIconButton}>
          <Ionicons name="cart-outline" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutIconButton}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search stores or items..."
          placeholderTextColor="#aaa"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Text style={styles.clearSearch}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Categories Horizontal Scroller */}
      <View style={styles.catWrapper}>
        <FlatList
          horizontal
          data={categories}
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.catBtn,
                (selectedCategory === item.id || (!selectedCategory && item.id === 'all')) && styles.catBtnActive
              ]}
              onPress={() => handleCategorySelect(item.id)}
            >
              <Text style={[
                styles.catText,
                (selectedCategory === item.id || (!selectedCategory && item.id === 'all')) && styles.catTextActive
              ]}>
                {item.emoji || '📦'} {item.name}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.catList}
        />
      </View>

      {/* List */}
      <FlatList
        key={useGrid ? 'grid' : 'list'}
        data={listData}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item, index }) => {
          if ((item as any).__sectionHeader) {
            return <Text style={styles.sectionHeader}>{(item as any).title}</Text>;
          }
          if (isGridRow(item)) return renderGridRow(item, index);
          return selectedCategory ? renderProduct({ item }) : renderStore({ item, index });
        }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#FF8000']}
            tintColor="#FF8000"
          />
        }
        ListHeaderComponent={
          <Text style={styles.listHeader}>
            {selectedCategory
              ? `${filtered.length} products found`
              : `${filtered.length} stores available`}
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>
              {selectedCategory ? '📦' : '🏢'}
            </Text>

            <Text style={styles.emptyTitle}>
              {selectedCategory
                ? 'No products found'
                : 'No stores found'}
            </Text>

            <Text style={styles.emptySubtitle}>
              Try another search or category
            </Text>
          </View>
        }
      />

      {/* Product detail modal — additive only, no BlurView, doesn't touch add-to-cart flow */}
      <Modal
        visible={detailVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeProductDetail}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeProductDetail} />
        </Animated.View>

        <Animated.View style={[styles.sheet, sheetStyle]}>
          <View style={styles.sheetCard}>
            {detailProduct && (
              <>
                <ScrollView
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.scrollContent}
                >
                  <View style={styles.imageWrap}>
                    <GlowImage
                      uri={detailProduct.image_url}
                      style={styles.image}
                      radius={0}
                      placeholderEmoji="🍱"
                      shimmerWidth={SCREEN_W}
                    />
                    <LinearGradient
                      colors={['transparent', 'rgba(255,255,255,0.0)', 'rgba(255,255,255,0.98)']}
                      locations={[0, 0.55, 1]}
                      style={styles.imageFade}
                      pointerEvents="none"
                    />
                    <TouchableOpacity style={styles.closeBtn} onPress={closeProductDetail}>
                      <View style={styles.closeBtnInner}>
                        <Ionicons name="close" size={20} color="#fff" />
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.details}>
                    <View style={styles.titleRow}>
                      <Text style={styles.name}>{detailProduct.name}</Text>
                      <Text style={styles.price}>GHS {modalPrice}</Text>
                    </View>
                    <Text style={styles.storeName}>from {detailProduct.store_name || 'SokoApp'}</Text>

                    {detailProduct.description ? (
                      <Text style={styles.description}>{detailProduct.description}</Text>
                    ) : (
                      <Text style={[styles.description, { color: '#9ca3af' }]}>
                        No description provided for this item.
                      </Text>
                    )}

                    <View style={styles.divider} />

                    <View style={styles.qtyRow}>
                      <Text style={styles.qtyLabel}>Quantity</Text>
                      <View style={styles.qtyControls}>
                        <TouchableOpacity
                          style={[styles.qtyBtn, modalQuantity <= 0 && styles.qtyBtnDisabled]}
                          disabled={modalQuantity <= 0}
                          onPress={handleModalDecrement}
                        >
                          <Text style={styles.qtyBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.qtyCount}>{modalQuantity > 0 ? modalQuantity : 1}</Text>
                        <TouchableOpacity
                          style={styles.qtyBtn}
                          onPress={modalQuantity > 0 ? handleModalIncrement : () => handleAddToCart(detailProduct)}
                        >
                          <Text style={styles.qtyBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </ScrollView>

                <View style={[styles.ctaWrap, { paddingBottom: 18 + insets.bottom }]}>
                  <TouchableOpacity
                    style={styles.ctaBtn}
                    onPress={() => {
                      closeProductDetail();
                      handleAddToCart(detailProduct);
                    }}
                    activeOpacity={0.88}
                  >
                    <Text style={styles.ctaText}>
                      {modalQuantity > 0 ? `Update Cart · GHS ${modalTotal}` : `Add to Cart · GHS ${modalTotal}`}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </Animated.View>
      </Modal>
      <Toast
        visible={toast.visible}
        message={toast.message}
        actionLabel="View Cart"
        onAction={() => {
          setToast({
            visible: false,
            message: '',
          });

          router.push('/shopper/CartScreen' as any);
        }}
        onHide={() =>
          setToast({
            visible: false,
            message: '',
          })
        }
      />
    </SafeAreaView>
  );
}

const CARD_RADIUS = 28;
// List padding is 16 each side; 10px gap between the three grid cells.
const GRID_GAP = 10;
const GRID_CELL_W = (SCREEN_W - 32 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  loadingText: { marginTop: 12, color: '#888', fontSize: 14 },
  header: {
    backgroundColor: '#FF8000', paddingBottom: 20,
    paddingHorizontal: 20, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
  },
  headerGreeting: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  backIconButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
  },
  ordersIconButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    marginRight: 8,
  },
  cartIconButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    marginRight: 8,
  },
  logoutIconButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
  },
  logoutText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    margin: 16, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15, color: '#1a1a1a' },
  clearSearch: { fontSize: 16, color: '#aaa', paddingLeft: 8 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },
  catWrapper: { marginBottom: 10 },
  catList: { paddingHorizontal: 16 },
  catBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', marginRight: 10, borderWidth: 1, borderColor: '#eee'
  },
  catBtnActive: { backgroundColor: '#FF8000', borderColor: '#FF8000' },
  catText: { fontSize: 13, fontWeight: '600', color: '#555' },
  catTextActive: { color: '#fff' },
  productCard: {
    borderRadius: 24, marginBottom: 26, overflow: 'hidden',
    backgroundColor: '#111827', elevation: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14, shadowRadius: 14,
  },
  productImage: { width: '100%', height: 210, borderRadius: 24 },
  productImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF2E8',
  },
  productFade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '65%',
  },
  productTextWrap: {
    position: 'absolute', left: 18, right: 70, bottom: 16,
  },
  productName: { fontSize: 18, fontWeight: '800', color: '#fff' },
  productStore: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  productPrice: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  addBtn: {
    position: 'absolute', right: 14, bottom: 14,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,128,0,0.92)', alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
  },
  // Floating stepper pinned over the card image (product list cards only)
  cardQtyControls: {
    position: 'absolute', right: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6,
  },
  cardQtyBtn: {
    backgroundColor: '#FF8000', width: 26, height: 26,
    borderRadius: 13, justifyContent: 'center', alignItems: 'center',
  },
  cardQtyBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', lineHeight: 20 },
  cardQtyCount: { fontSize: 14, fontWeight: 'bold', color: '#fff', minWidth: 18, textAlign: 'center' },
  // Inline stepper next to the "Quantity" label in the product detail modal
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: {
    backgroundColor: '#FF8000', width: 28, height: 28,
    borderRadius: 14, justifyContent: 'center', alignItems: 'center',
  },
  qtyBtnDisabled: { backgroundColor: '#f0c199' },
  qtyBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', lineHeight: 20 },
  qtyCount: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a', minWidth: 18, textAlign: 'center' },
  listHeader: { fontSize: 13, color: '#888', marginBottom: 12 },
  sectionHeader: {
    fontSize: 13, fontWeight: '800', color: '#111827',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 8, marginBottom: 12,
  },
  cardWrapper: { marginBottom: 34 },
  card: {
    backgroundColor: '#fff', borderRadius: 20,
    overflow: 'hidden', elevation: 4, shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255, 128, 0, 0.08)',
  },
  cardClosed: { opacity: 0.7 },
  cardImageFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 60 },
  closedOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 160,
    backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', zIndex: 1,
  },
  closedOverlayText: { color: '#fff', fontWeight: '800', fontSize: 18, letterSpacing: 2 },
  closedBadge: { backgroundColor: '#f3f4f6' },
  closedText: { color: '#6b7280' },
  cardImage: { width: '100%', height: 180, resizeMode: 'cover' },
  cardImagePlaceholder: {
    width: '100%', height: 180, backgroundColor: '#FFF2E8',
    justifyContent: 'center', alignItems: 'center',
  },
  cardImageEmoji: { fontSize: 48 },
  cardBody: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardName: { fontSize: 17, fontWeight: '700', color: '#111827' },
  categoryBadge: { fontSize: 10, backgroundColor: '#fde8e8', color: '#FF8000', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontWeight: '700' },
  cardAddress: { fontSize: 13, color: '#64748b', marginBottom: 8 },
  cardDescription: { fontSize: 13.5, color: '#475569', marginBottom: 12, lineHeight: 20 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  openBadge: {
    backgroundColor: '#fde8e8', paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 20,
  },
  openText: { color: '#FF8000', fontSize: 12, fontWeight: '600' },
  orderNow: { color: '#FF8000', fontSize: 13, fontWeight: '700' },
  // ---- Compact 3-across grid (used when there are many cards) ----
  gridRow: { flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP + 4 },
  gridCell: { flex: 1 },
  gridCard: {
    backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden',
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255, 128, 0, 0.08)',
  },
  gridImage: { width: '100%', height: GRID_CELL_W * 0.9 },
  gridClosedOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, height: GRID_CELL_W * 0.9,
    backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center', zIndex: 1,
  },
  gridClosedText: { color: '#fff', fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  gridBody: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 },
  gridName: { fontSize: 12.5, fontWeight: '700', color: '#111827' },
  gridSub: { fontSize: 10.5, color: '#64748b', marginTop: 1 },
  gridStatus: { fontSize: 10.5, fontWeight: '600', color: '#FF8000', marginTop: 3 },
  gridPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  gridPrice: { flex: 1, fontSize: 11.5, fontWeight: '700', color: '#FF8000', marginRight: 4 },
  gridAddBtn: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#FF8000',
    alignItems: 'center', justifyContent: 'center',
  },
  gridQtyBadge: {
    position: 'absolute', top: 6, right: 6, minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FF8000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  gridQtyBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyEmoji: { fontSize: 52, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  emptySubtitle: { fontSize: 14, color: '#888', marginTop: 4 },

  // ---- Product detail modal ----
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,15,20,0.55)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: SCREEN_H * 0.82 },
  sheetCard: {
    flex: 1, borderTopLeftRadius: CARD_RADIUS, borderTopRightRadius: CARD_RADIUS,
    overflow: 'hidden', backgroundColor: '#fff',
  },
  scrollContent: { paddingBottom: 110 },
  imageWrap: { width: '100%', height: 260, position: 'relative' },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  imagePlaceholder: { backgroundColor: '#FFF2E8', justifyContent: 'center', alignItems: 'center' },
  imageFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 90 },
  closeBtn: { position: 'absolute', top: 16, right: 16, borderRadius: 20, overflow: 'hidden' },
  closeBtnInner: {
    width: 36, height: 36, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 18,
  },
  details: { paddingHorizontal: 22, paddingTop: 4 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  name: { fontSize: 21, fontWeight: '800', color: '#111827', flex: 1, marginRight: 12 },
  price: { fontSize: 18, fontWeight: '800', color: '#FF8000' },
  storeName: { fontSize: 13.5, color: '#6b7280', marginBottom: 14 },
  description: { fontSize: 14.5, color: '#374151', lineHeight: 22 },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginVertical: 20 },
  qtyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qtyLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  ctaWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)',
    backgroundColor: '#fff',
    paddingHorizontal: 20, paddingTop: 14,
    // paddingBottom is set inline (18 + insets.bottom) so it clears the
    // home indicator / gesture nav bar instead of a fixed platform guess.
  },
  ctaBtn: {
    backgroundColor: '#FF8000', borderRadius: 18, paddingVertical: 16, alignItems: 'center',
    shadowColor: '#FF8000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
