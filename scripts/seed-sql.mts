// Vygeneruje supabase/seed.sql z ukázkových dat (src/lib/mock-data.ts).
// Spuštění: node --experimental-strip-types scripts/seed-sql.mts
import { writeFileSync } from 'node:fs';
import { CARDS, LISTINGS, SELLERS } from '../src/lib/mock-data.ts';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const uuid = (prefix: string, id: string) => `00000000-0000-4000-${prefix}-${id.replace(/\D/g, '').padStart(12, '0')}`;

const out: string[] = ['-- Ukázková data pro beta verzi. Prodejci jsou smyšlení demo účty (e-mail na doméně .invalid).', 'begin;'];

for (const s of SELLERS) {
  const id = uuid('a000', s.id);
  out.push(
    `insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values (${q(id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${q(`demo-${s.id}@v4market.invalid`)}, '{"provider":"email","providers":["email"]}', '{}', now(), now()) on conflict (id) do nothing;`,
    `update public.profiles set display_name = ${q(s.name)}, kind = ${q(s.kind)}, country = ${q(s.country)} where id = ${q(id)};`,
  );
}

const sets = new Map<string, { game: string; code: string; name: string }>();
for (const c of CARDS) sets.set(`${c.game}:${c.setCode}`, { game: c.game, code: c.setCode, name: c.setName });
for (const s of sets.values()) {
  out.push(`insert into public.card_sets (game_id, code, name) values (${q(s.game)}, ${q(s.code)}, ${q(s.name)}) on conflict (game_id, code) do nothing;`);
}

for (const c of CARDS) {
  const id = uuid('c000', c.id);
  out.push(
    `insert into public.cards (id, set_id, slug, name, number, rarity) select ${q(id)}, id, ${q(c.slug)}, ${q(c.name)}, ${q(c.number)}, ${q(c.rarity)} from public.card_sets where game_id = ${q(c.game)} and code = ${q(c.setCode)} on conflict (id) do nothing;`,
  );
  out.push(
    `insert into public.price_history (card_id, day, avg_price_czk) select ${q(id)}, current_date - (${c.priceHistory.length}::int - i::int), p from unnest(array[${c.priceHistory.join(',')}]) with ordinality as t(p, i) on conflict do nothing;`,
  );
}

for (const l of LISTINGS) {
  out.push(
    `insert into public.listings (id, card_id, seller_id, price_czk, condition, language, quantity, graded) values (${q(uuid('b000', l.id))}, ${q(uuid('c000', l.cardId))}, ${q(uuid('a000', l.sellerId))}, ${l.price}, ${q(l.condition)}, ${q(l.language)}, ${l.quantity}, ${l.graded ? q(l.graded) : 'null'}) on conflict (id) do nothing;`,
  );
}

out.push('commit;');
writeFileSync(new URL('../supabase/seed.sql', import.meta.url), out.join('\n') + '\n');
console.log(`seed.sql: ${SELLERS.length} prodejců, ${CARDS.length} karet, ${LISTINGS.length} nabídek`);
