import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator, Alert, StatusBar, Modal, ScrollView, Dimensions } from 'react-native';
import { Text } from '../../../src/components/Text';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring,
  withRepeat, withDelay, Easing,
} from 'react-native-reanimated';
import { useAuthStore } from '../../../src/store/authStore';
import { Ionicons } from '@expo/vector-icons';
import { getStore, getStoreProducts } from '../../../src/api';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Toast from '../../../src/components/Toast';
import { friendlyError } from '../../../src/utils/friendlyError';

interface Product {
  id: string | number;
  name: string;
  base_price: number;
  image_url?: string;
  store_id: string;
  description?: string;
  original_price?: number;
  holiday_pricing?: boolean;
  holiday_name?: string;
  holiday_surcharge_pct?: number;
}

interface Store {
  id: string;
  name: string;
  address: string;
  cover_image_url?: string;
  logo_url?: string;
  description?: string;
  category?: { name: string };
};

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

export default function ShopDetailScreen() {
  const router = useRouter();
  const { shopId } = useLocalSearchParams<{ shopId: string }>();
  const { addToCart, updateQuantity, cart, cartCount } = useAuthStore() as any;

  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedItems, setAddedItems] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState({ visible: false, message: '' });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isProductModalVisible, setIsProductModalVisible] = useState(false); 
  const sheetTranslateY = useSharedValue(SCREEN_H);
  const backdropOpacity = useSharedValue(0);

  // Drives the modal's slide-up/fade animation
    useEffect(() => {
      if (isProductModalVisible) {
        sheetTranslateY.value = withSpring(0, { damping: 18, stiffness: 160 });
        backdropOpacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.ease) });
      } else {
        sheetTranslateY.value = withTiming(SCREEN_H, { duration: 220, easing: Easing.in(Easing.ease) });
        backdropOpacity.value = withTiming(0, { duration: 180 });
      }
    }, [isProductModalVisible]);
  
    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetTranslateY.value }] }));
    const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  useEffect(() => {
    loadShop();
  }, []);

  const loadShop = async () => {
    if (!shopId) return;
    try {
      const [storeRes, productsRes] = await Promise.all([
        getStore(shopId),
        getStoreProducts(shopId)
      ]);
      setStore(storeRes.data);
      setProducts(productsRes.data);
    } catch (e: any) {
      Alert.alert('Error', friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  const getProductId = (item: Product) => String(item.id);

  const handleAddToCart = (item: Product) => {
    const id = getProductId(item);
    addToCart({
      id: id,
      name: item.name,
      price: item.base_price,
      image_url: item.image_url,
      quantity: 1,
      store_id: String(shopId),
      original_price: item.original_price,
      holiday_pricing: item.holiday_pricing,
      holiday_name: item.holiday_name,
    });
    setAddedItems(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setAddedItems(prev => ({ ...prev, [id]: false })), 1000);
    setToast({ visible: true, message: `${item.name} added to cart!` });
  };

  const openProductDetails = (item: Product) => {
    setSelectedProduct(item);
    setIsProductModalVisible(true);
  };

  const closeProductDetails = () => {
    setIsProductModalVisible(false);
    setSelectedProduct(null);
  };

  const handleModalIncrement = () => {
    if (!selectedProduct) return;
    const id = getProductId(selectedProduct);
    const current = cart[id];
    if (current) updateQuantity(id, current.quantity + 1);
  };

  const handleModalDecrement = () => {
    if (!selectedProduct) return;
    const id = getProductId(selectedProduct);
    const current = cart[id];
    if (current) updateQuantity(id, current.quantity - 1);
  };

  const renderFoodItem = ({ item }: { item: Product }) => {
    const added = addedItems[String(item.id)];
    return (
      <TouchableOpacity
        style={styles.foodCard}
        activeOpacity={0.9}
        onPress={() => openProductDetails(item)}
      >
        {(item.image_url || store?.logo_url) ? (
          <GlowImage
            uri={item.image_url || store?.logo_url}
            style={styles.foodImage}
            radius={24}
            placeholderEmoji="🍱"
          />
        ) : (
          <View style={[styles.foodImage, styles.foodImagePlaceholder]}>
            <Text style={styles.foodImageEmoji}>🍱</Text>
          </View>
        )}

        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.78)']}
          locations={[0, 0.45, 1]}
          style={styles.foodFade}
          pointerEvents="none"
        />

        <View style={styles.foodTextWrap} pointerEvents="none">
          <Text style={styles.foodName} numberOfLines={1}>{item.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.foodPrice}>GHS {(item.base_price || 0).toFixed(2)}</Text>
            {item.holiday_pricing && item.original_price != null && (
              <Text style={styles.foodOriginalPrice}>GHS {item.original_price.toFixed(2)}</Text>
            )}
          </View>
          {item.holiday_pricing && (
            <View style={styles.holidayBadge}>
              <Text style={styles.holidayBadgeText}>🎉 Holiday pricing</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.addBtn, added && styles.addBtnAdded]}
          onPress={(event) => {
            event.stopPropagation();
            handleAddToCart(item);
          }}
        >
          <Ionicons name={added ? 'checkmark' : 'add'} size={20} color="#fff" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF8000" />
      </View>
    );
  }

  if (!store) return null;

  const modalQuantity = selectedProduct ? (cart[getProductId(selectedProduct)]?.quantity || 0) : 0;
  const modalTotal = selectedProduct
    ? ((selectedProduct.base_price || 0) * (modalQuantity || 1)).toFixed(2)
    : '0.00';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Hero Image */}
      <View style={styles.hero}>
        {(store.cover_image_url || store.logo_url) ? (
          <GlowImage
              uri={store.cover_image_url || store.logo_url}
              style={styles.heroImage}
              radius={0}
              placeholderEmoji="🛍️"
            />
        ) : (
          <View style={styles.heroPlaceholder}>
            <Text style={styles.heroEmoji}>🛍️</Text>
          </View>
        )}
        <View style={styles.heroOverlay} />

        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.cartBtn} onPress={() => router.push('/shopper/CartScreen' as any)}>
          <Ionicons name="cart-outline" size={18} color="#fff" />
          <Text style={styles.cartBtnText}>{cartCount}</Text>
        </TouchableOpacity>

        <View style={styles.heroInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.heroName}>{store.name}</Text>
            {store.category?.name && (
              <Text style={styles.heroCategory}>{store.category.name}</Text>
            )}
          </View>
          <Text style={styles.heroAddress}>📍 {store.address}</Text>
          {store.description ? <Text style={styles.heroDescription} numberOfLines={2}>{store.description}</Text> : null}
        </View>
      </View>

      {/* Menu */}
      <FlatList
        data={products}
        keyExtractor={item => String(item.id)}
        renderItem={renderFoodItem}
        contentContainerStyle={styles.menuList}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <Text style={styles.menuHeader}>
            Available Items — {products.length} items
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🛍️</Text>
            <Text style={styles.emptyText}>No menu items available yet</Text>
          </View>
        }
      />
      <Modal
          visible={isProductModalVisible}
          transparent
          animationType="none"
          statusBarTranslucent
          onRequestClose={closeProductDetails}
          >
            
            <Animated.View style={[styles.backdrop, backdropStyle]}>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={closeProductDetails}
              />
            </Animated.View>


            <Animated.View style={[styles.sheet, sheetStyle]}>

              <View style={styles.sheetCard}>

                {selectedProduct && (

                  <>
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.scrollContent}
                  >

                    <View style={styles.imageWrap}>

                      <GlowImage
                        uri={selectedProduct.image_url || store.logo_url}
                        style={styles.image}
                        radius={0}
                        placeholderEmoji="🍱"
                        shimmerWidth={SCREEN_W}
                      />


                      <LinearGradient
                        colors={[
                          'transparent',
                          'rgba(255,255,255,0.98)'
                        ]}
                        style={styles.imageFade}
                      />


                      <TouchableOpacity
                        style={styles.closeBtn}
                        onPress={closeProductDetails}
                      >
                        <View style={styles.closeBtnInner}>
                          <Ionicons
                            name="close"
                            size={20}
                            color="#fff"
                          />
                        </View>
                      </TouchableOpacity>

                    </View>



                    <View style={styles.details}>

                      <View style={styles.titleRow}>

                        <Text style={styles.name}>
                          {selectedProduct.name}
                        </Text>


                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.price}>
                            GHS {selectedProduct.base_price.toFixed(2)}
                          </Text>
                          {selectedProduct.holiday_pricing && selectedProduct.original_price != null && (
                            <Text style={styles.modalOriginalPrice}>
                              GHS {selectedProduct.original_price.toFixed(2)}
                            </Text>
                          )}
                        </View>

                      </View>


                      <Text style={styles.storeName}>
                        from {store.name}
                      </Text>

                      {selectedProduct.holiday_pricing && (
                        <View style={[styles.holidayBadge, { alignSelf: 'flex-start', marginTop: 8 }]}>
                          <Text style={styles.holidayBadgeText}>
                            🎉 Holiday pricing{selectedProduct.holiday_surcharge_pct ? ` +${selectedProduct.holiday_surcharge_pct.toFixed(0)}%` : ''}
                            {selectedProduct.holiday_name ? ` — ${selectedProduct.holiday_name}` : ''}
                          </Text>
                        </View>
                      )}

                      <Text style={styles.description}>
                        {selectedProduct.description ||
                        "No description provided"}
                      </Text>

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
                            onPress={modalQuantity > 0 ? handleModalIncrement : () => handleAddToCart(selectedProduct)}
                          >
                            <Text style={styles.qtyBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                    </View>


                  </ScrollView>



                  <View style={styles.ctaWrap}>

                    <TouchableOpacity
                      style={styles.ctaBtn}
                      onPress={() => {
                        closeProductDetails();
                        handleAddToCart(selectedProduct);
                      }}
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
          setToast({ visible: false, message: '' });
          router.push('/shopper/CartScreen' as any);
        }}
        onHide={() => setToast({ visible: false, message: '' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  hero: { height: 260, position: 'relative' },
  heroImage: {
    width: '100%', height: '100%', resizeMode: 'cover',
    shadowColor: '#FF8000', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25, shadowRadius: 16,
  },
  heroPlaceholder: {
    width: '100%', height: '100%', backgroundColor: '#FFF2E8',
    justifyContent: 'center', alignItems: 'center',
  },
  heroEmoji: { fontSize: 64 },
  heroOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  backBtn: {
    position: 'absolute', top: 48, left: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
  },
  cartBtn: {
    position: 'absolute', top: 44, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FF8000', paddingHorizontal: 14,
    paddingVertical: 8, borderRadius: 20,
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 3,
  },
  cartBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  heroInfo: {
    position: 'absolute', bottom: 16, left: 16, right: 16,
  },
  heroName: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  heroCategory: { fontSize: 10, backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontWeight: '700', overflow: 'hidden' },
  heroAddress: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  heroDescription: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
  menuList: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 },
  menuHeader: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 18 },
  foodCard: {
    borderRadius: 24, marginBottom: 26, overflow: 'hidden',
    backgroundColor: '#111827', elevation: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14, shadowRadius: 14,
  },
  foodImage: {
    width: '100%', height: 210, borderRadius: 24,
  },
  foodImagePlaceholder: {
    backgroundColor: '#FFF2E8', justifyContent: 'center', alignItems: 'center',
  },
  foodImageEmoji: { fontSize: 40 },
  foodFade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '65%',
  },
  foodTextWrap: {
    position: 'absolute', left: 18, right: 70, bottom: 16,
  },
  foodName: { fontSize: 18, fontWeight: '800', color: '#fff' },
  foodPrice: { fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  foodOriginalPrice: { fontSize: 12, color: 'rgba(255,255,255,0.55)', textDecorationLine: 'line-through' },
  holidayBadge: {
    backgroundColor: 'rgba(255,128,0,0.92)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 4, alignSelf: 'flex-start',
  },
  holidayBadgeText: { fontSize: 10.5, fontWeight: '700', color: '#fff' },
  addBtn: {
    position: 'absolute', right: 14, bottom: 14,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,128,0,0.92)', alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4,
  },
  addBtnAdded: { backgroundColor: 'rgba(22,163,74,0.92)' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingTop: 12,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  modalCloseBtn: {
    alignSelf: 'flex-end',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  modalContent: { paddingBottom: 8 },
  modalImage: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    resizeMode: 'cover',
    marginBottom: 14,
  },
  modalImagePlaceholder: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    backgroundColor: '#FFF2E8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalImageEmoji: { fontSize: 40 },
  modalName: { fontSize: 22, fontWeight: '700', color: '#111827' },
  modalPrice: { fontSize: 18, fontWeight: '700', color: '#FF8000', marginTop: 6 },
  modalDescription: { fontSize: 14, color: '#475569', lineHeight: 22, marginTop: 10 },
  modalMetaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 8 },
  modalMetaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  modalMetaText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  modalAddBtn: {
    backgroundColor: '#FF8000',
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  modalAddBtnAdded: { backgroundColor: '#16a34a' },
  modalAddBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontSize: 48, marginBottom: 10 },
  emptyText: { fontSize: 15, color: '#888' },
  
 backdrop:{
 position:'absolute',
 top:0,
 left:0,
 right:0,
 bottom:0,
 backgroundColor:'rgba(15,15,20,0.55)'
},
sheet:{
 position:'absolute',
 left:0,
 right:0,
 bottom:0,
 height:SCREEN_H * 0.82
},
sheetCard:{
 flex:1,
 borderTopLeftRadius:28,
 borderTopRightRadius:28,
 overflow:'hidden',
 backgroundColor:'#fff'
},
scrollContent:{
 paddingBottom:110
},
imageWrap:{
 width:'100%',
 height:260,
 position:'relative'
},
image:{
 width:'100%',
 height:'100%',
 resizeMode:'cover'
},
imageFade:{
 position:'absolute',
 left:0,
 right:0,
 bottom:0,
 height:90
},
closeBtn:{
 position:'absolute',
 top:16,
 right:16
},
closeBtnInner:{
 width:36,
 height:36,
 borderRadius:18,
 backgroundColor:'rgba(0,0,0,0.45)',
 justifyContent:'center',
 alignItems:'center'
},
details:{
 paddingHorizontal:22,
},
titleRow:{
 flexDirection:'row',
 justifyContent:'space-between'
},


name:{
 fontSize:21,
 fontWeight:'800',
 flex:1
},
price:{
 fontSize:18,
 fontWeight:'800',
 color:'#FF8000'
},
modalOriginalPrice: { fontSize: 13, color: '#9ca3af', textDecorationLine: 'line-through' },
storeName:{
 marginTop:5,
 color:'#6b7280'
},
description:{
 marginTop:15,
 fontSize:14,
 lineHeight:22
},
divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.08)', marginVertical: 20 },
qtyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
qtyLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
qtyBtn: {
  backgroundColor: '#FF8000', width: 28, height: 28,
  borderRadius: 14, justifyContent: 'center', alignItems: 'center',
},
qtyBtnDisabled: { backgroundColor: '#f0c199' },
qtyBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', lineHeight: 20 },
qtyCount: { fontSize: 14, fontWeight: 'bold', color: '#1a1a1a', minWidth: 18, textAlign: 'center' },
ctaWrap:{
 position:'absolute',
 bottom:0,
 left:0,
 right:0,
 padding:20,
 backgroundColor:'#fff',
 borderTopWidth:1,
 borderColor:'#eee'
},
ctaBtn:{
 backgroundColor:'#FF8000',
 borderRadius:18,
 paddingVertical:16,
 alignItems:'center'
},
ctaText:{
 color:'#fff',
 fontSize:16,
 fontWeight:'800'
}
});