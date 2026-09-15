import React from 'react';
import { StyleSheet, View } from 'react-native';

interface MiniBarChartProps {
  color?: string;
  height?: number;
}

export default function MiniBarChart({ color = '#14B8A6', height = 36 }: MiniBarChartProps) {
  const barHeights = [18, 26, 14, 32, 22, 28, 16];

  return (
    <View style={[styles.container, { height }]}>
      {barHeights.map((h, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: h,
              backgroundColor: color,
              opacity: i === 3 ? 1 : 0.45,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 6,
    marginVertical: 6,
  },
  bar: {
    width: 6,
    borderRadius: 3,
  },
});
