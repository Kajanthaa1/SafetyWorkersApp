import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform } from 'react-native';
import { COLORS } from '../styles/theme';
import Icon from './Icon';

interface SmartwatchHeroCardProps {
  onConnectPress?: () => void;
  isConnected?: boolean;
}

export default function SmartwatchHeroCard({
  onConnectPress,
  isConnected = false,
}: SmartwatchHeroCardProps) {
  return (
    <View style={styles.card}>

      <View style={styles.watchBgCircle}>
        <View style={styles.watchFrame}>
          <Icon name="watch-variant" size={72} color="#1E1B4B" />
          <View style={styles.watchScreenText}>
            <Text style={styles.watchTimeText}>12:45</Text>
            <Text style={styles.watchBpmText}>98% SpO2</Text>
          </View>
        </View>
      </View>

      <Text style={styles.titleText}>
        Make More Safety for{"\n"}you that <Text style={styles.highlightText}>Matters Most</Text>
      </Text>

      <TouchableOpacity
        style={[styles.actionButton, isConnected && styles.actionButtonConnected]}
        onPress={onConnectPress}
        activeOpacity={0.8}
      >
        <Icon
          name={isConnected ? 'check' : 'bluetooth-connect'}
          size={24}
          color="#FFFFFF"
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderRadius: 28,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginVertical: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  watchBgCircle: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: 'rgba(240, 237, 255, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(233, 216, 253, 0.9)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } : {}),
  },
  watchFrame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchScreenText: {
    position: 'absolute',
    alignItems: 'center',
  },
  watchTimeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6C5CE7',
  },
  watchBpmText: {
    fontSize: 8,
    fontWeight: '600',
    color: '#64748B',
  },
  titleText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E1B4B',
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 16,
  },
  highlightText: {
    color: '#6C5CE7',
  },
  actionButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#6C5CE7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  actionButtonConnected: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
  },
});
