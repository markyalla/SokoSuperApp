import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const DELIVERY_ADDRESS_KEY = 'deliveryAddress';
const DELIVERY_INSTRUCTIONS_KEY = 'deliveryInstructions';

interface LocationState {
  deliveryAddress: string;
  deliveryInstructions: string;
  setDeliveryAddress: (address: string) => void;
  setDeliveryInstructions: (instructions: string) => void;
  loadSavedLocation: () => Promise<void>;
  saveLocation: () => Promise<void>;
}

export const useLocationStore = create<LocationState>((set, get) => ({
  deliveryAddress: '',
  deliveryInstructions: '',
  setDeliveryAddress: (address) => set({ deliveryAddress: address }),
  setDeliveryInstructions: (instructions) => set({ deliveryInstructions: instructions }),
  loadSavedLocation: async () => {
    const address = (await SecureStore.getItemAsync(DELIVERY_ADDRESS_KEY)) ?? '';
    const instructions = (await SecureStore.getItemAsync(DELIVERY_INSTRUCTIONS_KEY)) ?? '';
    set({ deliveryAddress: address, deliveryInstructions: instructions });
  },
  saveLocation: async () => {
    const { deliveryAddress, deliveryInstructions } = get();
    if (deliveryAddress) {
      await SecureStore.setItemAsync(DELIVERY_ADDRESS_KEY, deliveryAddress);
    }
    if (deliveryInstructions) {
      await SecureStore.setItemAsync(DELIVERY_INSTRUCTIONS_KEY, deliveryInstructions);
    }
  },
}));
