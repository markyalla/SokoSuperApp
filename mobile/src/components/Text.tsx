import React, { forwardRef } from 'react';
import { Text as RNText, TextProps } from 'react-native';

// Caps system font scaling at 1.2x so a large phone-level "Font size"
// setting can't overflow fixed-width containers and get clipped, while
// still allowing some accessibility scaling (rather than disabling it).
export const Text = forwardRef<RNText, TextProps>((props, ref) => (
  <RNText ref={ref} maxFontSizeMultiplier={1.2} {...props} />
));
