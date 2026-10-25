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

### Katalog karet

Karty Pokémon a Magic se stahují z veřejných databází [TCGdex](https://tcgdex.dev) a [Scryfall](https://scryfall.com)
edge funkcí `supabase/functions/import-catalog`. Volá ji plánovač pg_cron (migrace `catalog_schedule` a `full_catalog`):
každou minutu importuje sady z tabulky `catalog_sources`, kolik stihne za ~40 s (nejdřív nové, pak starší
než 7 dní), a v pondělí ve 3:00 doplní nově vydané sady. Funkce ověřuje heslo `import_secret` uložené ve Vaultu.
Bere všechny sady Pokémon (kromě digitální TCG Pocket) a všechny papírové sady Magic kromě tokenů a art karet;
nastavení je na začátku funkce.
Stav importu: `select * from catalog_sources order by imported_at desc;`

Vyhledávání a filtry katalogu běží v SQL funkci `search_cards` (fulltext s předponami, bez diakritiky).

Aby fungoval přihlašovací odkaz, musí být adresa webu v Supabase v Authentication > URL Configuration
(Site URL a Redirect URLs, např. `http://localhost:3000/**`).

## Co je hotové

- Homepage s kartami, které nejvíc rostou, a kategoriemi
- Katalog `/karty` s tisíci skutečných karet Pokémon a Magic (s obrázky), vyhledáváním, filtry (hra, stav, jazyk, prodejce), řazením a stránkováním v URL
- Detail karty s grafem ceny a tabulkou nabídek
- Košík rozdělený podle prodejců (uložený v prohlížeči), platba zatím vypnutá

- Přihlášení e-mailovým odkazem, profil prodejce (`/ucet`)
- Vystavení karty k prodeji (vyhledání karty v katalogu) a správa vlastních nabídek (`/prodat`)

- Testovací objednávka z košíku (jedna objednávka na prodejce, bez platby), stavy zaplaceno → odesláno → doručeno
  a hodnocení prodejce po doručení (`/objednavky`)

Připravujeme: skutečné platby (Stripe Connect) a výběr dopravy.
