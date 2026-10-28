// Nahlášení obsahu (DS Reports › Nahlásit obsah, DSA čl. 16). Důvody hlídá i databáze (report_content).

export type ContentKind = 'listing' | 'seller' | 'message' | 'review' | 'other';
export type ContentReason =
  | 'counterfeit' | 'mismatch' | 'fraud' | 'prohibited' | 'impersonation' | 'offensive'
  | 'spam' | 'harassment' | 'off_platform' | 'fake_review' | 'unrelated' | 'illegal' | 'other';

export const CONTENT_REASON: Record<ContentReason, string> = {
  counterfeit: 'Padělek nebo kopie karty',
  mismatch: 'Fotka nebo popis neodpovídá kartě',
  fraud: 'Podezření na podvod',
  prohibited: 'Zakázané zboží',
  impersonation: 'Vydává se za někoho jiného',
  offensive: 'Urážlivý nebo nevhodný obsah',
  spam: 'Spam',
  harassment: 'Obtěžování nebo urážky',
  off_platform: 'Chce platbu mimo dohodnutý způsob nebo posílá podezřelý odkaz',
  fake_review: 'Falešné hodnocení',
  unrelated: 'Netýká se objednávky',
  illegal: 'Nezákonný obsah',
  other: 'Jiné porušení pravidel',
};

export const KIND_REASONS: Record<ContentKind, ContentReason[]> = {
  listing: ['counterfeit', 'mismatch', 'fraud', 'prohibited', 'other'],
  seller: ['impersonation', 'fraud', 'offensive', 'spam', 'other'],
  message: ['harassment', 'off_platform', 'spam', 'other'],
  review: ['fake_review', 'offensive', 'unrelated', 'other'],
  other: ['illegal', 'counterfeit', 'fraud', 'offensive', 'other'],
};

/** „Nahlásit nabídku“ ap. */
export const KIND_TITLE: Record<ContentKind, string> = {
  listing: 'Nahlásit nabídku',
  seller: 'Nahlásit prodejce',
  message: 'Nahlásit zprávu',
  review: 'Nahlásit hodnocení',
  other: 'Nahlásit nezákonný obsah',
};

/** Co bylo skryto, pro e-maily a panel podpory. */
export const KIND_NOUN: Record<ContentKind, string> = {
  listing: 'nabídka',
  seller: 'prodejce',
  message: 'zpráva',
  review: 'hodnocení',
  other: 'obsah',
};

/** Článek obchodních podmínek k důvodu (pro odůvodnění autorovi). */
export const REASON_ARTICLE: Record<ContentReason, string> = {
  counterfeit: 'čl. 5 a 12',
  mismatch: 'čl. 5 a 12',
  fraud: 'čl. 12 a 13',
  prohibited: 'čl. 5 a 12',
  impersonation: 'čl. 4 a 12',
  offensive: 'čl. 12',
  spam: 'čl. 12',
  harassment: 'čl. 12',
  off_platform: 'čl. 7 a 12',
  fake_review: 'čl. 11 a 12',
  unrelated: 'čl. 11',
  illegal: 'čl. 12',
  other: 'čl. 13',
};

export const contentCode = (n: number) => `N-${String(n).padStart(4, '0')}`;

export const isContentReason = (kind: ContentKind, r: string): r is ContentReason =>
  (KIND_REASONS[kind] as string[]).includes(r);

export interface ContentSnapshot {
  card?: string; set?: string; number?: string; slug?: string; image?: string | null;
  price?: number | null; condition?: string; language?: string; graded?: string | null; note?: string | null;
  quantity?: number; seller?: string; seller_id?: string;
  name?: string; kind?: string; tagline?: string | null; published?: boolean;
  body?: string; sender?: string; sent_at?: string;
  rating?: number; comment?: string | null; reply?: string | null; written_at?: string;
}

/** Jedna řádka náhledu obsahu pro e-mail a frontu. */
export function snapshotLine(kind: ContentKind, s: ContentSnapshot, url?: string | null): string {
  switch (kind) {
    case 'listing': return `${s.card ?? 'Karta'} (${[s.set, s.number].filter(Boolean).join(' ')}), ${s.condition ?? ''}${s.price ? `, ${s.price} Kč` : ''}`;
    case 'seller': return s.name ?? 'Prodejce';
    case 'message': return `„${(s.body ?? '').slice(0, 160)}“`;
    case 'review': return `${s.rating ?? '?'} z 5${s.comment ? `: „${s.comment.slice(0, 160)}“` : ''}`;
    default: return url ?? '';
  }
}
