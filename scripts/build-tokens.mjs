// Generuje src/styles/tokens.css z design-system/tokens.json (design systém V4market Trezor).
// Barvy, písma, rozestupy a zaoblení se mění jen v design systému, tento soubor je jen převádí.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'design-system/tokens.json'), 'utf8'));

const [primary, ...otherThemes] = tokens.color.themes.map((t) => t.id);

function colorValue(token, theme) {
  const v = typeof token.value === 'string' ? token.value : token.value[theme] ?? token.value[primary];
  const alias = /^\{(.+)\}$/.exec(v);
  return alias ? `var(--${alias[1]})` : v;
}

function px(v) {
  return typeof v === 'number' ? `${v}px` : v;
}

const lines = ['/* V4market Trezor — vygenerováno z design-system/tokens.json, neupravovat ručně */', ':root {'];
lines.push(`  color-scheme: ${primary === 'dark' ? 'dark' : 'light'};`);
for (const t of tokens.color.tokens) lines.push(`  --${t.name}: ${colorValue(t, primary)};`);
for (const [name, stack] of Object.entries(tokens.type.families)) lines.push(`  --font-${name}: ${stack};`);
for (const family of ['spacing', 'radius', 'shadow']) {
  for (const t of tokens[family]?.tokens ?? []) lines.push(`  --${t.name}: ${px(t.value)};`);
}
for (const group of tokens.type.groups) {
  for (const s of group.styles) {
    lines.push(`  --t-${s.name}-size: ${px(s.fontSize)};`);
    lines.push(`  --t-${s.name}-lh: ${typeof s.lineHeight === 'number' ? s.lineHeight : px(s.lineHeight)};`);
  }
}
lines.push('}');

for (const theme of otherThemes) {
  lines.push('', `[data-theme="${theme}"] {`, `  color-scheme: ${theme === 'dark' ? 'dark' : 'light'};`);
  for (const t of tokens.color.tokens) {
    if (typeof t.value === 'string') continue;
    lines.push(`  --${t.name}: ${colorValue(t, theme)};`);
  }
  lines.push('}');
}

// Typografické styly jako třídy .t-<název>, např. .t-display-xl, .t-price.
for (const group of tokens.type.groups) {
  for (const s of group.styles) {
    const decl = [
      `font-family: var(--font-${s.family ?? group.family})`,
      `font-size: ${px(s.fontSize)}`,
      `line-height: ${typeof s.lineHeight === 'number' ? s.lineHeight : px(s.lineHeight)}`,
      `font-weight: ${s.fontWeight}`,
    ];
    if (s.letterSpacing) decl.push(`letter-spacing: ${s.letterSpacing}`);
    if (group.family === 'mono') decl.push('font-variant-numeric: tabular-nums');
    lines.push('', `.t-${s.name} {`, ...decl.map((d) => `  ${d};`), '}');
  }
}

const out = join(root, 'src/styles/tokens.css');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, lines.join('\n') + '\n');
console.log(`tokens.css: ${tokens.color.tokens.length} barev, ${tokens.type.groups.length} skupin písma`);
