// Otáčené listy alba kreslené do jednoho plátna. Dřív je skládal prohlížeč z natočených 3D proužků a Firefox
// mezi nimi nechával svislé spáry v barvě pozadí (každý kousek vyhlazoval zvlášť). V plátně se ohnutý list
// kreslí z tenkých překrývajících se proužků do jednoho obrázku, takže spáry nemají kde vzniknout.

export const LW = 360, LH = 480;
const PERSP = 1800, OX = LW / 2, OY = LH / 2;
const NSL = 60, SL = LW / NSL, EXT = 1.2;
// plátno přesahuje stranu, aby se vešel zvednutý a perspektivou zvětšený list
const PADX = 372, PADT = 64, PADB = 56;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface PocketSpec {
  img: string | null;
  number: string;
  name: string;
  owned: number;
  hidden: boolean;
}

export interface PageSpec {
  side: 'l' | 'r';
  blank: boolean;
  /** null = kapsa bez karty v sadě */
  pockets: Array<PocketSpec | null>;
}

export interface LeafState {
  front: PageSpec | null;
  back: PageSpec | null;
  q: number; v: number; bs: number; ls: number;
}

export interface LeafLook {
  page: string; pocket: string; empty: string; square: boolean;
  film: 'gloss' | 'matte' | 'holo' | 'glit';
}

type G = CanvasRenderingContext2D;

function rr(g: G, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  const [a, b, c, d] = typeof r === 'number' ? [r, r, r, r] : r;
  g.beginPath();
  g.moveTo(x + a, y); g.lineTo(x + w - b, y); g.quadraticCurveTo(x + w, y, x + w, y + b);
  g.lineTo(x + w, y + h - c); g.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  g.lineTo(x + d, y + h); g.quadraticCurveTo(x, y + h, x, y + h - d);
  g.lineTo(x, y + a); g.quadraticCurveTo(x, y, x + a, y); g.closePath();
}

/** CSS linear-gradient(úhel) přes obdélník; stops = [pozice 0–1, barva]. */
function cssLinear(g: G, deg: number, x: number, y: number, w: number, h: number, stops: Array<[number, string]>) {
  const r = deg * Math.PI / 180, dx = Math.sin(r), dy = -Math.cos(r), len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = x + w / 2, cy = y + h / 2;
  const gr = g.createLinearGradient(cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2);
  stops.forEach(([p, c]) => gr.addColorStop(clamp(p, 0, 1), c));
  return gr;
}

const GUTTER: Array<[number, string]> = [[0, 'rgba(255,255,255,.14)'], [0.012, 'rgba(0,0,0,.6)'], [0.05, 'rgba(0,0,0,.26)'], [0.095, 'rgba(0,0,0,.08)'], [0.13, 'rgba(255,255,255,.07)'], [0.2, 'rgba(0,0,0,0)']];

export class LeafCanvas {
  readonly el: HTMLCanvasElement;
  private g: G;
  private R = 1;
  // plátno má do prvního nastavení výchozích 300 × 150 px; bez toho by se při zvětšení 1 roztáhlo
  private sized = false;
  private tex = new Map<string, HTMLCanvasElement>();
  private imgs = new Map<string, HTMLImageElement>();
  private sleeve: HTMLImageElement | null = null;
  private onReady: () => void;

  constructor(host: HTMLElement, private look: LeafLook, onReady: () => void) {
    this.el = document.createElement('canvas');
    this.el.className = 'lcv';
    Object.assign(this.el.style, { left: `${-PADX}px`, top: `${-PADT}px`, width: `${LW + 2 * PADX}px`, height: `${LH + PADT + PADB}px` });
    host.appendChild(this.el);
    this.g = this.el.getContext('2d')!;
    this.onReady = onReady;
  }

  /** Vzor obalu (rastrovaný obrázek). Do té doby se karta kreslí bez obalu. */
  setSleeve(url: string) {
    const im = new Image();
    im.onload = () => { this.sleeve = im; this.tex.clear(); this.onReady(); };
    im.src = url;
  }

  /** Zahodí uložené strany (změnily se karty). */
  invalidate() { this.tex.clear(); }

  /** Rozlišení plátna podle zvětšení alba a hustoty pixelů obrazovky. */
  setScale(k: number) {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const R = Math.min(2, Math.max(1, k * dpr));
    if (this.sized && Math.abs(R - this.R) < 0.02) return;
    this.sized = true;
    this.R = R;
    this.el.width = Math.round((LW + 2 * PADX) * R);
    this.el.height = Math.round((LH + PADT + PADB) * R);
    this.tex.clear();
  }

  private image(src: string) {
    let im = this.imgs.get(src);
    if (!im) {
      im = new Image();
      im.decoding = 'async';
      im.onload = () => { this.tex.clear(); this.onReady(); };
      im.src = src;
      this.imgs.set(src, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }

  private key(p: PageSpec) {
    return p.side + (p.blank ? 'b' : '') + p.pockets.map((c) => c ? `${c.img}|${c.owned}|${c.hidden ? 1 : 0}|${c.number}` : '-').join(';');
  }

  /** Předem připraví stranu, aby byla hotová, než se list začne otáčet. */
  warm(p: PageSpec | null) { if (p) this.texture(p); }

  private texture(p: PageSpec) {
    const k = this.key(p);
    let c = this.tex.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.ceil(LW * this.R); c.height = Math.ceil(LH * this.R);
    this.paintPage(c.getContext('2d')!, p);
    if (this.tex.size > 24) this.tex.delete(this.tex.keys().next().value!);
    this.tex.set(k, c);
    return c;
  }

  // strana jako v DOM: barva, kapsy, karty v obalech, prázdné kapsy s číslem a jménem, stín hřbetu
  private paintPage(g: G, p: PageSpec) {
    const L = this.look, R = this.R;
    g.scale(R, R);
    rr(g, 0, 0, LW, LH, p.side === 'r' ? [6, 14, 14, 6] : [14, 6, 6, 14]);
    g.fillStyle = L.page; g.fill();
    g.save(); g.clip();
    const pw = (LW - 36 - 20) / 3, ph = (LH - 36 - 20) / 3, pr = L.square ? 0 : 5;
    p.pockets.forEach((c, k) => {
      const x = 18 + (k % 3) * (pw + 10), y = 18 + Math.floor(k / 3) * (ph + 10);
      g.globalAlpha = p.blank ? 0.6 : 1;
      rr(g, x, y, pw, ph, pr); g.fillStyle = 'rgba(255,255,255,.035)'; g.fill();
      rr(g, x + 0.5, y + 0.5, pw - 1, ph - 1, Math.max(0, pr - 0.5)); g.strokeStyle = L.pocket; g.lineWidth = 1; g.stroke();
      g.globalAlpha = 1;
      if (!c) return;
      if (c.owned > 0) { if (!c.hidden) this.paintCard(g, c, x + (pw - 92) / 2, y + (ph - 126) / 2); return; }
      this.paintEmpty(g, c, x, y, pw, ph);
    });
    const gl = p.side === 'r' ? cssLinear(g, 90, 0, 0, LW, LH, GUTTER) : cssLinear(g, 270, 0, 0, LW, LH, GUTTER);
    g.fillStyle = gl; g.fillRect(0, 0, LW, LH);
    g.restore();
  }

  private paintCard(g: G, c: PocketSpec, x: number, y: number) {
    const sx = 92 / 150, sy = 126 / 206;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 4; g.shadowOffsetY = 2;
    rr(g, x, y, 92, 126, 6); g.fillStyle = '#151a22'; g.fill();
    g.restore();
    g.save();
    rr(g, x, y, 92, 126, 9 * sx); g.clip();
    if (this.sleeve) g.drawImage(this.sleeve, x, y, 92, 126);
    const ix = x + 7 * sx, iy = y + 7 * sy, iw = 92 - 14 * sx, ih = 126 - 14 * sy;
    g.save();
    rr(g, ix, iy, iw, ih, 6 * sx); g.clip();
    g.fillStyle = '#151a22'; g.fillRect(ix, iy, iw, ih);
    const im = c.img ? this.image(c.img) : null;
    if (im) {
      const s = Math.min(iw / im.naturalWidth, ih / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
      g.drawImage(im, ix + (iw - w) / 2, iy + (ih - h) / 2, w, h);
    }
    g.restore();
    this.paintFilm(g, x, y, 92, 126);
    g.restore();
    if (c.owned > 1) {
      const t = `×${c.owned}`;
      g.font = '700 10px Inter, sans-serif';
      const w = g.measureText(t).width + 10;
      rr(g, x + 4, y + 126 - 4 - 16, w, 16, 5); g.fillStyle = 'rgba(11,14,19,.85)'; g.fill();
      g.fillStyle = '#e8ecf1'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, x + 9, y + 126 - 12);
    }
  }

  // povrch obalu (.fm v album.css)
  private paintFilm(g: G, x: number, y: number, w: number, h: number) {
    const f = this.look.film;
    if (f === 'matte') { g.fillStyle = cssLinear(g, 160, x, y, w, h, [[0, 'rgba(255,255,255,.07)'], [1, 'rgba(255,255,255,.02)']]); g.fillRect(x, y, w, h); return; }
    if (f === 'gloss') {
      g.fillStyle = cssLinear(g, 125, x, y, w, h, [[0, 'rgba(255,255,255,.22)'], [0.24, 'rgba(255,255,255,.06)'], [0.4, 'rgba(255,255,255,0)'], [0.66, 'rgba(255,255,255,0)'], [0.78, 'rgba(255,255,255,.08)'], [0.9, 'rgba(255,255,255,0)']]);
      g.fillRect(x, y, w, h); return;
    }
    g.fillStyle = cssLinear(g, 125, x, y, w, h, [[0, 'rgba(255,255,255,.2)'], [f === 'holo' ? 0.3 : 0.35, 'rgba(255,255,255,0)']]);
    g.fillRect(x, y, w, h);
    if (f === 'holo') {
      const st: Array<[number, string]> = [];
      const cols = ['rgba(255,139,209,0)', 'rgba(255,139,209,.16)', 'rgba(255,211,110,.16)', 'rgba(124,242,200,.16)', 'rgba(110,168,255,.16)'];
      for (let o = 0; o < 1; o += 0.4) cols.forEach((c, i) => st.push([o + i * 0.08, c]));
      g.fillStyle = cssLinear(g, 115, x, y, w, h, st); g.fillRect(x, y, w, h);
    }
  }

  private paintEmpty(g: G, c: PocketSpec, x: number, y: number, w: number, h: number) {
    g.save();
    g.fillStyle = this.look.empty; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '500 9.5px Inter, sans-serif';
    const lines: string[] = [], words = c.name.split(/\s+/), maxW = w - 12;
    let cur = '';
    for (const wd of words) {
      const t = cur ? cur + ' ' + wd : wd;
      if (g.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = wd; }
    }
    if (cur) lines.push(cur);
    if (lines.length > 2) { lines.length = 2; let l = lines[1]; while (l && g.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[1] = l + '…'; }
    const total = 12 + 3 + 12 * lines.length;
    let ty = y + (h - total) / 2 + 6;
    g.font = '500 10px "JetBrains Mono", monospace';
    g.fillText(`#${c.number}`, x + w / 2, ty);
    ty += 15;
    g.font = '500 9.5px Inter, sans-serif'; g.globalAlpha = 0.85;
    for (const l of lines) { g.fillText(l, x + w / 2, ty); ty += 12; }
    g.restore();
  }

  /** Nakreslí otáčené listy (pořadí zespodu nahoru). Prázdný seznam plátno vyčistí. */
  draw(leaves: LeafState[]) {
    const g = this.g, R = this.R;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.el.width, this.el.height);
    for (const l of leaves) this.drawLeaf(l, R);
  }

  private drawLeaf(l: LeafState, R: number) {
    const g = this.g, q = l.q, th = -180 * q, b = Math.sin(Math.PI * clamp(q, 0, 1));
    const dyn = clamp(l.v * 0.35, -1, 1), bend = b * (13 + 9 * Math.abs(dyn)) * l.bs, sag = b * 22 * l.ls * l.bs;
    const ang = (s: number) => clamp(th + bend * (3.1 * s + 1.9 * s * s), -180, 0);
    // body ohnuté křivky listu (x podél strany, z k divákovi, y pokles volného okraje)
    const P: Array<[number, number, number]> = [];
    let x = 0, z = 0;
    for (let i = 0; i <= NSL; i++) {
      P.push([x, z, -sag * (i / NSL) ** 2]);
      if (i < NSL) { const a = ang((i + 0.5) / NSL) * Math.PI / 180; x += SL * Math.cos(a); z -= SL * Math.sin(a); }
    }
    const pts = P.map(([px, pz, py]) => { const s = PERSP / (PERSP - pz); return { X: PADX + OX + (px - OX) * s, Y: PADT + OY + py * s, s }; });
    // vzdálenější proužky první, bližší přes ně
    const order = Array.from({ length: NSL }, (_, i) => i).sort((a, c) => (P[a][1] + P[a + 1][1]) - (P[c][1] + P[c + 1][1]));
    const tf = l.front ? this.texture(l.front) : null, tb = l.back ? this.texture(l.back) : null;
    for (const i of order) {
      const a = ang((i + 0.5) / NSL), r = a * Math.PI / 180;
      const mx = (P[i][0] + P[i + 1][0]) / 2, mz = (P[i][1] + P[i + 1][1]) / 2;
      const front = (OX - mx) * Math.sin(r) + (PERSP - mz) * Math.cos(r) >= 0;
      const t = front ? tf : tb;
      if (!t) continue;
      const p0 = pts[i], p1 = pts[i + 1], A = front ? p0 : p1, B = front ? p1 : p0;
      const u0 = front ? i * SL : LW - (i + 1) * SL, ax = (B.X - A.X) / SL, ay = (B.Y - A.Y) / SL, d = (p0.s + p1.s) / 2;
      // zdrojový proužek u0..u0+SL se zobrazí mezi body A a B; přesah EXT překryje styk se sousedem
      g.setTransform(R * ax, R * ay, 0, R * d, R * (A.X - ax * u0), R * (A.Y - ay * u0 - d * OY));
      const sw = Math.min(SL + EXT, LW - u0);
      g.drawImage(t, u0 * this.R, 0, sw * this.R, LH * this.R, u0, 0, sw, LH);
      // líc tmavne, jak se odvrací od světla, rub naopak
      const sh = 0.46 * (1 + (front ? -1 : 1) * Math.cos(r)) / 2;
      if (sh > 0.004) {
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = `rgba(0,0,0,${sh.toFixed(3)})`; g.fillRect(u0, 0, sw, LH);
        g.globalCompositeOperation = 'source-over';
      }
    }
  }
}
