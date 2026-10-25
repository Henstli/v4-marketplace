# V4cards Trezor

Design systém pro marketplace sběratelských karet pro Česko a Slovensko (později Maďarsko a Polsko). Kategorie v tomto pořadí (zleva doprava všude na webu): Pokémon, Magic: The Gathering, Riftbound, Lorcana, One Piece, Cyberpunk, Sport (hlavně hokej). Kategorie bez katalogu mají u názvu štítek „Brzy“ a nejsou odkazem.

Směr „Trezor“: tmavé prostředí, ve kterém karty svítí jako ve vitríně, a ceny s grafy působí přesně jako na burze. Má budit důvěru u vážných sběratelů i obchodů a ukázat hlavní odlišení od konkurence: přehled o ceně a nástroje, které šetří čas.

> Značka se jmenuje **V4cards** („we for cards“), hlavní doména www.v4cards.com. Logo je zatím provizorní, výběr finální podoby je odložený.

## Obsah a tón

- Píšeme česky, jasně a věcně, vykáme: „Přidat do košíku“, „Vystavit 124 karet“, „Peníze držíme v úschově“.
- Tlačítko říká přesně, co se stane. Žádné „Odeslat“ nebo „OK“, když jde o „Pokračovat k platbě“.
- Čísla v českém formátu: mezera jako oddělovač tisíců, desetinná čárka, měna za číslem: `1 290 Kč`, `▲ 4,2 %`.
- Změna ceny vždy se šipkou ▲/▼ i barvou, nikdy jen barvou.
- Názvy karet, sad a hráčů necháváme v originále (Charizard ex, Obsidian Flames, Young Guns). Stav karty zkratkami MT, NM, EX, GD, grading PSA/BGS.
- Žádné emoji v rozhraní.

## Vizuální základy

**Barvy.** Výchozí je tmavý motiv (`bg`, `surface`, `ink`), světlý motiv je připravený pro uživatele, kteří ho zvolí. Jediný akcent je mátová `accent`: hlavní akce, aktivní stav, fokus. Růst ceny je `up` (stejná mátová), pokles `down` (oranžová). Barvy kategorií `game-*` jsou jen pro malé tečky a zástupné plochy, nikdy pro text.

**Plochy.** Panely jsou `surface` s okrajem 1 px `line`, bez stínů. Hierarchii dělá světlost plochy a okraj, ne stín ani přechod.

**Barva `danger`.** Červená jen pro akce, které něco ukončí nebo smažou (Odhlásit, Smazat účet), a to jen jako text tlačítka. Pro pokles ceny dál platí oranžová `down`.

**Typografie.** Tři role:
- `display` (Space Grotesk) pro nadpisy a názvy karet,
- `sans` (Inter) pro text a ovládání,
- `mono` (JetBrains Mono) pro všechny ceny, procenta, kódy sad a stav karty. Díky tomu čísla v tabulkách lícují pod sebou a stránka působí „burzovně“.

Písma se načítají z Google Fonts:
`https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap`

**Rozestupy a zaoblení.** Mřížka po 4 px (`space-*`). Zaoblení roste s velikostí prvku: `radius-md` tlačítka, `radius-lg` dlaždice, `radius-xl` velké panely, `radius-pill` štítky a čipy.

**Grafy.** Čára 2,5 px v `up` (nebo `down` při poklesu), pod ní plocha téže barvy s průhledností 8 %, mřížka v `line`. Průměrná prodejní cena přerušovaně v `ink-muted`. Osy a popisky v `mono`, 11–12 px, `ink-muted`.

**Obrázky karet.** Vždy v poměru 63 : 88. Dokud není obrázek, zástupná plocha v barvě kategorie se zaobleným rámečkem.

## Hlavička a patička

- Hlavička: řádek s logem, vyhledáváním a tlačítky má nahoře odsazení `space-6` (24 px), aby nebyl nalepený na okraj okna. Pod ním po `space-4` (16 px) lišta kategorií a pod ní opět `space-4`.
- Tlačítka v hlavičce jsou `ghost` bez okraje, jen Odhlásit je `danger`. Nepřihlášenému se ukáže `primary` Přihlásit.
- Lišta kategorií: tečka `game-*` + název, v pořadí z úvodu. Kategorie bez katalogu jsou `ink-muted` se štítkem „Brzy“.
- Patička: nahoře logo, pod ním jeden řádek se dvěma texty na stejné výšce: vlevo odkazy (Obchodní podmínky · Ochrana osobních údajů · podpora · Beta verze), vpravo popis služby. Oba `small`, `ink-muted`. Na mobilu pod sebou.

## Ikony

Obrysové ikony, tah 1,8–2 px, zakončení kulaté, velikost 18–20 px, barva `ink` nebo `ink-muted`. Ikona bez textu má vždy `aria-label`.

## Logo

Zatím provizorní, finální podoba se vybere později. Do té doby se používá monogram „V4“ a vedle něj nápis „V4cards“ v `display` 700. Monogram: čtverec 36 px, `radius-md`, plocha `accent`, text `on-accent` v `display` 700.

**Ikona v záložce prohlížeče (favicon)** je samotný monogram „V4“: čtverec v `accent` (tmavý motiv, #7cf2c8) se zaoblením 22 % strany, text `on-accent` v `display` 700 na 52 % výšky. Velikosti 16, 32 a 48 px (favicon.ico), 512 px (icon.png) a 180 px bez zaoblení pro iPhone (apple-icon.png, rohy zaoblí systém).

## Přístupnost

- Text splňuje kontrast 4.5:1 v obou motivech, okraje ovládacích prvků 3:1.
- Dotykové cíle mají aspoň 44 px na výšku (tlačítka `md` 44 px, `lg` 52 px).
- Fokus je viditelný: obrys 2 px v `accent`.
