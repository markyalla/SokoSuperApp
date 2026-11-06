import React from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Image, Alert, StatusBar, ScrollView, ActivityIndicator } from 'react-native';
import { Text } from '../../../src/components/Text';
import  { useEffect, useState,useCallback} from  'react';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { getDeliveryFee, getStore, getStoreProducts } from '../../../src/api';
import { useAuthStore } from '../../../src/store/authStore';
import { useFocusEffect, useRouter } from 'expo-router';

interface Product {
  id: string | number;
  name: string;
  base_price: number;
  image_url?: string;
  store_id: string;
  original_price?: number;
  holiday_pricing?: boolean;
  holiday_name?: string;
}

interface CartItem {
  id: string | number;
  name: string;
  price: number;
  quantity: number;
  image_url?: string;
  store_id: string;
  original_price?: number;
  holiday_pricing?: boolean;
  holiday_name?: string;
};

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cart, cartTotal, cartCount, updateQuantity, clearCart, tokens, addToCart } = useAuthStore() as any;
  const items = Object.values(cart || {}) as CartItem[];
  const [deliveryFee, setDeliveryFee] = useState(15);
  const [feeReason, setFeeReason] = useState('');

  const [featuredItems, setFeaturedItems] = useState<Product[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(false);
  const [storeLogo, setStoreLogo] = useState<string | null>(null);

  const fetchFee = async () => {
  if (!tokens?.access) return;

  try {
    const currentStoreId = items[0]?.store_id;

    // Fetch store details to get the logo for fallback
    if (currentStoreId && !storeLogo) {
      const sRes = await getStore(currentStoreId);
      setStoreLogo(sRes.data.logo_url || sRes.data.cover_image_url || null);
    }

    const response = await getDeliveryFee();
    setDeliveryFee(response.data.fee);
    setFeeReason(response.data.reason);
  } catch (error) {
    console.log('Delivery fee error:', error);
  }
};

  const fetchFeaturedItems = async () => {
    // Only show featured items if there's something in the cart 
    // to ensure we suggest items from the same restaurant
    if (items.length === 0) {
      setFeaturedItems([]);
      return;
    }

    setLoadingFeatured(true);
    try {
      const currentStoreId = items[0].store_id;
      if (!currentStoreId) return;

      const response = await getStoreProducts(currentStoreId);
      const products = response.data as Product[];

      // Filter out items already in the cart and show up to 5 others
      const cartItemIds = new Set(items.map(i => String(i.id)));
      const filtered = products
        .filter(f => !cartItemIds.has(String(f.id)))
        .map(f => ({ ...f, store_id: currentStoreId }));
      
      setFeaturedItems(filtered.slice(0, 5));
    } catch (error) {
      console.log('Featured items error:', error);
    } finally {
      setLoadingFeatured(false);
    }
  };

useFocusEffect(
  useCallback(() => {
    fetchFee();
    fetchFeaturedItems();
  }, [tokens?.access, cartCount, items.length])
);

  const handleClearCart = () => {
    Alert.alert('Clear Cart', 'Remove all items from cart?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearCart }
    ]);
  };

  const renderItem = ({ item }: { item: CartItem }) => (
    <View style={styles.card}>
      {(item.image_url || storeLogo) ? (
        <Image source={{ uri: item.image_url || storeLogo || undefined }} style={styles.itemImage} />
      ) : (
        <View style={styles.itemImagePlaceholder}>
          <Text style={styles.itemImageEmoji}>🍱</Text>
        </View>
      )}
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.itemPrice}>GHS {item.price?.toFixed(2)}</Text>
          {item.holiday_pricing && item.original_price != null && (
            <Text style={styles.itemOriginalPrice}>GHS {item.original_price.toFixed(2)}</Text>
          )}
        </View>
        {item.holiday_pricing && (
          <Text style={styles.itemHolidayNote}>🎉 Holiday pricing{item.holiday_name ? ` — ${item.holiday_name}` : ''}</Text>
        )}
        <Text style={styles.itemSubtotal}>
          Subtotal: GHS {(item.price * item.quantity).toFixed(2)}
        </Text>
      </View>
      <View style={styles.qtyControls}>
        <TouchableOpacity
          style={styles.qtyBtn}
          onPress={() => updateQuantity(item.id, item.quantity - 1)}
        >
          <Text style={styles.qtyBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.qtyText}>{item.quantity}</Text>
        <TouchableOpacity
          style={styles.qtyBtn}
          onPress={() => updateQuantity(item.id, item.quantity + 1)}
        >
          <Text style={styles.qtyBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderFeaturedItem = (item: Product) => (
    <View key={item.id} style={styles.featuredCard}>
      {(item.image_url || storeLogo) ? (
        <Image source={{ uri: item.image_url || storeLogo || undefined }} style={styles.featuredImage} />
      ) : (
        <View style={[styles.featuredImage, styles.featuredImagePlaceholder]}>
          <Text style={{ fontSize: 20 }}>🍱</Text>
        </View>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.82)']}
        locations={[0, 0.4, 1]}
        style={styles.featuredFade}
        pointerEvents="none"
      />

      <View style={styles.featuredTextWrap} pointerEvents="none">
        <Text style={styles.featuredName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.featuredPrice}>GHS {item.base_price?.toFixed(2)}</Text>
        {item.holiday_pricing && (
          <Text style={styles.featuredHolidayNote}>🎉 Holiday pricing</Text>
        )}
      </View>

      <TouchableOpacity
        style={styles.featuredAddBtn}
        onPress={() => {
          addToCart({
            id: item.id,
            name: item.name,
            price: item.base_price,
            image_url: item.image_url,
            quantity: 1,
            store_id: item.store_id,
            original_price: item.original_price,
            holiday_pricing: item.holiday_pricing,
            holiday_name: item.holiday_name,
          });
        }}
      >
        <Ionicons name="add" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  if (items.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="cart-outline" size={48} color="#FF8000" />
          </View>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptySub}>Add items from a shop to get started</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()}>
            <Text style={styles.emptyBtnText}>Continue Shopping</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Text style={styles.headerTitle}> My Cart</Text>
        <TouchableOpacity onPress={handleClearCart}>
          <Text style={styles.clearText}>Clear all</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={item => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          <View style={styles.featuredSection}>
            <Text style={styles.featuredTitle}>Add featured items</Text>
            {loadingFeatured ? (
              <ActivityIndicator color="#FF8000" />
            ) : (
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 20 }}
              >
                {featuredItems.map(item => (
                  !cart[String(item.id)] && renderFeaturedItem(item)
                ))}
              </ScrollView>
            )}
          </View>
        }
      />

      {/* Summary */}
      <View style={[styles.summary, { paddingBottom: 20 + insets.bottom }]}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Items ({cartCount})</Text>
          <Text style={styles.summaryValue}>GHS {cartTotal.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Delivery fee</Text>
          <Text style={styles.summaryValue}>GHS {deliveryFee.toFixed(2)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>GHS {(cartTotal + deliveryFee).toFixed(2)}</Text>
        </View>
        <TouchableOpacity
          style={styles.checkoutBtn}
          onPress={() => router.push('/shopper/checkoutScreen' as any)}
        >
          <Text style={styles.checkoutBtnText}>Proceed to Checkout →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  emptyContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 24
  },
  emptyCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, alignItems: 'center', width: '100%', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  emptyIconWrap: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#111827' },
  emptySub: { fontSize: 14, color: '#6b7280', marginTop: 6, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
  emptyBtn: { marginTop: 16, backgroundColor: '#FF8000', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  emptyBtnText: { color: '#fff', fontWeight: '700' },
  header: {
    backgroundColor: '#FF8000', paddingBottom: 16,
    paddingHorizontal: 20, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  clearText: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  list: { padding: 16, paddingBottom: 8 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 3,
  },
  itemImage: {
    width: 70,
    height: 70,
    borderRadius: 12,
    resizeMode: 'cover',
    borderWidth: 2.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    // Glow effect
    shadowColor: '#FF8000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  itemImagePlaceholder: {
    width: 70, height: 70, borderRadius: 12, backgroundColor: '#E1F5EE',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2.5, borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  itemImageEmoji: { fontSize: 26 },
  itemInfo: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a', marginBottom: 3 },
  itemPrice: { fontSize: 13, color: '#888', marginBottom: 3 },
  itemOriginalPrice: { fontSize: 12, color: '#bbb', textDecorationLine: 'line-through', marginBottom: 3 },
  itemHolidayNote: { fontSize: 11, fontWeight: '700', color: '#FF8000', marginBottom: 3 },
  itemSubtotal: { fontSize: 13, fontWeight: '700', color: '#FF8000' },
  qtyControls: { alignItems: 'center', marginLeft: 8 },
  qtyBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#f0f0f0',
    justifyContent: 'center', alignItems: 'center',
  },
  qtyBtnText: { fontSize: 18, color: '#333', lineHeight: 22 },
  qtyText: { fontSize: 15, fontWeight: 'bold', color: '#1a1a1a', marginVertical: 4 },
  summary: {
    backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 20,
    borderTopRightRadius: 20, elevation: 8, shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.1, shadowRadius: 6,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  summaryLabel: { fontSize: 14, color: '#888' },
  summaryValue: { fontSize: 14, color: '#333', fontWeight: '500' },
  totalRow: {
    borderTopWidth: 1, borderTopColor: '#f0f0f0',
    paddingTop: 12, marginTop: 4, marginBottom: 16,
  },
  totalLabel: { fontSize: 16, fontWeight: 'bold', color: '#1a1a1a' },
  totalValue: { fontSize: 18, fontWeight: 'bold', color: '#FF8000' },
  checkoutBtn: {
    backgroundColor: '#FF8000', paddingVertical: 15, borderRadius: 12,
    alignItems: 'center', elevation: 2,
  },
  checkoutBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  featuredSection: { marginTop: 20, marginBottom: 20, paddingHorizontal: 4 },
  featuredTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 12 },
  featuredCard: {
    width: 150, height: 180, borderRadius: 20, overflow: 'hidden',
    backgroundColor: '#111827', marginRight: 14,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 8,
  },
  featuredImage: { width: '100%', height: '100%' },
  featuredImagePlaceholder: { backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  featuredFade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '65%',
  },
  featuredTextWrap: {
    position: 'absolute', left: 12, right: 40, bottom: 12,
  },
  featuredName: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  featuredPrice: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.9)', marginTop: 3 },
  featuredHolidayNote: { fontSize: 9.5, fontWeight: '700', color: '#FF8000', marginTop: 2 },
  featuredAddBtn: {
    position: 'absolute', right: 10, bottom: 10,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(255,128,0,0.92)', alignItems: 'center', justifyContent: 'center',
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
  },
});