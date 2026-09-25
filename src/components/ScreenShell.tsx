import React from 'react';
import { StatusBar, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Text } from './Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type ScreenShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  backgroundColor?: string;
  contentStyle?: ViewStyle;
  hideHeader?: boolean;
};

export function ScreenShell({
  title,
  subtitle,
  children,
  onBack,
  rightAction,
  backgroundColor = '#f5f5f5',
  contentStyle,
  hideHeader = false,
}: ScreenShellProps) {
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: hideHeader ? backgroundColor : '#FF8000' }]}>
      <StatusBar barStyle="light-content" backgroundColor="#FF8000" />
      {!hideHeader ? (
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack ?? (() => router.back())}
            style={styles.iconButton}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle}>{title}</Text>
            {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
          </View>
          <View style={styles.rightSlot}>{rightAction}</View>
        </View>
      ) : null}
      <View style={[styles.content, { backgroundColor }, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    backgroundColor: '#FF8000',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: { flex: 1, minWidth: 0 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  rightSlot: { minWidth: 40, alignItems: 'flex-end' },
  content: { flex: 1 },
});
