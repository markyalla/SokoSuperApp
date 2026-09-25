import React, { useEffect, useRef } from 'react';
import { Modal, View, Image, TouchableOpacity, StyleSheet, FlatList, Dimensions } from 'react-native';
import { Text } from './Text';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ImagePreviewModalProps {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

// Full-screen, swipeable image preview reused anywhere a thumbnail (artisan
// avatar, customer avatar, portfolio photo) needs to open in a larger view.
export default function ImagePreviewModal({ visible, images, initialIndex = 0, onClose }: ImagePreviewModalProps) {
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    if (visible && initialIndex > 0) {
      // Defer to next tick so the FlatList has laid out before jumping.
      setTimeout(() => listRef.current?.scrollToIndex({ index: initialIndex, animated: false }), 0);
    }
  }, [visible, initialIndex]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <FlatList
          ref={listRef}
          data={images}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.page}>
              <Image source={{ uri: item }} style={styles.image} resizeMode="contain" />
            </View>
          )}
        />
        {images.length > 1 ? (
          <Text style={styles.counter}>{images.length} photos — swipe to view</Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  closeBtn: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 6 },
  page: { width: SCREEN_WIDTH, alignItems: 'center', justifyContent: 'center' },
  image: { width: SCREEN_WIDTH, height: '80%' },
  counter: { position: 'absolute', bottom: 40, alignSelf: 'center', color: '#e5e7eb', fontSize: 13 },
});
