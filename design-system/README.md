# Design systém V4cards Trezor

Web bere barvy, písma, rozestupy, zaoblení a vzhled komponent jen z design systému
„V4cards Trezor“: https://claude.ai/artifact/Dnoxaj5mtmyjgnnSRRYcrP

| Soubor | Co to je |
| --- | --- |
| `tokens.json` | Kopie tokenů z design systému. Z ní se při `npm run dev` / `npm run build` generuje `src/styles/tokens.css`. |
| `bundle.css` | Kopie stylů komponent (`tz-*`) z design systému. |
| `BRAND.md` | Kopie README design systému: tón, barvy, typografie, pravidla. |

Komponenty jsou přepsané do TypeScriptu v `src/components/trezor/` a používají třídy z `bundle.css`.

## Jak dělat vizuální změny

1. Změnu udělat nejdřív v design systému a nechat ji schválit.
2. Zkopírovat změněné `tokens.json` a `bundle.css` sem, případně upravit komponentu v `src/components/trezor/`.
3. Ve zbytku webu nikdy nepsat barvy ani písma natvrdo, jen `var(--token)` a třídy `t-*`.

`src/styles/ds-extensions.css` obsahuje pár doplňků, které v design systému zatím chybí. Patří do něj a odsud se pak smažou.
