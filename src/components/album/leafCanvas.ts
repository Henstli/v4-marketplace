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
  /** svítící kapsy (Neon, Láva): jako CSS 0 0 16px -5px var(--glow) */
  glow?: string;
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

/**
 * CSS míchá barvy přechodu s předem vynásobenou průhledností, plátno ne: přechod z bílé do černé by v plátně
 * prošel světle šedou a stín u hřbetu by byl světlejší než na stranách v DOM. Proto se mezi zarážky doplní
 * jemné kroky spočítané stejně jako v CSS.
 */
function premul(stops: Array<[number, [number, number, number, number]]>, steps = 12): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, a = c0[3] + (c1[3] - c0[3]) * t;
      const ch = (j: number) => a > 0 ? Math.round((c0[j] * c0[3] + (c1[j] * c1[3] - c0[j] * c0[3]) * t) / a) : 0;
      out.push([p0 + (p1 - p0) * t, `rgba(${ch(0)},${ch(1)},${ch(2)},${a.toFixed(4)})`]);
    }
  }
  const [pl, cl] = stops[stops.length - 1];
  out.push([pl, `rgba(${cl[0]},${cl[1]},${cl[2]},${cl[3]})`]);
  return out;
}

// stín hřbetu (.pg .gl v album.css)
const GUTTER = premul([[0, [255, 255, 255, 0.14]], [0.012, [0, 0, 0, 0.6]], [0.05, [0, 0, 0, 0.26]], [0.095, [0, 0, 0, 0.08]], [0.13, [255, 255, 255, 0.07]], [0.2, [0, 0, 0, 0]]]);

const gutters: Partial<Record<'l' | 'r', HTMLCanvasElement>> = {};
/**
 * Stín hřbetu jako obrázek. Kreslí ho plátno i strany v DOM (album.css .gl), takže je na listu při otáčení
 * i po dosednutí úplně stejný (přechod v CSS vycházel v prohlížeči o kus tmavší než v plátně).
 */
export function gutterImage(side: 'l' | 'r') {
  let c = gutters[side];
  if (!c) {
    c = document.createElement('canvas');
    c.width = 1440; c.height = 2;
    const g = c.getContext('2d')!;
    g.fillStyle = cssLinear(g, side === 'r' ? 90 : 270, 0, 0, 1440, 2, GUTTER);
    g.fillRect(0, 0, 1440, 2);
    // hloubka u hřbetu: dřív ji dělal stín bloku stran z protější strany, který přesahoval přes hřbet (teď je oříznutý)
    const deep: Array<[number, string]> = [];
    for (let d = 0; d <= 96; d += 4) deep.push([d / LW, `rgba(0,0,0,${(0.215 * Math.exp(-d / 22)).toFixed(4)})`]);
    g.fillStyle = cssLinear(g, side === 'r' ? 90 : 270, 0, 0, 1440, 2, deep);
    g.fillRect(0, 0, 1440, 2);
    gutters[side] = c;
  }
  return c;
}

export class LeafCanvas {
  readonly el: HTMLCanvasElement;
  private g: G;
  private R = 1;
  // plátno má do prvního nastavení výchozích 300 × 150 px; bez toho by se při zvětšení 1 roztáhlo
  private sized = false;
  private tex = new Map<string, HTMLCanvasElement>();
  private imgs = new Map<string, HTMLImageElement>();
  private ok = new Set<string>();
  private sleeve: HTMLImageElement | null = null;
  private onReady: () => void;
  // posun mřížky plátna proti pixelům obrazovky (aby list v klidu seděl na pixel přesně jako strana v DOM)
  private fx = 0; private fy = 0;
  private host: HTMLElement;
  private live: LeafState[] = [];
  // dosedlé listy se ještě chvíli prolínají do stran v DOM, aby přechod nebyl znát
  private ghosts: Array<{ l: LeafState; t0: number }> = [];
  private graf = 0;

  constructor(host: HTMLElement, private look: LeafLook, onReady: () => void) {
    this.el = document.createElement('canvas');
    this.el.className = 'lcv';
    host.appendChild(this.el);
    this.host = host;
    this.g = this.el.getContext('2d')!;
    this.onReady = onReady;
  }

  /** Vzor obalu (rastrovaný obrázek). Do té doby se karta kreslí bez obalu. */
  setSleeve(url: string) {
    const im = new Image();
    const done = () => { this.sleeve = im; this.tex.clear(); this.onReady(); };
    im.onload = () => { im.decode().then(done, done); };
    im.src = url;
  }

  /** Zahodí uložené strany (změnily se karty). */
  invalidate() { this.tex.clear(); }

  /** Rozlišení plátna podle zvětšení alba a hustoty pixelů obrazovky. */
  setScale(k: number) {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    // jeden pixel plátna = jeden pixel obrazovky; jinak by se list při otáčení i po dosednutí rozmazal
    const R = Math.min(3, Math.max(0.5, k * dpr));
    if (this.sized && Math.abs(R - this.R) < 0.001) { this.align(); return; }
    this.sized = true;
    this.R = R;
    this.el.width = Math.ceil((LW + 2 * PADX) * R) + 1;
    this.el.height = Math.ceil((LH + PADT + PADB) * R) + 1;
    this.el.style.width = `${this.el.width / R}px`;
    this.el.style.height = `${this.el.height / R}px`;
    this.tex.clear();
    this.align();
  }

  /** Srovná plátno na celé pixely obrazovky a zapamatuje si zbylý zlomek pixelu pro kreslení. */
  private align() {
    const dpr = window.devicePixelRatio || 1, r = this.host.getBoundingClientRect(), R = this.R;
    const lx = r.left * dpr - PADX * R, ty = r.top * dpr - PADT * R;
    const fx = lx - Math.floor(lx), fy = ty - Math.floor(ty);
    this.fx = fx; this.fy = fy;
    this.el.style.left = `${-PADX - fx / R}px`;
    this.el.style.top = `${-PADT - fy / R}px`;
  }

  /** Zlomek pixelu, na kterém na obrazovce začíná strana v klidu (líc vpravo od hřbetu, rub vlevo). */
  private frac(side: 'l' | 'r') {
    const v = this.fx + (PADX + (side === 'l' ? -LW : 0)) * this.R;
    return [v - Math.floor(v), this.fy + PADT * this.R - Math.floor(this.fy + PADT * this.R)] as const;
  }

  private image(src: string) {
    let im = this.imgs.get(src);
    if (!im) {
      const el = im = new Image();
      el.decoding = 'async';
      // obrázek se použije až dekódovaný mimo hlavní vlákno (jinak ho drawImage dekóduje uprostřed animace a list se zasekne)
      // a zahodí se jen strany s tímto obrázkem, ne všechny připravené
      const done = () => {
        this.ok.add(src);
        for (const k of [...this.tex.keys()]) if (k.includes(src)) this.tex.delete(k);
        this.onReady();
      };
      el.onload = () => { el.decode().then(done, done); };
      el.src = src;
      this.imgs.set(src, el);
    }
    return this.ok.has(src) && im.naturalWidth ? im : null;
  }

  /** Stáhne a dekóduje obrázky strany dopředu (bez kreslení), aby byly hotové, než na ni dojde. */
  preload(p: PageSpec | null) { p?.pockets.forEach((c) => { if (c?.img && c.owned > 0) this.image(c.img); }); }

  private key(p: PageSpec) {
    const [a, b] = this.frac(p.side);
    return `${this.R.toFixed(3)}:${a.toFixed(2)}:${b.toFixed(2)}:` + p.side + (p.blank ? 'b' : '') + p.pockets.map((c) => c ? `${c.img}|${c.owned}|${c.hidden ? 1 : 0}|${c.number}` : '-').join(';');
  }

  /** Předem připraví stranu, aby byla hotová, než se list začne otáčet. */
  warm(p: PageSpec | null) { if (p) this.texture(p); }

  private texture(p: PageSpec) {
    const k = this.key(p);
    let c = this.tex.get(k);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.ceil(LW * this.R) + 1; c.height = Math.ceil(LH * this.R) + 1;
    const g = c.getContext('2d')!, [ox, oy] = this.frac(p.side);
    // strana se vykreslí se stejným zlomkem pixelu, na jakém leží na obrazovce, takže v klidu sedí 1 : 1
    g.translate(ox, oy);
    this.paintPage(g, p);
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
      if (L.glow) {
        // vnější záře kapsy: stín obdélníku zmenšeného o 5 px, kreslený jen mimo kapsu
        g.save();
        g.beginPath(); g.rect(x - 30, y - 30, pw + 60, ph + 60); g.rect(x, y, pw, ph); g.clip('evenodd');
        g.shadowColor = L.glow; g.shadowBlur = 16 * R; g.shadowOffsetX = 10000 * R;
        g.fillStyle = '#000'; g.fillRect(x + 5 - 10000, y + 5, pw - 10, ph - 10);
        g.restore();
      }
      rr(g, x, y, pw, ph, pr); g.fillStyle = cssLinear(g, 160, x, y, pw, ph, [[0, 'rgba(255,255,255,.07)'], [0.4, 'rgba(255,255,255,0)']]); g.fill();
      rr(g, x + 0.5, y + 0.5, pw - 1, ph - 1, Math.max(0, pr - 0.5)); g.strokeStyle = L.pocket; g.lineWidth = 1; g.stroke();
      g.globalAlpha = 1;
      if (!c) return;
      if (c.owned > 0 && !c.hidden) { this.paintCard(g, c, x + (pw - 92) / 2, y + (ph - 126) / 2); return; }
      this.paintEmpty(g, c, x, y, pw, ph);
    });
    g.drawImage(gutterImage(p.side), 0, 0, LW, LH);
    g.restore();
  }

  private paintCard(g: G, c: PocketSpec, x: number, y: number) {
    const sx = 92 / 150, sy = 126 / 206;
    g.save();
    // stín canvasu se neškáluje transformací, proto * R (jinak je při zvětšení slabší než box-shadow v DOM)
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 4 * this.R; g.shadowOffsetY = 2 * this.R;
    // jen vržený stín jako v DOM (.kc box-shadow): tvar má barvu strany, takže kolem obalu neprosvítá tmavý okraj
    rr(g, x, y, 92, 126, 7); g.fillStyle = this.look.page; g.fill();
    g.restore();
    g.save();
    rr(g, x, y, 92, 126, 9 * sx); g.clip();
    if (this.sleeve) g.drawImage(this.sleeve, x, y, 92, 126);
    // okénko 136 × 190 v obalu 150 × 206 = poměr karty 63 : 88
    const ix = x + 7 * sx, iy = y + 8 * sy, iw = 92 - 14 * sx, ih = 126 - 16 * sy;
    const im = c.img ? this.image(c.img) : null;
    g.save();
    if (im) {
      // jako DOM: obrázek se zaoblenými rohy podle svého skutečného poměru, okénko kolem bez tmavé výplně
      const s = Math.min(iw / im.naturalWidth, ih / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s;
      const dx = ix + (iw - w) / 2, dy = iy + (ih - h) / 2;
      rr(g, dx, dy, w, h, 6 * sx); g.clip();
      g.drawImage(im, dx, dy, w, h);
    } else {
      rr(g, ix, iy, iw, ih, 6 * sx); g.fillStyle = '#151a22'; g.fill();
    }
    g.restore();
    g.restore();
    if (c.owned > 1) {
      const t = `×${c.owned}`;
      g.font = '700 10px Inter, sans-serif';
      const w = g.measureText(t).width + 10;
      rr(g, x + 4, y + 126 - 4 - 16, w, 16, 5); g.fillStyle = 'rgba(11,14,19,.85)'; g.fill();
      g.fillStyle = '#e8ecf1'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, x + 9, y + 126 - 12);
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
    if (leaves.length && !this.live.length && !this.ghosts.length) this.align();
    this.live = leaves;
    this.render();
  }

  /** Dosedlé listy (q = 0 nebo 1) se 160 ms prolínají do stran v DOM. */
  fade(leaves: LeafState[]) {
    const t0 = performance.now();
    leaves.forEach((l) => this.ghosts.push({ l, t0 }));
    if (!this.graf) {
      const step = () => {
        this.render();
        this.graf = this.ghosts.length ? requestAnimationFrame(step) : 0;
      };
      this.graf = requestAnimationFrame(step);
    }
    this.render();
  }

  private render() {
    const g = this.g, now = performance.now();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.el.width, this.el.height);
    this.ghosts = this.ghosts.filter((x) => now - x.t0 < 160);
    for (const x of this.ghosts) { g.globalAlpha = 1 - (now - x.t0) / 160; this.drawLeaf(x.l); }
    g.globalAlpha = 1;
    for (const l of this.live) this.drawLeaf(l);
  }

  private drawLeaf(l: LeafState) {
    const R = this.R, g = this.g, q = l.q, th = -180 * q, b = Math.sin(Math.PI * clamp(q, 0, 1));
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
    const ff = l.front ? this.frac(l.front.side) : [0, 0], fb = l.back ? this.frac(l.back.side) : [0, 0];
    for (const i of order) {
      const a = ang((i + 0.5) / NSL), r = a * Math.PI / 180;
      const mx = (P[i][0] + P[i + 1][0]) / 2, mz = (P[i][1] + P[i + 1][1]) / 2;
      const front = (OX - mx) * Math.sin(r) + (PERSP - mz) * Math.cos(r) >= 0;
      const t = front ? tf : tb;
      if (!t) continue;
      const p0 = pts[i], p1 = pts[i + 1], A = front ? p0 : p1, B = front ? p1 : p0;
      const u0 = front ? i * SL : LW - (i + 1) * SL, ax = (B.X - A.X) / SL, ay = (B.Y - A.Y) / SL, d = (p0.s + p1.s) / 2;
      // zdrojový proužek u0..u0+SL se zobrazí mezi body A a B; přesah EXT překryje styk se sousedem
      g.setTransform(R * ax, R * ay, 0, R * d, R * (A.X - ax * u0) + this.fx, R * (A.Y - ay * u0 - d * OY) + this.fy);
      const sw = Math.min(SL + EXT, LW - u0), [ox, oy] = front ? ff : fb;
      g.drawImage(t, u0 * R + ox, oy, sw * R, LH * R, u0, 0, sw, LH);
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
