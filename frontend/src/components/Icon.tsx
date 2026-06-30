import React from 'react';
import { OpaqueColorValue, StyleProp, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface IconProps {
  name: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  size?: number;
  color?: string | OpaqueColorValue;
  style?: StyleProp<ViewStyle>;
}

export default function Icon({ name, size = 24, color, style }: IconProps) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color}
      style={style}
    />
  );
}
