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

Web běží na http://localhost:3000. Bez proměnných ze `.env.example` používá ukázková data z `src/lib/mock-data.ts`.

## Co je hotové

- Homepage s kartami, které nejvíc rostou, a kategoriemi
- Katalog `/karty` s vyhledáváním, filtry (hra, stav, jazyk, prodejce) a řazením v URL
- Detail karty s grafem ceny a tabulkou nabídek
- Košík rozdělený podle prodejců (uložený v prohlížeči), platba zatím vypnutá

Připravujeme: účty, vystavení karet, objednávky a platby, hodnocení.
