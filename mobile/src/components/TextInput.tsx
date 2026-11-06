import React, { forwardRef } from 'react';
import { TextInput as RNTextInput, TextInputProps } from 'react-native';

// Caps system font scaling at 1.2x so a large phone-level "Font size"
// setting can't overflow fixed-width inputs and get clipped, while
// still allowing some accessibility scaling (rather than disabling it).
export const TextInput = forwardRef<RNTextInput, TextInputProps>((props, ref) => (
  <RNTextInput ref={ref} maxFontSizeMultiplier={1.2} {...props} />
));
