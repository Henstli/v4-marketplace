import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getProfileCard } from '@/lib/profile';
import { sanitizeCrop } from '@/lib/profile-card';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';
import { AppearanceForm } from '../../AppearanceForm';

export const metadata: Metadata = { title: 'Vzhled profilu' };

// Vzhled profilu: tady si každý vybírá, jak vypadá jeho karta. Kolo 1 = typová řádka, rámeček, status a stav;
// další kosmetika (rámečky karty, ilustrace, styl jména, povrchy, podložky, efekty, odznaky úspěchů) přibude v kole 2.
export default async function AppearancePage() {
  if (!isSupabaseConfigured()) redirect('/');
  const user = await getCurrentUser();
  if (!user) redirect('/prihlaseni?dalsi=/ucet/vzhled');
  const supabase = await createClient();
  const [card, { data: prof }] = await Promise.all([
    getProfileCard(user.id),
    supabase.from('profiles').select('card_style, card_form, card_frame, card_city, status_text, presence_mode, avatar_path, avatar_crop').eq('id', user.id).single(),
  ]);
  if (!card) redirect('/ucet');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <h1 className="t-heading-l">Vzhled profilu</h1>
        <p className="muted" style={{ margin: 0 }}>Takhle vás uvidí ostatní po kliknutí na vaše jméno a na <Link href={`/prodejci/${user.id}`}>vašem profilu</Link>.</p>
      </div>
      <AppearanceForm
        card={card}
        saved={{
          style: (prof?.card_style as string | null) ?? '',
          form: prof?.card_form === 'f' ? 'f' : 'm',
          frame: (prof?.card_frame as string | null) ?? 'sklo',
          city: (prof?.card_city as string | null) ?? '',
          status: (prof?.status_text as string | null) ?? '',
          presence: (prof?.presence_mode as 'auto' | 'dnd' | 'hidden' | null) ?? 'auto',
          photoPath: (prof?.avatar_path as string | null) ?? '',
          crop: sanitizeCrop(prof?.avatar_crop),
        }}
      />
    </div>
  );
}
