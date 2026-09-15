import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Icon from './Icon';

interface ArcProgressGaugeProps {
  currentValue: number | string;
  goalValue?: number | string;
  label?: string;
  iconName?: any;
}

export default function ArcProgressGauge({
  currentValue = '98%',
  goalValue = 'Safe',
  label = 'Safety Index',
  iconName = 'shield-check',
}: ArcProgressGaugeProps) {
  // Format formatted value (e.g., 7,235)
  const displayVal = typeof currentValue === 'number' 
    ? currentValue.toLocaleString('en-US') 
    : currentValue;

  return (
    <View style={styles.container}>
      {/* Outer Semi-Circular Arc Graphic */}
      <View style={styles.arcOuterCircle}>
        <View style={styles.arcInnerCircle}>
          {/* Top Dotted Arc Line Emulation */}
          <View style={styles.dotsRow}>
            {Array.from({ length: 15 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < 11 ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>

          {/* Center Content */}
          <View style={styles.centerBox}>
            <View style={styles.iconCircle}>
              <Icon name={iconName} size={22} color="#6C5CE7" />
            </View>
            <Text style={styles.valueText}>{displayVal}</Text>
            <Text style={styles.labelText}>{label}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  arcOuterCircle: {
    width: 210,
    height: 140,
    borderRadius: 105,
    borderTopLeftRadius: 105,
    borderTopRightRadius: 105,
    borderWidth: 10,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderBottomWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 12,
    position: 'relative',
  },
  arcInnerCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 170,
    position: 'absolute',
    top: -4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginHorizontal: 3,
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
  },
  dotInactive: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 4,
  },
  valueText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  labelText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13,
    fontWeight: '500',
    marginTop: -2,
  },
});
