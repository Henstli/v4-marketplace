// Bankovní účet prodejce a QR platba. Kupující platí přímo prodejci, V4cards peníze nepřijímá.

/** Kontrola IBAN podle ISO 13616 (zbytek po dělení 97 musí být 1). */
function ibanValid(iban: string): boolean {
  const moved = iban.slice(4) + iban.slice(0, 4);
  const digits = moved.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

function checkDigits(country: string, bban: string): string {
  const digits = (bban + country + '00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return String(98 - rest).padStart(2, '0');
}

/**
 * Převede zadaný účet na IBAN. Bere IBAN (CZ, SK, i s mezerami) nebo české číslo účtu
 * ve tvaru „předčíslí-číslo/kód banky“. Vrací null, když účet není platný.
 */
export function normalizeAccount(input: string): string | null {
  const raw = input.replace(/\s+/g, '').toUpperCase();
  if (/^(CZ|SK)\d{22}$/.test(raw)) return ibanValid(raw) ? raw : null;
  const m = raw.match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return null;
  const bban = m[3] + (m[1] ?? '').padStart(6, '0') + m[2].padStart(10, '0');
  const iban = `CZ${checkDigits('CZ', bban)}${bban}`;
  return ibanValid(iban) ? iban : null;
}

/** IBAN po čtveřicích pro čtení. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/** České číslo účtu z CZ IBAN („předčíslí-číslo/banka“), pro lidi, kteří IBAN nepoužívají. */
export function czAccountNumber(iban: string): string | null {
  if (!iban.startsWith('CZ')) return null;
  const bank = iban.slice(4, 8);
  const prefix = iban.slice(8, 14).replace(/^0+/, '');
  const number = iban.slice(14).replace(/^0+/, '');
  return `${prefix ? `${prefix}-` : ''}${number}/${bank}`;
}

/** Text QR platby (formát SPAYD, čtou ho české bankovní aplikace). */
export function spayd(p: { iban: string; amount: number; vs: number; name: string }): string {
  const clean = (s: string) => s.replace(/[*]/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 60);
  return [
    'SPD*1.0',
    `ACC:${p.iban}`,
    `AM:${p.amount.toFixed(2)}`,
    'CC:CZK',
    `X-VS:${p.vs}`,
    `RN:${clean(p.name)}`,
    `MSG:${clean(`V4cards objednavka ${p.vs}`)}`,
  ].join('*');
}
