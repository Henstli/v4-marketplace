'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Položka košíku nese vše potřebné pro zobrazení, ať košík nemusí znovu načítat katalog.
export interface CartItem {
  listingId: string;
  cardSlug: string;
  cardName: string;
  setLabel: string;
  sellerId: string;
  sellerName: string;
  condition: string;
  language: string;
  price: number;
  maxQuantity: number;
  quantity: number;
  /** Obrázek karty; starší položky v košíku ho nemají */
  image?: string;
  /** Hra karty, pro barvu zástupné plochy bez obrázku */
  game?: string;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  add: (item: Omit<CartItem, 'quantity'>) => void;
  setQuantity: (listingId: string, quantity: number) => void;
  remove: (listingId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = 'v4market.cart';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
    } catch {
      // Košík bez uložení, když prohlížeč úložiště nepovolí.
    }
  }, []);

  const persist = useCallback((next: CartItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count: items.reduce((n, i) => n + i.quantity, 0),
      add: (item) => {
        const existing = items.find((i) => i.listingId === item.listingId);
        persist(
          existing
            ? items.map((i) => (i.listingId === item.listingId ? { ...i, quantity: Math.min(i.quantity + 1, i.maxQuantity) } : i))
            : [...items, { ...item, quantity: 1 }],
        );
      },
      setQuantity: (listingId, quantity) =>
        persist(items.map((i) => (i.listingId === listingId ? { ...i, quantity: Math.max(1, Math.min(quantity, i.maxQuantity)) } : i))),
      remove: (listingId) => persist(items.filter((i) => i.listingId !== listingId)),
      clear: () => persist([]),
    }),
    [items, persist],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart musí být uvnitř CartProvider');
  return ctx;
}
