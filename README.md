# V4market

Marketplace sběratelských karet pro Česko a Slovensko: hokej a další sport, Pokémon, Magic a další TCG.
Název a logo jsou provizorní.

## Stack

- Next.js (App Router) + TypeScript
- Supabase: databáze, přihlašování, úložiště fotek (`supabase/migrations/`)
- Design systém V4market Trezor (`design-system/`, viz jeho README)

## Spuštění

```bash
npm install
npm run dev
```

Web běží na http://localhost:3000. Bez proměnných ze `.env.example` používá ukázková data z `src/lib/mock-data.ts`
a přihlášení i prodej jsou vypnuté. S nimi (zkopírujte do `.env.local`) čte databázi Supabase.

## Databáze

Projekt Supabase `Henstli's Project` v organizaci „V4 market“ (region eu-west-1).
Schéma je v `supabase/migrations/`, ukázková data v `supabase/seed.sql`
(vygenerované z `src/lib/mock-data.ts` skriptem `scripts/seed-sql.mts`). Prodejci v ukázkových datech jsou demo účty.

Aby fungoval přihlašovací odkaz, musí být adresa webu v Supabase v Authentication > URL Configuration
(Site URL a Redirect URLs, např. `http://localhost:3000/**`).

## Co je hotové

- Homepage s kartami, které nejvíc rostou, a kategoriemi
- Katalog `/karty` s vyhledáváním, filtry (hra, stav, jazyk, prodejce) a řazením v URL
- Detail karty s grafem ceny a tabulkou nabídek
- Košík rozdělený podle prodejců (uložený v prohlížeči), platba zatím vypnutá

- Přihlášení e-mailovým odkazem, profil prodejce (`/ucet`)
- Vystavení karty k prodeji a správa vlastních nabídek (`/prodat`)

Připravujeme: objednávky a platby, hodnocení.
