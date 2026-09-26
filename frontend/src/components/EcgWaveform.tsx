import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Animated } from 'react-native';

interface EcgWaveformProps {
  color?: string;
  height?: number;
}

export default function EcgWaveform({ color = '#8B5CF6', height = 36 }: EcgWaveformProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.95,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const peaks = [8, 12, 10, 28, 6, 34, 4, 18, 10, 14, 8];

  return (
    <Animated.View style={[styles.container, { height, transform: [{ scaleY: pulseAnim }] }]}>
      {peaks.map((h, idx) => (
        <View
          key={idx}
          style={[
            styles.bar,
            {
              height: h,
              backgroundColor: idx === 5 ? '#EF4444' : color,
              opacity: idx === 5 ? 1 : 0.6,
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 4,
    marginVertical: 6,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
});
