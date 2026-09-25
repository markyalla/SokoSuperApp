import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import { Text } from './Text';
import { WebView } from 'react-native-webview';

interface PaystackModalProps {
  visible: boolean;
  checkoutUrl: string;
  onClose: () => void;
  onDone: () => void;
}

// Reusable Paystack checkout WebView, mirroring the shopper checkout flow
// (app/(main)/shopper/checkoutScreen.tsx) so SokoIndex's contact-unlock and
// joining-fee payments behave identically to the rest of the app.
export default function PaystackModal({ visible, checkoutUrl, onClose, onDone }: PaystackModalProps) {
  const [webviewKey, setWebviewKey] = useState(0);

  const handleNavigationStateChange = (navState: any) => {
    const { url } = navState;
    if (url.includes('payment-success') || url.includes('callback') || url.includes('checkout/done')) {
      onDone();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onDone} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Done / Close</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Secure Payment</Text>
          <View style={styles.secure}>
            <Text style={styles.secureText}>🔒 SSL</Text>
          </View>
        </View>

        <WebView
          key={webviewKey}
          source={{ uri: checkoutUrl }}
          style={{ flex: 1 }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          // Card payments open the bank's 3-D Secure page as a new window;
          // load it in this WebView instead of silently dropping it.
          setSupportMultipleWindows={false}
          thirdPartyCookiesEnabled
          onNavigationStateChange={handleNavigationStateChange}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color="#e74c3c" />
              <Text style={styles.loadingText}>Loading Paystack...</Text>
            </View>
          )}
        />

        <TouchableOpacity style={styles.manualVerifyBtn} onPress={onDone}>
          <Text style={styles.manualVerifyText}>I have completed the payment</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#FF8000', paddingTop: 50, paddingBottom: 14,
    paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  closeBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  closeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  title: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  secure: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  secureText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  loading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff',
  },
  loadingText: { marginTop: 12, color: '#888', fontSize: 14 },
  manualVerifyBtn: { backgroundColor: '#d87819', padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eee' },
  manualVerifyText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
