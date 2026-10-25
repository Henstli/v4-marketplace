import type { Metadata } from 'next';
import { CartView } from '@/components/cart/CartView';
import { getCurrentUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase/config';

export const metadata: Metadata = { title: 'Košík' };

export default async function CartPage() {
  const checkout = isSupabaseConfigured() ? ((await getCurrentUser()) ? 'ready' : 'login') : 'off';
  return <CartView checkout={checkout} />;
}
