import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const FROM = 'V4cards <noreply@v4cards.com>';
const REPLY_TO = 'podpora@v4cards.com';

/** Pošle e-mail přes Resend. Bez klíče RESEND_API_KEY (třeba v náhledu) nedělá nic. */
async function send(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, to, subject, html }),
    });
  } catch {
    // Uvítání není kritické, přihlášení kvůli němu nezdržujeme.
  }
}

/** Uvítací e-mail po založení účtu (e-mailem i přes Google). Databáze hlídá, aby odešel jen jednou. */
export async function sendWelcomeEmail(supabase: Supabase, siteUrl: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.email) return;
  const { data: first } = await supabase.rpc('claim_welcome_email');
  if (first !== true) return;
  await send(auth.user.email, 'Vítejte na V4cards', welcomeHtml(siteUrl));
}

function welcomeHtml(siteUrl: string): string {
  const item = (title: string, text: string) =>
    `<p style="font-size:15px;line-height:1.5;color:#C9D1D9;margin:0 0 12px"><strong style="color:#E6EDF3">${title}</strong><br>${text}</p>`;
  return `<div style="background:#0E1116;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#161B22;border-radius:12px;padding:32px;color:#E6EDF3">
    <div style="font-size:22px;font-weight:bold;letter-spacing:-0.5px;margin-bottom:24px">V4<span style="color:#7CF2C8">cards</span></div>
    <h1 style="font-size:20px;margin:0 0 12px">Vítejte na V4cards</h1>
    <p style="font-size:15px;line-height:1.5;color:#C9D1D9;margin:0 0 20px">Účet je připravený. Tady je pár tipů na začátek:</p>
    ${item('Hledejte karty', 'Pokémon, Magic, hokej a další. U každé karty vidíte nabídky všech prodejců.')}
    ${item('Prodávejte', 'Vystavení karty zabere chvilku. Ve svém účtu si vyplňte profil prodejce.')}
    ${item('Zabezpečte účet', 'V nastavení účtu si zapněte dvoufázové ověření. Do účtu se pak nikdo nedostane ani s heslem.')}
    <a href="${siteUrl}" style="display:inline-block;margin-top:12px;background:#7CF2C8;color:#0E1116;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px">Přejít na V4cards</a>
  </div>
  <p style="max-width:480px;margin:16px auto 0;font-size:12px;color:#6E7681;text-align:center">V4cards · sběratelské karty · <a href="${siteUrl}" style="color:#6E7681">www.v4cards.com</a> · <a href="mailto:podpora@v4cards.com" style="color:#6E7681">podpora@v4cards.com</a></p>
</div>`;
}

export type OrderEmail = 'requested' | 'confirmed' | 'declined';

const ORDER_EMAILS: Record<OrderEmail, { subject: string; title: string; text: (name: string) => string; button: string }> = {
  requested: {
    subject: 'Nová objednávka na V4cards',
    title: 'Máte novou objednávku',
    text: (name) => `${name} u vás objednal karty. Potvrďte nebo odmítněte objednávku do 48 hodin, jinak vyprší a karty se vrátí do nabídky. Po potvrzení se s kupujícím domluvíte na platbě a předání.`,
    button: 'Zobrazit objednávku',
  },
  confirmed: {
    subject: 'Prodejce potvrdil vaši objednávku',
    title: 'Objednávka je potvrzená',
    text: (name) => `${name} potvrdil vaši objednávku. Platíte přímo prodejci podle domluvy. Kontakt na něj najdete u objednávky.`,
    button: 'Zobrazit objednávku',
  },
  declined: {
    subject: 'Prodejce odmítl vaši objednávku',
    title: 'Objednávka je odmítnutá',
    text: (name) => `${name} vaši objednávku nemůže vyřídit. Nic neplatíte a karty se vrátily do nabídky, můžete zkusit jiného prodejce.`,
    button: 'Hledat jiné nabídky',
  },
};

/**
 * Upozorní druhou stranu objednávky. Volá se po akci přihlášeného uživatele,
 * adresu vrací databáze jen účastníkům objednávky (order_counterpart).
 */
export async function sendOrderEmail(supabase: Supabase, orderId: string, kind: OrderEmail, actorName: string, siteUrl: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const { data } = await supabase.rpc('order_counterpart', { target: orderId });
  const to = (data as Array<{ email: string | null }> | null)?.[0]?.email;
  if (!to) return;
  const e = ORDER_EMAILS[kind];
  const href = kind === 'declined' ? `${siteUrl}/karty` : `${siteUrl}/objednavky`;
  await send(to, e.subject, layoutHtml(siteUrl, `
    <h1 style="font-size:20px;margin:0 0 12px">${e.title}</h1>
    <p style="font-size:15px;line-height:1.5;color:#C9D1D9;margin:0 0 20px">${escapeHtml(e.text(actorName))}</p>
    <a href="${href}" style="display:inline-block;margin-top:4px;background:#7CF2C8;color:#0E1116;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px">${e.button}</a>`));
}

function layoutHtml(siteUrl: string, body: string): string {
  return `<div style="background:#0E1116;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#161B22;border-radius:12px;padding:32px;color:#E6EDF3">
    <div style="font-size:22px;font-weight:bold;letter-spacing:-0.5px;margin-bottom:24px">V4<span style="color:#7CF2C8">cards</span></div>
    ${body}
  </div>
  <p style="max-width:480px;margin:16px auto 0;font-size:12px;color:#6E7681;text-align:center">V4cards · sběratelské karty · <a href="${siteUrl}" style="color:#6E7681">www.v4cards.com</a> · <a href="mailto:podpora@v4cards.com" style="color:#6E7681">podpora@v4cards.com</a></p>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Na hlídanou kartu se objevila nabídka (čekací pořadník). */
export async function sendWatchEmail(to: string, cards: Array<{ name: string; slug: string }>, siteUrl: string): Promise<void> {
  const list = cards
    .slice(0, 10)
    .map((c) => `<li style="margin:0 0 6px"><a href="${siteUrl}/karty/${encodeURIComponent(c.slug)}" style="color:#7CF2C8">${escapeHtml(c.name)}</a></li>`)
    .join('');
  const one = cards.length === 1;
  await send(to, one ? `${cards[0].name}: nová nabídka` : 'Nové nabídky na hlídané karty', layoutHtml(siteUrl, `
    <h1 style="font-size:20px;margin:0 0 12px">${one ? 'Na hlídanou kartu je nabídka' : 'Na hlídané karty jsou nabídky'}</h1>
    <p style="font-size:15px;line-height:1.5;color:#C9D1D9;margin:0 0 12px">Upozornění dostali všichni, kdo kartu hlídali. Kdo objedná dřív, ten ji má.</p>
    <ul style="font-size:15px;line-height:1.5;color:#C9D1D9;margin:0 0 20px;padding-left:20px">${list}</ul>
    <a href="${siteUrl}/ucet/hlidane" style="display:inline-block;background:#7CF2C8;color:#0E1116;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px">Hlídané karty</a>`));
}
