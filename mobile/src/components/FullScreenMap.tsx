import React, { useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { mapsAvailable } from '../config/maps';

export interface MapPin {
  key: string;
  coordinate: { latitude: number; longitude: number };
  title: string;
  color: string;
}

interface Props {
  pins: MapPin[];
  onClose: () => void;
  loading?: boolean;
  emptyText?: string;
}

// Full-screen in-app map with only a close button. Rendered as an absolutely
// positioned overlay rather than RN's <Modal>: react-native-maps' MapView
// crashes on Android when mounted inside a Modal's separate Dialog window.
// The region is uncontrolled so the user can pan/zoom freely while the pins
// keep moving with live location updates.
export function FullScreenMap({ pins, onClose, loading, emptyText }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const fitted = useRef(false);

  const fitPins = () => {
    if (fitted.current || pins.length < 2) return;
    fitted.current = true;
    mapRef.current?.fitToCoordinates(pins.map(p => p.coordinate), {
      edgePadding: { top: 120, right: 60, bottom: 80, left: 60 },
      animated: false,
    });
  };

  let body: React.ReactNode;
  if (loading) {
    body = <ActivityIndicator size="large" color="#FF8000" />;
  } else if (!mapsAvailable || pins.length === 0) {
    body = (
      <Text style={styles.emptyText}>
        {!mapsAvailable ? 'Map is not available in this version of the app.' : emptyText || 'Location not available yet.'}
      </Text>
    );
  } else {
    const first = pins[0].coordinate;
    body = (
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...first, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        onMapReady={fitPins}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {pins.map(p => (
          <Marker key={p.key} coordinate={p.coordinate} title={p.title} pinColor={p.color} />
        ))}
      </MapView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.center}>{body}</View>
      <TouchableOpacity
        style={[styles.closeBtn, { top: insets.top + 12 }]}
        onPress={onClose}
        accessibilityLabel="Close map"
        hitSlop={10}
      >
        <Ionicons name="close" size={26} color="#1a1a1a" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, backgroundColor: '#f5f5f5', zIndex: 999, elevation: 999 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, color: '#666', textAlign: 'center', paddingHorizontal: 32 },
  closeBtn: {
    position: 'absolute', left: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
