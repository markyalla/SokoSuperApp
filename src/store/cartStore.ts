import { create } from 'zustand';

import { CartItem, MenuItem } from '../types/shopper';

interface CartState {
  items: CartItem[];
  addItem: (item: MenuItem) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  subtotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addItem: (item) => {
    const existing = get().items.find((cartItem) => cartItem.item.id === item.id);
    if (existing) {
      set({
        items: get().items.map((cartItem) =>
          cartItem.item.id === item.id ? { ...cartItem, quantity: cartItem.quantity + 1 } : cartItem,
        ),
      });
      return;
    }
    set({ items: [...get().items, { item, quantity: 1 }] });
  },
  removeItem: (itemId) => {
    set({ items: get().items.filter((cartItem) => cartItem.item.id !== itemId) });
  },
  updateQuantity: (itemId, quantity) => {
    if (quantity <= 0) {
      set({ items: get().items.filter((cartItem) => cartItem.item.id !== itemId) });
      return;
    }
    set({
      items: get().items.map((cartItem) =>
        cartItem.item.id === itemId ? { ...cartItem, quantity } : cartItem,
      ),
    });
  },
  clearCart: () => set({ items: [] }),
  subtotal: () => get().items.reduce((sum, cartItem) => sum + cartItem.item.base_price * cartItem.quantity, 0),
}));
