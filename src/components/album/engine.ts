// Otevřené album podle desek 3A (listování, tloušťka, vyjetí karty) a 3B (plnění z balíčku, zrychlování, přehled 2A).
// Kreslí se přímo do DOM: pohyb listů běží ve smyčce requestAnimationFrame, React by ho zbytečně brzdil.
import { coverDeco, type AlbumDesign, type SleeveDesign } from '@/lib/album/designs';
import { thumbUrl } from '@/lib/images';
import { LeafCanvas, gutterImage, type PageSpec } from './leafCanvas';

// velikosti vrstev potahu: vrstva s vlastní velikostí ("… / 4px 4px") ji drží, ostatní se roztáhnou přes dvoustranu
function liningSizes(bg: string): string {
  const layers: string[] = [];
  let depth = 0, cur = '';
  for (const ch of bg) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { layers.push(cur); cur = ''; } else cur += ch;
  }
  layers.push(cur);
  return layers.map((l) => {
    let d = 0, slash = -1;
    for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '(') d++; else if (c === ')') d--; else if (c === '/' && d === 0) slash = i; }
    return slash >= 0 ? l.slice(slash + 1).trim() : '752px 504px';
  }).join(', ');
}

export interface EngineCard {
  id: string;
  slug: string;
  name: string;
  number: string;
  image: string | null;
  /** Kolik kusů uživatel má (0 = prázdná kapsa) */
  owned: number;
  setName?: string;
  rarity?: string | null;
  minPrice?: number | null;
  offers?: number;
}

export interface EngineOptions {
  cards: EngineCard[];
  design: AlbumDesign;
  sleeve: SleeveDesign;
  name: string;
  /** Klik na prázdnou kapsu */
  onEmpty?: (card: EngineCard, index: number) => void;
  /** Tlačítko „Odebrat“ u vyjeté karty */
  onRemove?: (card: EngineCard, index: number) => void;
  /** Změna otevřené dvoustrany */
  onSpread?: (t: number) => void;
  /** Počítadlo „máš / celkem“ (alba sad) */
  counterTotal?: boolean;
  /** Album začne otevřené na první straně */
  open?: boolean;
}

const W = 360;
const SPRING = 'cubic-bezier(.22,1.2,.36,1)';
const STAGE_W = 960;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const smooth = (p: number) => p * p * (3 - 2 * p);
const outCubic = (p: number) => 1 - Math.pow(1 - p, 3);
const easeBack = (p: number) => { const c = 1.15; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
// velikost karty na hromádce a po zvednutí proti kartě v kapse (poměr podle desky 1B: .62, .78 a .404;
// hromádka je o kus menší, aby se vešla vedle alba)
const S_PILE = 1.25;
const S_LIFT = 1.57;
// dráha letu z desky 1B: [průběh, odchylka x, odchylka y od přímky balíček→kapsa, otočení, natažení x, y]
const FLIGHT: Array<[number, number, number, number, number, number]> = [[0,0,0,1.1,0.998,1.004],[0.019,-6.2,-1,2.1,0.998,1.004],[0.038,-12.5,-2.2,1.9,0.998,1.004],[0.056,-18.7,-3.6,1.6,0.998,1.005],[0.075,-25.1,-5.6,1.3,0.997,1.006],[0.094,-31.3,-8.7,1.1,0.996,1.008],[0.113,-37.5,-13.3,1,0.994,1.011],[0.131,-43.7,-20.3,1.3,0.992,1.015],[0.15,-49.6,-30.1,2.1,0.99,1.021],[0.169,-55,-43.6,4.1,0.986,1.027],[0.188,-58.2,-61.3,10.2,0.982,1.035],[0.206,-55.1,-82.5,23,0.978,1.044],[0.225,-40.9,-102.8,49,0.973,1.054],[0.244,-16.1,-85.6,113.3,0.968,1.065],[0.263,-7.1,-43.8,155.6,0.962,1.077],[0.281,-9.3,8.9,170.7,0.956,1.089],[0.3,-13.8,69.2,170.4,0.949,1.102],[0.319,27,117.8,136.8,0.943,1.115],[0.338,91.5,144.4,111.2,0.936,1.128],[0.356,168.4,154.5,97.8,0.929,1.141],[0.375,253.7,154.3,89,0.923,1.153],[0.394,345,139.5,80.7,0.918,1.165],[0.413,437.1,103.1,67,0.912,1.175],[0.431,510.2,26.9,44.7,0.908,1.184],[0.45,522,-83.7,7.1,0.904,1.191],[0.469,458.3,-186.6,-29.3,0.902,1.196],[0.488,340.5,-235.5,-62.8,0.9,1.199],[0.506,211.4,-252.7,-80.1,0.9,1.2],[0.525,82,-244.2,-93.2,0.902,1.196],[0.544,-37.9,-205,-109.6,0.905,1.189],[0.563,-132,-131.1,-132.3,0.91,1.179],[0.582,-155.4,-27.1,-175.5,0.917,1.167],[0.6,-97.3,48.2,-218.1,0.924,1.152],[0.619,-20.4,81,-248.2,0.932,1.136],[0.638,50,72.4,-281.5,0.941,1.119],[0.657,89.2,23.5,-316.4,0.949,1.101],[0.675,99.5,-29.8,-341.9,0.958,1.084],[0.694,98.3,-75.2,-352.3,0.966,1.067],[0.713,95.5,-110.5,-354.9,0.974,1.052],[0.732,90.4,-136.7,-358,0.981,1.038],[0.75,84.3,-154.9,-359.9,0.987,1.026],[0.769,77.9,-166.8,-360.6,0.991,1.017],[0.788,71.6,-174.2,-360.5,0.994,1.012],[0.807,65.4,-178.4,-360,0.996,1.008],[0.825,59,-172,-359.8,0.996,1.008],[0.844,52.7,-164.8,-359.8,0.995,1.01],[0.863,46.3,-156.4,-359.8,0.994,1.013],[0.882,40,-145.7,-359.9,0.992,1.017],[0.9,33.7,-132.3,-359.9,0.989,1.022],[0.919,27.3,-115.5,-359.9,0.986,1.028],[0.938,21,-94.7,-360,0.982,1.035],[0.957,14.6,-68.9,-360,0.978,1.043],[0.975,8.3,-37.8,-360,0.974,1.053],[1,0,0,-360,1,1]];

interface Leaf {
  q: number; v: number; tq: number; k: number; c: number; bs: number; ls: number;
  tw: { t0: number; dur: number; from: number; to: number; ease: (p: number) => number } | null;
  drag?: boolean;
  wait: Array<() => void>;
}

interface Grab {
  side: 'l' | 'r'; x: number; y: number; moved: boolean; sc: number; spine: number; top: boolean;
  card: { i: number; rect: DOMRect } | null; empty: number | null; on: boolean;
  i?: number; a0?: number; q0?: number; hist?: Array<[number, number]>; nq?: number;
}

/** Počet dvoustran česky */
export function spreadsWord(n: number) {
  return n === 1 ? 'dvoustrana' : n >= 2 && n <= 4 ? 'dvoustrany' : 'dvoustran';
}
export function cardsWord(n: number) {
  return n === 1 ? 'karta' : n >= 2 && n <= 4 ? 'karty' : 'karet';
}

/** Vejde název do štítku na desce stejně jako v návrzích alb: nejdřív ubírá rozpal písmen, pak velikost písma. */
export function fitCoverNames(root: ParentNode) {
  root.querySelectorAll<HTMLElement | SVGTextElement>('.nm').forEach((el) => {
    try {
      if (el instanceof SVGTextElement) {
        if (!el.dataset.w) return;
        if (el.dataset.ls0 === undefined) el.dataset.ls0 = String(parseFloat(el.getAttribute('letter-spacing') || '0'));
        let fs = Number(el.dataset.fs), ls = Number(el.dataset.ls0);
        const w = Number(el.dataset.w), mid = el.getAttribute('text-anchor') === 'middle';
        const set = () => {
          el.setAttribute('font-size', String(fs));
          if (el.hasAttribute('letter-spacing')) el.setAttribute('letter-spacing', String(ls));
          if (mid) el.setAttribute('dx', String(ls / 2));
        };
        set();
        el.removeAttribute('textLength'); el.removeAttribute('lengthAdjust');
        let n = 0;
        while (el.getComputedTextLength() > w && (fs > 6 || ls > 0) && n++ < 200) {
          if (ls > 0.3 && ls > fs * 0.1) ls = Math.max(0, ls - 0.5); else if (fs > 6) fs -= 0.5; else ls = 0;
          set();
        }
        if (el.getComputedTextLength() > w) { el.setAttribute('textLength', String(w)); el.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      } else {
        const cs = getComputedStyle(el);
        if (!el.dataset.fs0) { el.dataset.fs0 = String(parseFloat(cs.fontSize)); el.dataset.ls0 = String(parseFloat(cs.letterSpacing) || 0); }
        let fs = Number(el.dataset.fs0), ls = Number(el.dataset.ls0), n = 0;
        const set = () => { el.style.fontSize = fs + 'px'; el.style.letterSpacing = ls + 'px'; el.style.textIndent = ls + 'px'; };
        set();
        while (el.scrollWidth > el.clientWidth && (fs > 8 || ls > 0.5) && n++ < 200) {
          if (ls > 0.5 && ls > fs * 0.08) ls = Math.max(0.5, ls - 0.5); else fs -= 0.5;
          set();
        }
        while (fs > 6 && el.scrollWidth > el.clientWidth && n++ < 400) { fs -= 0.5; set(); }
      }
    } catch { /* písmo ještě není nebo prvek není vidět */ }
  });
}

/** HTML obalu s kartou (150 × 206, v albu zmenšené). */
export function sleeveHTML(s: SleeveDesign, image: string | null, alt = '', full = false) {
  const src = image ? (full ? image : thumbUrl(image) ?? image) : null;
  return `<div class="asl f-${s.film}"><svg aria-hidden="true"><use href="#s${s.id}"></use></svg>` +
    `<div class="img">${src ? `<img src="${esc(src)}" alt="${esc(alt)}" decoding="sync" draggable="false">` : ''}</div><span class="fm"></span></div>`;
}

/** Obal zezadu, bez karty (150 × 206), jako rub vyjeté karty v detailu. */
export function sleeveBackHTML(s: SleeveDesign) {
  return `<div class="asl rub f-${s.film}"><svg aria-hidden="true"><use href="#s${s.id}"></use></svg><span class="fm"></span></div>`;
}

/** Hrana desky v zaoblených rozích (rádius 27 × 29 px jako desky v návrhu) poskládaná z krátkých úseků. */
function coverCorners() {
  const N = 8, rx = 26.5, ry = 28.5, x0 = 349; // o půl px pod plochou desky, aby mezi hranou a deskou nevznikla spára
  let h = '';
  for (const [cy, sy] of [[29, -1], [475, 1]] as const) {
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI / 2, a1 = ((k + 1) / N) * Math.PI / 2;
      const p0 = [x0 + rx * Math.sin(a0), cy + sy * ry * Math.cos(a0)], p1 = [x0 + rx * Math.sin(a1), cy + sy * ry * Math.cos(a1)];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 0.8, ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI;
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      h += `<span class="ce cr" style="width:${len.toFixed(2)}px;transform:translate(${(mx - len / 2).toFixed(2)}px,${(my - 4).toFixed(2)}px) rotateZ(${ang.toFixed(2)}deg) rotateX(90deg)"></span>`;
    }
  }
  return h;
}

/** HTML desky alba (168 × 210). */
export function coverHTML(d: AlbumDesign, name: string) {
  return `<div class="acv" style="background:${d.mat}">${coverDeco(d, name)}<span class="gl"></span></div>`;
}

const rasterCache = new Map<number, string>();

export class AlbumEngine {
  private o: EngineOptions;
  private cards: EngineCard[];
  private root: HTMLElement;
  private stage!: HTMLElement;
  private book!: HTMLElement;
  private cov!: HTMLElement;
  private spr: HTMLElement | null = null;
  private lsh: HTMLElement | null = null;
  private bl!: HTMLElement;
  private br!: HTMLElement;
  private leafbox!: HTMLElement;
  private lc!: LeafCanvas;
  private NP = 1;
  private NL = 2;
  private side: Array<'L' | 'R'> = [];
  private F: Record<number, Leaf> = {};
  /** Kolikrát větší se deska vykresluje (viz fit). */
  private ss = 1;
  // osa otáčení desky a zmenšení hloubky, změřené v prohlížeči (calib)
  private hx = 2;
  private dz = 1;
  private raf = 0;
  private dragLoop = 0;
  private g: Grab | null = null;
  private hk: HTMLElement | null = null;
  private hidden = new Set<number>();
  private glow = new Set<number>();
  private sel: number | null = null;
  private lastBases = '';
  private warmTimer = 0;
  private ro: ResizeObserver | null = null;
  private dead = false;
  private busy = false;
  private pop: { i: number; el: HTMLElement; closing?: boolean } | null = null;
  private ry = 0; private rx = 0; private tilt = { x: 0, y: 0 }; private w = 0; private vx = 0; private mode: 'free' | 'snap' = 'snap'; private tgt = 0;
  private r: { x: number; y: number; ry: number; rx: number; h: Array<[number, number]> } | null = null;
  private sraf = 0;
  private sumPage = 0;
  private sumData: { title: string; sub: string; spreads: number[]; fresh: Set<number> } | null = null;
  private lastT = -1;
  private edgeK = 1;
  private lastEdge = ['', ''];
  private lastLR = [-2, -2];

  constructor(root: HTMLElement, o: EngineOptions) {
    this.root = root;
    this.o = o;
    this.cards = o.cards.slice();
    this.layout();
    this.build();
    if (o.open) { this.side[0] = 'L'; this.sync(true); }
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf); cancelAnimationFrame(this.dragLoop); cancelAnimationFrame(this.sraf);
    this.ro?.disconnect();
    this.root.innerHTML = '';
  }

  // ---------- rozměry ----------
  private layout() {
    this.NP = Math.max(1, Math.ceil(this.cards.length / 9));
    this.NL = 1 + Math.max(1, Math.ceil(this.NP / 2));
    const prev = this.side;
    this.side = Array.from({ length: this.NL }, (_, i) => prev[i] ?? 'R');
  }

  /** t = kolik listů leží vlevo (0 = zavřené album; t: vlevo strana 2t−2, vpravo 2t−1). */
  get t() { return this.logicalT(); }
  get spreads() { return this.NL; }

  private spreadOf(index: number) { const p = Math.floor(index / 9) + 1; return Math.floor(p / 2) + 1; }

  // ---------- HTML stran ----------
  private pocket(idx: number) {
    const c = this.cards[idx];
    const cls = 'pk' + (this.glow.has(idx) ? ' glow' : '') + (this.sel === idx ? ' sel' : '');
    if (!c) return `<div class="pk"></div>`;
    if (c.owned > 0) {
      return `<div class="${cls}"><div class="kc${this.hidden.has(idx) ? ' off' : ''}" data-c="${idx}">${sleeveHTML(this.o.sleeve, c.image, c.name)}` +
        `<span class="gs"></span>${c.owned > 1 ? `<span class="qty">×${c.owned}</span>` : ''}</div></div>`;
    }
    return `<div class="${cls}"><div class="em" data-e="${idx}" title="${esc(c.name)}"><span>#${esc(c.number)}</span><small>${esc(c.name)}</small></div></div>`;
  }

  private pageHTML(p: number, side: 'l' | 'r', left = '') {
    const st = left ? ` style="left:${left}"` : '';
    if (p < 1) return `<div class="pg ins ${side}"${st}><span class="cbl"></span><span class="gl"></span><span class="shade"></span></div>`;
    let h = `<div class="pg ${side}${p > this.NP ? ' blank' : ''}" data-p="${p}"${st}>`;
    for (let k = 0; k < 9; k++) h += p > this.NP ? '<div class="pk"></div>' : this.pocket((p - 1) * 9 + k);
    return h + '<span class="cbl"></span><span class="gl"></span><span class="shade"></span></div>';
  }

  /** Strana listu i (líc = strana 2i−1, rub = 2i); list 0 je deska. */
  private face(i: number, back: boolean, side: 'l' | 'r', left = ''): string {
    if (i < 0 || (i === 0 && back)) return `<div class="pg none ${side}"></div>`;
    if (i >= this.NL) return this.pageHTML(0, side, left);
    if (i === 0) return this.face(1, false, side, left);
    return this.pageHTML(back ? 2 * i : 2 * i - 1, side, left);
  }

  /** Strana otáčeného listu pro plátno (stejný obsah jako pageHTML). */
  /** Připraví strany listů, které se nejspíš otočí jako další; obrázky stran o list dál jen stáhne a dekóduje. */
  private warmNext() {
    clearTimeout(this.warmTimer);
    this.warmTimer = window.setTimeout(() => {
      if (this.dead || this.moving().length) return;
      const t = this.logicalT();
      for (const i of [t, t - 1]) { this.lc.warm(this.pageSpec(i, false)); this.lc.warm(this.pageSpec(i, true)); }
      for (const i of [t + 1, t - 2, t + 2, t - 3]) { this.lc.preload(this.pageSpec(i, false)); this.lc.preload(this.pageSpec(i, true)); }
    }, 60);
  }

  private pageSpec(i: number, back: boolean): PageSpec | null {
    if (i < 1 || i >= this.NL) return null;
    const p = back ? 2 * i : 2 * i - 1, blank = p > this.NP, pockets: PageSpec['pockets'] = [];
    for (let k = 0; k < 9; k++) {
      const idx = (p - 1) * 9 + k, c = blank ? undefined : this.cards[idx];
      pockets.push(c ? { img: c.image ? thumbUrl(c.image) ?? c.image : null, number: c.number, name: c.name, owned: c.owned, hidden: this.hidden.has(idx) } : null);
    }
    return { side: back ? 'l' : 'r', blank, pockets };
  }

  // ---------- kostra ----------
  private build() {
    const d = this.o.design;
    this.root.classList.add('alb');
    if (d.square) this.root.classList.add('sq');
    this.root.style.setProperty('--page', d.page);
    this.root.style.setProperty('--lining', d.lining);
    this.root.style.setProperty('--mat', d.mat);
    // velikost potahu: vzor s vlastní velikostí (např. tečky 4 px) ji drží, přechod se roztáhne přes celou dvoustranu
    this.root.style.setProperty('--lining-sz', liningSizes(d.lining));
    this.root.style.setProperty('--pocket', d.pocket);
    this.root.style.setProperty('--empty', d.empty);
    this.root.style.setProperty('--edge', 'rgba(0,0,0,.55)');
    if (d.glow) { this.root.classList.add('gw'); this.root.style.setProperty('--glow', d.glow); }
    const arrow = (dir: string) => `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir}"></path></svg>`;
    this.root.innerHTML =
      `<div class="alb-stage"><div class="book">` +
      `<span class="spr"${d.glow ? ` style="--glw:0 0 34px ${d.glow}55,"` : ''}></span>` +
      `<div class="cov"><div class="cf out">${coverHTML(d, this.o.name)}<span class="csh"></span></div><div class="cf in"><span class="lsh"></span><span class="csh"></span></div>` +
      `<span class="ce er"></span><span class="ce et"></span><span class="ce eb"></span><span class="ce eh"></span>${coverCorners()}</div>` +
      `<div class="bl"></div><div class="br"></div><div class="leafbox"></div></div>` +
      `<button type="button" class="arr pv" aria-label="Předchozí strana">${arrow('M13.5 5 L7.5 11 L13.5 17')}</button>` +
      `<button type="button" class="arr nx" aria-label="Další strana">${arrow('M8.5 5 L14.5 11 L8.5 17')}</button>` +
      `<div class="ind"><span class="txt"></span><span class="dots"></span></div>` +
      `<div class="deck"></div><div class="sum"></div></div>`;
    this.stage = this.root.querySelector('.alb-stage')!;
    this.book = this.root.querySelector('.book')!;
    this.cov = this.root.querySelector('.cov')!;
    this.spr = this.root.querySelector('.spr');
    this.lsh = this.root.querySelector('.cf.in .lsh');
    this.bl = this.root.querySelector('.bl')!;
    this.br = this.root.querySelector('.br')!;
    this.leafbox = this.root.querySelector('.leafbox')!;
    this.root.style.setProperty('--gut-r', `url("${gutterImage('r').toDataURL()}")`);
    this.root.style.setProperty('--gut-l', `url("${gutterImage('l').toDataURL()}")`);
    this.lc = new LeafCanvas(this.leafbox, { page: d.page, pocket: d.pocket, empty: d.empty, square: !!d.square, film: this.o.sleeve.film, glow: d.glow ?? undefined }, () => { if (this.moving().length) this.apply(); else this.warmNext(); });
    fitCoverNames(this.cov);
    if (typeof document !== 'undefined' && document.fonts) document.fonts.ready.then(() => { if (!this.dead) fitCoverNames(this.cov); });

    this.root.querySelector('.pv')!.addEventListener('click', () => this.turn(-1));
    this.root.querySelector('.nx')!.addEventListener('click', () => this.turn(1));
    this.cov.addEventListener('pointerdown', (e) => this.down(this.side[0] === 'R' && !this.F[0] ? 'r' : (this.F[0] && this.F[0].tq === 0 ? 'r' : 'l'), e as PointerEvent));
    this.bl.addEventListener('pointerdown', (e) => this.down('l', e as PointerEvent));
    this.br.addEventListener('pointerdown', (e) => this.down('r', e as PointerEvent));
    this.stage.addEventListener('pointermove', (e) => this.move(e as PointerEvent));
    this.stage.addEventListener('pointerup', () => this.up());
    this.stage.addEventListener('pointercancel', () => this.up());
    this.stage.addEventListener('pointerleave', () => this.unhover());

    const fit = () => {
      const k = Math.min(1.25, this.root.clientWidth / STAGE_W);
      this.stage.style.transform = `scale(${k})`;
      this.lc.setScale(k);
      // deska se při otáčení kreslí ve 3D a prohlížeč ji rastruje v jejích vlastních pixelech, pak ji teprve zvětší
      // (zvětšení alba × hustota obrazovky). Deska se proto vykreslí ss× větší a zmenší zpět: otáčená je stejně ostrá jako v klidu.
      const dpr = window.devicePixelRatio || 1, zs = typeof CSS !== 'undefined' && CSS.supports('zoom', '2');
      this.ss = zs ? Math.min(3, Math.max(2, Math.ceil(k * dpr - 0.05))) : 1;
      this.root.style.setProperty('--ss', String(this.ss));
      if (!this.dead) { this.calib(); this.apply(); }
      this.root.style.height = `${600 * k}px`;
    };
    fit();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(fit); this.ro.observe(this.root); }
    this.sync(true);
    this.rasterSleeve();
  }

  /**
   * Vzor obalu se jednou převede na obrázek. Stovky obalů jako živé SVG se vzory by se při listování
   * překreslovaly snímek po snímku; obrázek prohlížeč jen přenese.
   */
  private rasterSleeve(tries = 0) {
    if (typeof document === 'undefined' || this.dead) return;
    const id = this.o.sleeve.id;
    const cached = rasterCache.get(id);
    if (cached) { this.root.style.setProperty('--slv', `url("${cached}")`); this.root.classList.add('rast'); this.lc.setSleeve(cached); return; }
    const sym = document.getElementById(`s${id}`);
    if (!sym) { if (tries < 40) setTimeout(() => this.rasterSleeve(tries + 1), 150); return; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300" height="412" viewBox="0 0 150 206" preserveAspectRatio="none">${sym.innerHTML}</svg>`;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = 300; cv.height = 412;
      const cx = cv.getContext('2d');
      if (!cx) return;
      cx.drawImage(img, 0, 0, 300, 412);
      cv.toBlob((b) => {
        if (!b) return;
        const url = URL.createObjectURL(b);
        rasterCache.set(id, url);
        if (!this.dead) { this.root.style.setProperty('--slv', `url("${url}")`); this.root.classList.add('rast'); this.lc.setSleeve(url); }
      });
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  // ---------- stav listů ----------
  private moving() { return Object.keys(this.F).map(Number).sort((a, b) => a - b); }
  private logicalT() { let t = 0; for (let i = 0; i < this.NL; i++) { const f = this.F[i]; if (f ? f.tq === 1 : this.side[i] === 'L') t = i + 1; } return t; }
  private bases() {
    const m = this.moving();
    let lb = -1, rb = this.NL;
    if (m.length) {
      for (let i = m[0] - 1; i >= 0; i--) if (this.side[i] === 'L') { lb = i; break; }
      for (let i = m[m.length - 1] + 1; i < this.NL; i++) if (this.side[i] === 'R') { rb = i; break; }
    } else {
      for (let i = 0; i < this.NL; i++) { if (this.side[i] === 'L') lb = i; else { rb = i; break; } }
    }
    return { lb, rb };
  }

  /** Překreslí strany pod listy a otáčené listy (po změně, která listů se hýbe). */
  private sync(force = false) {
    const { lb, rb } = this.bases();
    const m = this.moving().filter((i) => i > 0);
    const key = `${lb}|${rb}|${m.join(',')}`;
    if (force || key !== this.lastBases) {
      this.lastBases = key;
      // tloušťka bloku stran je stín na vlastní prázdné vrstvě: mění se každý snímek a překreslovat celou stranu s kartami by listování sekalo.
      // Strana se přestaví jen když se opravdu změnila, jinak by karty při listování problikly.
      if (force || lb !== this.lastLR[0]) { this.bl.innerHTML = `<span class="edg l"></span>${this.face(lb, true, 'l')}`; this.lastEdge[0] = ''; }
      if (force || rb !== this.lastLR[1]) { this.br.innerHTML = `<span class="edg r"></span>${this.face(rb, false, 'r')}`; this.lastEdge[1] = ''; }
      this.lastLR = [lb, rb];
      // strany listů, které se pravděpodobně otočí jako další, se připraví předem
      if (!m.length) this.warmNext();
    }
    this.ui();
    this.apply();
  }

  private ui() {
    const t = this.logicalT(), NL = this.NL;
    this.root.querySelector('.pv')!.classList.toggle('off', t <= 0);
    this.root.querySelector('.nx')!.classList.toggle('off', t >= NL);
    const pages = [2 * t - 2, 2 * t - 1].filter((p) => p >= 1 && p <= this.NP);
    const txt = this.root.querySelector<HTMLElement>('.ind .txt')!;
    txt.classList.toggle('plain', !pages.length);
    txt.innerHTML = t === 0 ? 'Zavřené album' : !pages.length ? 'Konec alba'
      : `<span>${pages.length === 2 ? 'Strany' : 'Strana'}</span><b>${pages.join('–')}</b><span>z ${this.NP}</span>`;
    const dots = this.root.querySelector<HTMLElement>('.ind .dots')!;
    if (dots.childElementCount !== NL + 1) {
      dots.innerHTML = Array.from({ length: NL + 1 }, (_, i) => `<span class="dot" data-t="${i}" title="${i === 0 ? 'Zavřít album' : 'Dvoustrana ' + i}"></span>`).join('');
      dots.querySelectorAll<HTMLElement>('.dot').forEach((d) => d.addEventListener('click', () => this.goTo(Number(d.dataset.t))));
    }
    dots.querySelectorAll<HTMLElement>('.dot').forEach((d, i) => d.classList.toggle('on', i === t));
    if (t !== this.lastT) { this.lastT = t; this.o.onSpread?.(t); }
  }

  private edgeShadow(nLeaves: number, sx: number) {
    // tloušťka roste s počtem listů jen do ~12 px, aby blok stran nevylezl z desek
    const T = Math.round(48 * (1 - Math.exp(-Math.max(0, nLeaves) / 3))) / 4, C = Math.ceil(T / 2 - 0.01), L: string[] = [];
    for (let k = 1; k <= C; k++) {
      const x = T * k / C;
      L.push(`${(sx * (x - 1)).toFixed(2)}px ${(x * 0.2).toFixed(2)}px 0 color-mix(in srgb,var(--page) 80%,#000)`, `${(sx * x).toFixed(2)}px ${(x * 0.2).toFixed(2)}px 0 color-mix(in srgb,var(--page) 96%,#000)`);
    }
    L.push('0 40px 70px -28px #000');  // vržený stín bloku
    return L.join(',');
  }

  /**
   * Pořadí otáčených listů na plátně (záporné = a se kreslí pod b). Na stejné polovině leží výš list,
   * který tam dopadl později. Když je každý list na jiné polovině, leží výš ten, který už je na své
   * cílové straně. Polovinu určuje střed ohnutého listu, ne úhel u hřbetu: jinak se pořadí přehodilo
   * ve chvíli, kdy se listy ještě překrývaly, a jeden z nich na chvíli zmizel.
   */
  private stackCmp(ia: number, fa: Leaf, ib: number, fb: Leaf) {
    // na kterou polovinu list opravdu padá, určuje jeho střed: zahnutý okraj ho při letu táhne daleko za úhel u hřbetu
    const mid = (f: Leaf) => f.q - Math.sin(Math.PI * clamp(f.q, 0, 1)) * (13 + 9 * Math.abs(clamp(f.v * 0.35, -1, 1))) * f.bs * 2.025 / 180;
    const ma = mid(fa), mb = mid(fb), la = ma >= 0.5, lb = mb >= 0.5;
    // listy jedoucí stejným směrem na různých polovinách: kde se překrývají, je výš ten, který stojí blíž svislé poloze
    // (dolétající list se pokládá na ten, který už je skoro dole, a odlétající je nad tím, který se teprve zvedá)
    if (la !== lb && fa.tq === fb.tq) {
      const d = Math.abs(mb - 0.5) - Math.abs(ma - 0.5);
      if (Math.abs(d) > 1e-6) return d;
    }
    if (la === lb) return la ? ia - ib : ib - ia;
    const ha = la === (fa.tq === 1), hb = lb === (fb.tq === 1);
    if (ha !== hb) return ha ? 1 : -1;
    return (la ? 50 + ia : 50 - ia) - (lb ? 50 + ib : 50 - ib);
  }

  // Prohlížeče se liší v tom, jak zoom desky násobí posuny uvnitř 3D transformace. Proto se změří:
  // otevřená deska ve 3D (otočená o 180°) musí přesně lícovat se stejnou deskou nakreslenou naplocho.
  private calib() {
    const cov = this.cov, inn = cov.querySelector<HTMLElement>('.cf.in'), ss = this.ss, iv = (1 / ss).toFixed(6);
    this.hx = 2 / ss; this.dz = 1 / ss;
    if (!inn || ss === 1) { this.hx = 2; this.dz = 1; return; }
    const cl = cov.className, tr = cov.style.transform, h0 = this.hx, d0 = this.dz;
    const at = (hx: number, dz: number) => {
      cov.style.transform = `translateX(${hx}px) rotateY(-180deg) translateX(${-hx}px) scale3d(${iv},${iv},${dz})`;
      return inn.getBoundingClientRect();
    };
    try {
      cov.classList.add('flat'); cov.classList.remove('shut'); cov.style.transform = `scale(${iv})`;
      const f = inn.getBoundingClientRect();
      cov.classList.remove('flat');
      const px = f.width / (376 * 1.001948);
      if (!(px > 0)) return;
      // hloubka: perspektiva zvětší desku P/(P−z), z má vyjít 3,5 px jako naplocho
      const s3 = (at(this.hx, this.dz).width / f.width) * 1.001948, z = 1800 * (1 - 1 / s3);
      if (z > 0.3 && z < 60) this.dz *= 3.5 / z;
      // osa: posun hrany je lineární v hx
      const e1 = (at(this.hx, this.dz).right - f.right) / px, e2 = (at(this.hx + 1, this.dz).right - f.right) / px;
      if (Math.abs(e2 - e1) > 1e-3) this.hx -= e1 / (e2 - e1);
      if (!(Math.abs(this.hx) < 12 && this.dz > 0 && this.dz < 2)) { this.hx = h0; this.dz = d0; }
    } finally { cov.className = cl; cov.style.transform = tr; }
  }

  private apply() {
    const f0 = this.F[0];
    const cq = f0 ? f0.q : (this.side[0] === 'L' ? 1 : 0);
    const ca = -180 * cq;
    // úplně otevřená deska v klidu se kreslí naplocho (bez 3D), jinak ji Firefox rozdělí na dlaždice a mezi nimi ukáže tmavou spáru
    // stejně tak zavřená deska v klidu (hrany desky jsou potřeba jen při otáčení, jinak v rozích vykukují jako pixel)
    const flat = !f0 && cq >= 1, shut = !f0 && cq <= 0;
    this.cov.classList.toggle('flat', flat);
    this.cov.classList.toggle('shut', shut);
    const ss = this.ss, iv = (1 / ss).toFixed(6);
    // zmenšit i hloubku (scale3d), jinak by se posun translateZ uvnitř zvětšené desky násobil a deska by po dokončení otáčení poskočila
    const inv = `scale3d(${iv},${iv},${this.dz.toFixed(6)})`;
    this.cov.style.transform = flat || shut ? `scale(${iv})` : `translateX(${this.hx.toFixed(4)}px) rotateY(${ca.toFixed(2)}deg) translateX(${(-this.hx).toFixed(4)}px) ${inv}`;
    this.cov.style.zIndex = ca > -90 ? '60' : '1';
    // vnitřek dvoustrany: zavřené album v klidu ukazuje jen zadní desku (od 7 px za osou). Jakmile se deska zvedne,
    // odkryje se i pruh mezi osou a zadní deskou (jinak by v něm byla vidět mezera) a od půlky otáčení pruh hřbetu
    // 14 px před osou, který zakryje spáru u otáčené desky. Otevřené album v klidu je vidět celé.
    if (this.spr) {
      const x = shut ? 7 : 7 - 5 * clamp(cq / 0.06, 0, 1) - 16 * clamp((cq - 0.5) * 4, 0, 1);
      this.spr.style.clipPath = flat ? '' : `inset(-60px -90px -130px ${(x + 374).toFixed(2)}px)`;
    }
    const c = Math.cos(ca * Math.PI / 180), cs = this.cov.querySelectorAll<HTMLElement>('.csh');
    cs[0].style.opacity = (0.5 * (1 - c) / 2).toFixed(3);
    cs[1].style.opacity = (0.4 * (1 + c) / 2).toFixed(3);
    this.book.style.transform = `translateX(${(-180 * Math.max(0, 1 - Math.min(1.04, cq))).toFixed(1)}px)`;
    const m = this.moving().filter((i) => i > 0);
    const ls = m.map((i) => ({ i, f: this.F[i] })).filter((x) => x.f)
      .sort((a, b) => this.stackCmp(a.i, a.f, b.i, b.f));
    this.lc.draw(ls.map(({ i, f }) => ({ front: this.pageSpec(i, false), back: this.pageSpec(i, true), q: f.q, v: f.v, bs: f.bs, ls: f.ls })));
    let lA = 0, rA = 0;
    for (let i = 1; i < this.NL; i++) { const f = this.F[i], q = f ? clamp(f.q, 0, 1) : (this.side[i] === 'L' ? 1 : 0); lA += q; rA += 1 - q; }
    const el = this.bl.querySelector<HTMLElement>('.edg'), er = this.br.querySelector<HTMLElement>('.edg');
    // vnitřek desky (.ins) není strana: pod ním není blok stran ani jeho vržený stín
    const hl = !this.bl.querySelector('.pg:not(.none):not(.ins)'), hr = !this.br.querySelector('.pg:not(.none):not(.ins)');
    const m0 = m.length ? this.F[m[0]].q : null, m1 = m.length ? this.F[m[m.length - 1]].q : null;
    // prázdná strana (vnitřek desky): vržený stín bloku přibývá už během dopadu prvního listu, ne až po dosednutí
    const drop = (a: number) => (a > 0.001 ? `0 40px 70px -28px rgba(0,0,0,${clamp(a, 0, 1).toFixed(3)})` : 'none');
    const sl0 = hl ? (m0 === null ? 'none' : drop(m0 * m0)) : this.edgeShadow((lA - 1) * this.edgeK, -1);
    const sr0 = hr ? (m1 === null ? 'none' : drop((1 - m1) * (1 - m1))) : this.edgeShadow((rA - 1) * this.edgeK, 1);
    if (el && sl0 !== this.lastEdge[0]) { el.style.boxShadow = sl0; this.lastEdge[0] = sl0; }
    if (er && sr0 !== this.lastEdge[1]) { er.style.boxShadow = sr0; this.lastEdge[1] = sr0; }
    const sl = this.bl.querySelector<HTMLElement>('.shade'), sr = this.br.querySelector<HTMLElement>('.shade');
    const qMinL = m.length ? this.F[m[0]].q : null, qMaxR = m.length ? this.F[m[m.length - 1]].q : null;
    // stín, který list vrhá na stranu pod sebou: čím blíž list je, tím tmavší (plynule až do zakrytí, bez zesvětlení na konci)
    const sh = (x: number) => (0.45 * clamp(x, 0, 1) ** 2).toFixed(3);
    if (sl) sl.style.opacity = qMinL === null ? '0' : sh(qMinL);
    // na začátku alba leží vlevo vnitřek přední desky: stín listu dopadá na prohlubeň, kam list dosedne (okraje desky zůstanou)
    if (this.lsh) this.lsh.style.opacity = hl && cq >= 1 && qMinL !== null ? sh(qMinL) : '0';
    if (sr) sr.style.opacity = qMaxR === null ? '0' : sh(1 - qMaxR);
  }

  /**
   * Sousední otáčené listy se nepředbíhají (list i leží vždy nad listem i+1). Dohánějící list jen počká
   * u souseda, nikdy necouvne. Vrací listy, které musely počkat.
   */
  private keepOrder(q0: Record<number, number>) {
    const ks = this.moving(), blocked = new Set<number>(), gap = 0.012;
    const was = (i: number) => q0[i] ?? this.F[i].q;
    // zavírání: nižší list (blíž desce) dohání vyšší, který už letí doprava
    for (let j = ks.length - 2; j >= 0; j--) {
      const a = ks[j], b = ks[j + 1], fa = this.F[a], fb = this.F[b];
      if (b !== a + 1 || fa.drag || fa.tq !== 0 || was(a) < was(b)) continue;
      // deska je pevná a kreslí se mimo plátno listů: nesmí projít ani zahnutým volným okrajem listu
      let top = fb.q;
      if (a === 0 && fb.bs < 0) top += 5 * Math.sin(Math.PI * clamp(fb.q, 0, 1)) * (13 + 9 * Math.abs(clamp(fb.v * 0.35, -1, 1))) / 180;
      const lim = Math.min(was(a), clamp(top, 0, 1) + gap);
      if (fa.q < lim) { fa.q = lim; blocked.add(a); }
    }
    // otevírání: vyšší list dohání nižší, který už letí doleva
    for (let j = 0; j < ks.length - 1; j++) {
      const a = ks[j], b = ks[j + 1], fa = this.F[a], fb = this.F[b];
      if (b !== a + 1 || fb.drag || fb.tq !== 1 || was(b) > was(a)) continue;
      const lim = Math.max(was(b), fa.q - gap);
      if (fb.q > lim) { fb.q = lim; blocked.add(b); }
    }
    return blocked;
  }

  // jedna smyčka pohne všemi listy; dokončené listy se uloží na svou stranu
  private run() {
    if (this.raf) return;
    let last = performance.now();
    const step = (now: number) => {
      if (this.dead) return;
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      const done: number[] = [], ended = new Set<number>(), q0: Record<number, number> = {};
      for (const k in this.F) {
        const f = this.F[k];
        if (f.drag) continue;
        q0[k] = f.q;
        if (f.tw) {
          const w = f.tw, p = Math.min(1, (now - w.t0) / w.dur);
          f.q = w.from + (w.to - w.from) * w.ease(p);
          if (p >= 1) { f.q = f.tq; ended.add(Number(k)); }
          continue;
        }
        const a = f.k * (f.tq - f.q) - f.c * f.v; f.v += a * dt; f.q += f.v * dt;
        if (Math.abs(f.tq - f.q) < 0.0015 && Math.abs(f.v) < 0.02) { f.q = f.tq; ended.add(Number(k)); }
      }
      // listy nemůžou projít jeden druhým: při rychlém zavírání by deska předběhla list, který ještě letí, a list by pod ní zmizel
      const blocked = this.keepOrder(q0);
      for (const k in this.F) {
        const f = this.F[k], i = Number(k);
        if (f.drag) continue;
        if (f.tw || blocked.has(i)) f.v = dt > 0 ? (f.q - q0[i]) / dt : 0;
        // čekající list se po uvolnění rozjede plynule z místa, kde stojí (ne skokem tam, kde by podle času už byl)
        if (f.tw && blocked.has(i)) f.tw = { ...f.tw, t0: now, from: f.q, dur: (i === 0 ? 1150 : 900) * Math.max(0.35, Math.abs(f.tq - f.q)), ease: smooth };
        if (ended.has(i) && !blocked.has(i)) { f.tw = null; f.v = 0; done.push(i); }
      }
      this.apply();
      if (done.length) {
        const waits: Array<() => void> = [];
        // dosedlý list se ještě krátce prolne do strany v DOM (žádné cuknutí při výměně)
        const ghosts = done.map((i) => ({ front: this.pageSpec(i, false), back: this.pageSpec(i, true), q: this.F[i].tq, v: 0, bs: this.F[i].bs, ls: this.F[i].ls }));
        done.forEach((i) => { this.side[i] = this.F[i].tq === 1 ? 'L' : 'R'; waits.push(...this.F[i].wait); delete this.F[i]; });
        this.sync();
        this.lc.fade(ghosts);
        waits.forEach((w) => w());
      }
      if (Object.keys(this.F).length) this.raf = requestAnimationFrame(step); else this.raf = 0;
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Spustí nebo přesměruje list i k cíli (1 = doleva, 0 = doprava). */
  private flip(i: number, to: number, opts?: { spring?: boolean; cover?: boolean; v?: number; dur?: number; ease?: (p: number) => number }): Promise<void> {
    let f = this.F[i];
    const isNew = !f;
    if (!f) f = this.F[i] = { q: this.side[i] === 'L' ? 1 : 0, v: 0, tq: 0, k: 110, c: 22, bs: 1, ls: 1, tw: null, wait: [] };
    f.tq = to; f.bs = to === 1 ? 1 : -1; f.drag = false;
    if (opts?.spring) {
      f.tw = null; f.k = opts.cover ? 70 : 110; f.c = opts.cover ? 14 : 2 * Math.sqrt(110) * 1.05; f.v = opts.v ?? 0;
    } else {
      const dist = Math.abs(to - f.q), fresh = Math.abs(f.v) < 0.05 && (f.q === 0 || f.q === 1);
      f.tw = {
        t0: performance.now(), dur: opts?.dur ?? (i === 0 ? 1150 : 900) * Math.max(0.35, dist), from: f.q, to,
        ease: opts?.ease ?? (i === 0 && to === 1 && fresh ? easeBack : fresh ? smooth : outCubic),
      };
    }
    const p = new Promise<void>((res) => f.wait.push(res));
    if (isNew) this.sync(); else this.ui();
    this.run();
    return p;
  }

  turn(dir: 1 | -1) {
    if (this.pop || this.g || this.busy) return;
    const t = this.logicalT();
    if (dir === 1 && t < this.NL) this.flip(t, 1);
    if (dir === -1 && t > 0) this.flip(t - 1, 0);
  }

  goTo(target: number) {
    if (this.busy) return Promise.resolve();
    return this.goToRaw(clamp(target, 0, this.NL));
  }

  private goToRaw(target: number, dur?: number, stagger = 70) {
    const t = this.logicalT(), ps: Promise<void>[] = [];
    // listy se rozjedou kousek po sobě, jako když se palcem přelistuje blok stran
    if (target > t) for (let k = t; k < target; k++) ps.push(this.delayFlip(k, 1, (k - t) * stagger, dur));
    if (target < t) for (let k = t - 1; k >= target; k--) ps.push(this.delayFlip(k, 0, (t - 1 - k) * stagger, dur));
    return Promise.all(ps).then(() => undefined);
  }

  private delayFlip(i: number, to: number, delay: number, dur?: number) {
    if (!delay) return this.flip(i, to, dur ? { dur } : undefined);
    return sleep(delay).then(() => (this.dead ? undefined : this.flip(i, to, dur ? { dur } : undefined)));
  }

  /** Otevře album na dvoustraně s kartou a zvýrazní její kapsu. */
  async showCard(index: number, select = true) {
    this.sel = select ? index : null;
    const t = this.spreadOf(index);
    if (t !== this.logicalT()) await this.goTo(t); else this.sync(true);
  }

  select(index: number | null) { this.sel = index; this.sync(true); }

  /** Nové údaje (po uložení nebo obnovení stránky). */
  setCards(cards: EngineCard[]) {
    this.cards = cards.slice();
    this.layout();
    this.sync(true);
  }

  rename(name: string) {
    const out = this.cov.querySelector('.cf.out');
    if (!out) return;
    out.querySelector('.acv')?.remove();
    out.insertAdjacentHTML('afterbegin', coverHTML(this.o.design, name));
    this.o.name = name;
    fitCoverNames(this.cov);
  }

  // ---------- tažení stránek a karty ----------
  private pick(side: 'l' | 'r') {
    if (side === 'r') { for (let i = 0; i < this.NL; i++) { const f = this.F[i]; if (f ? f.tq === 0 : this.side[i] === 'R') return i; } return -1; }
    for (let i = this.NL - 1; i >= 0; i--) { const f = this.F[i]; if (f ? f.tq === 1 : this.side[i] === 'L') return i; }
    return -1;
  }

  private down(side: 'l' | 'r', e: PointerEvent) {
    if (this.pop || this.busy || e.button > 0) return;
    e.stopPropagation();
    try { this.stage.setPointerCapture(e.pointerId); } catch { /* starší prohlížeč */ }
    const tg = e.target as HTMLElement;
    const ce = tg.closest<HTMLElement>('[data-c]'), ee = tg.closest<HTMLElement>('[data-e]');
    const pr = (e.currentTarget as HTMLElement).getBoundingClientRect(), bk = this.book.getBoundingClientRect();
    const free = !this.moving().length;
    this.g = {
      side, x: e.clientX, y: e.clientY, moved: false, sc: this.stage.getBoundingClientRect().width / STAGE_W, spine: bk.left,
      top: e.clientY - pr.top < pr.height / 2,
      card: ce && free ? { i: Number(ce.dataset.c), rect: ce.getBoundingClientRect() } : null,
      empty: ee && free ? Number(ee.dataset.e) : null, on: false,
    };
  }

  private hover(e: PointerEvent) {
    if (this.g || this.pop || this.moving().length || this.busy || e.pointerType === 'touch') { this.unhover(); return; }
    const k = (e.target as HTMLElement).closest?.<HTMLElement>('.bl .kc, .br .kc') ?? null;
    if (k !== this.hk) { this.unhover(); this.hk = k; if (k) k.classList.add('hv'); }
    if (!k) return;
    const r = k.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height;
    k.style.transform = `perspective(700px) rotateY(${((mx - 0.5) * 16).toFixed(2)}deg) rotateX(${((0.5 - my) * 16).toFixed(2)}deg) scale(1.045)`;
    k.style.setProperty('--mx', `${(mx * 100).toFixed(1)}%`);
  }

  private unhover() { const k = this.hk; this.hk = null; if (k) { k.classList.remove('hv'); k.style.transform = ''; } }

  private move(e: PointerEvent) {
    const g = this.g;
    if (!g) { this.hover(e); return; }
    if (!g.on) {
      if (Math.abs(e.clientX - g.x) < 5 && Math.abs(e.clientY - g.y) < 5) return;
      g.moved = true;
      const i = this.pick(g.side);
      if (i < 0) return;
      this.unhover(); g.on = true; g.i = i;
      let f = this.F[i];
      const isNew = !f;
      if (!f) f = this.F[i] = { q: this.side[i] === 'L' ? 1 : 0, v: 0, tq: this.side[i] === 'L' ? 1 : 0, k: 110, c: 22, bs: 1, ls: 1, tw: null, wait: [] };
      f.tw = null; f.drag = true; f.ls = g.top ? 1 : -1; f.bs = g.side === 'r' ? 1 : -1;
      g.a0 = Math.acos(clamp((e.clientX - g.spine) / (W * g.sc), -1, 1)); g.q0 = f.q; g.hist = [[performance.now(), f.q]];
      if (isNew) this.sync();
      this.run();
    }
    const f = this.F[g.i!];
    if (!f) return;
    const xr = clamp((e.clientX - g.spine) / (W * g.sc), -1, 1);
    const nq = clamp(g.q0! + (Math.acos(xr) - g.a0!) / Math.PI, 0, 1), now = performance.now();
    g.hist!.push([now, nq]); if (g.hist!.length > 6) g.hist!.shift(); g.nq = nq;
    if (!this.dragLoop) {
      const loop = () => {
        if (!this.g || !this.g.on || this.dead) { this.dragLoop = 0; return; }
        const gg = this.g, ff = this.F[gg.i!];
        if (ff) { ff.v = (gg.nq! - ff.q) * 0.3 * 60; ff.q += (gg.nq! - ff.q) * 0.3; this.apply(); }
        this.dragLoop = requestAnimationFrame(loop);
      };
      this.dragLoop = requestAnimationFrame(loop);
    }
  }

  private up() {
    if (this.r) { this.rUp(); return; }
    const g = this.g; this.g = null;
    if (!g) return;
    if (!g.on) {
      if (g.moved) return;
      if (g.card) this.openCard(g.card.i, g.card.rect);
      else if (g.empty !== null) { this.sel = g.empty; this.sync(true); this.o.onEmpty?.(this.cards[g.empty], g.empty); }
      else if (g.side === 'r' && this.side[0] === 'R' && !this.F[0]) this.turn(1);
      return;
    }
    const f = this.F[g.i!];
    if (!f) return;
    const h = g.hist!, vq = h.length > 1 ? (h[h.length - 1][1] - h[0][1]) / Math.max(1, h[h.length - 1][0] - h[0][0]) * 1000 : 0;
    const moved = f.q - g.q0!;
    let to = f.q > 0.5 ? 1 : 0;
    if (vq > 1.1 || (moved > 0.15 && vq > 0.35)) to = 1;
    if (vq < -1.1 || (moved < -0.15 && vq < -0.35)) to = 0;
    // dotočení po puštění: pevná délka jako u šipek, rozjezd navazuje na rychlost prstu (Hermite). Pružina dřív
    // dobíhala posledních ~10 % skoro sekundu a karty šly kliknout až po jejím úplném zastavení.
    const dist = Math.abs(to - f.q);
    if (dist < 0.002) { this.flip(g.i!, to, { dur: 1, ease: (p) => p }); return; }
    const vt = clamp(vq, -6, 6) * Math.sign(to - f.q);
    let dur = (g.i === 0 ? 1150 : 900) * Math.max(0.35, dist);
    if (vt > 0) dur = Math.max(160, Math.min(dur, (2.5 * dist / vt) * 1000));
    const m0 = clamp(vt * dur / 1000 / dist, -1, 2.5);
    this.flip(g.i!, to, { dur, ease: (p) => m0 * (p * p * p - 2 * p * p + p) + (3 * p * p - 2 * p * p * p) });
  }

  // ---------- vyjetí karty (klik na kartu v albu) ----------
  private local(rect: DOMRect) {
    const sr = this.stage.getBoundingClientRect(), k = sr.width / STAGE_W;
    return { x: (rect.left - sr.left) / k, y: (rect.top - sr.top) / k, w: rect.width / k, h: rect.height / k };
  }

  private openCard(i: number, rect: DOMRect) {
    this.unhover();
    const c = this.cards[i];
    if (!c) return;
    const from = this.local(rect);
    const big = { x: 480 - 135, y: 34, w: 270, h: 377 };
    const img = c.image ?? '';
    const wrap = document.createElement('div');
    wrap.innerHTML =
      `<div class="ov"></div><div class="pc" style="left:${from.x}px;top:${from.y}px;width:${from.w}px;height:${from.h}px;transition:none">` +
      `<div class="rot"><div class="fc slv">${sleeveHTML(this.o.sleeve, img || null, c.name, true)}<span class="gs"></span><span class="glare"></span></div><div class="fc bk slv">${sleeveBackHTML(this.o.sleeve)}</div></div></div>` +
      `<div class="info"><b>${esc(c.name)}</b><span>#${esc(c.number)}${c.setName ? ' · ' + esc(c.setName) : ''}${c.owned > 1 ? ` · ${c.owned} kusy` : ''} · táhni kartou a otáčej s ní</span>` +
      `<div class="btns"><a class="bt" href="/karty/${encodeURIComponent(c.slug)}">Detail a nabídky</a>${this.o.onRemove ? '<button type="button" class="bt" data-a="rm">Odebrat kus</button>' : ''}<button type="button" class="bt" data-a="close">Zpět do alba</button></div></div>`;
    wrap.className = 'popw';
    this.stage.appendChild(wrap);
    this.pop = { i, el: wrap };
    const kc = this.root.querySelector<HTMLElement>(`.kc[data-c="${i}"]`);
    if (kc) kc.style.opacity = '0';
    this.ry = 0; this.rx = 0; this.w = 0; this.vx = 0; this.mode = 'snap'; this.tgt = 0; this.tilt = { x: 0, y: 0 };
    const pc = wrap.querySelector<HTMLElement>('.pc')!, ov = wrap.querySelector<HTMLElement>('.ov')!, info = wrap.querySelector<HTMLElement>('.info')!;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pc.style.transition = '';
      Object.assign(pc.style, { left: `${big.x}px`, top: `${big.y}px`, width: `${big.w}px`, height: `${big.h}px` });
      ov.style.opacity = '1'; info.style.opacity = '1';
    }));
    ov.addEventListener('click', () => this.closeCard());
    wrap.querySelector('[data-a="close"]')!.addEventListener('click', () => this.closeCard());
    wrap.querySelector('[data-a="rm"]')?.addEventListener('click', () => { this.closeCard(); this.o.onRemove?.(c, i); });
    const rot = wrap.querySelector<HTMLElement>('.rot')!;
    rot.addEventListener('pointerdown', (e) => this.rDown(e));
    rot.addEventListener('pointermove', (e) => this.rMove(e));
    rot.addEventListener('pointerup', () => this.rUp());
    rot.addEventListener('pointercancel', () => this.rUp());
    // náklon za kurzorem a holo proužek jako u karet v albu (jen myš, ne při tažení)
    rot.addEventListener('pointermove', (e) => this.rHover(e));
    rot.addEventListener('pointerleave', () => this.rHover(null));
  }

  closeCard() {
    const p = this.pop;
    if (!p || p.closing) return;
    p.closing = true;
    p.el.classList.add('cl');
    p.el.querySelector('.pc')?.classList.remove('hv');
    cancelAnimationFrame(this.sraf); this.sraf = 0; this.r = null;
    const rot = p.el.querySelector<HTMLElement>('.rot')!, pc = p.el.querySelector<HTMLElement>('.pc')!;
    rot.style.transition = `transform .55s ${SPRING}`;
    rot.style.transform = `rotateX(0deg) rotateY(${Math.round(this.ry / 360) * 360}deg)`;
    const kc = this.root.querySelector<HTMLElement>(`.kc[data-c="${p.i}"]`);
    if (kc) {
      const to = this.local(kc.getBoundingClientRect());
      Object.assign(pc.style, { left: `${to.x}px`, top: `${to.y}px`, width: `${to.w}px`, height: `${to.h}px` });
    }
    p.el.querySelector<HTMLElement>('.ov')!.style.opacity = '0';
    p.el.querySelector<HTMLElement>('.info')!.style.opacity = '0';
    // přesun .pc trvá 0,58 s (s mírným přejetím); po jeho doběhnutí se vracející karta prolne s kartou v kapse,
    // aby nepobliklo to, co v kapse leží přes kartu (stín hřbetu u středu alba)
    setTimeout(() => {
      // karta v kapse se ukáže hned celá (je pod vracející se kartou) a prolíná se jen horní karta; kdyby mizely
      // obě naráz, prosvítala by na chvíli světlá strana a karta by problikla
      if (kc) kc.style.opacity = '';
      // stín má už karta v kapse; kdyby ho měla i horní karta, během prolnutí by se sečetly a stín by ztmavl
      pc.querySelectorAll<HTMLElement>('.rot .fc').forEach((f) => { f.style.transition = 'none'; f.style.boxShadow = 'none'; });
      pc.style.transition = 'opacity .2s'; pc.style.opacity = '0';
    }, 590);
    setTimeout(() => { p.el.remove(); this.pop = null; this.ry = 0; this.rx = 0; this.w = 0; }, 820);
  }

  // otáčení vyjeté karty: setrvačnost, na konci pružinou dosedne na líc nebo rub
  private rot(trans = 'none') {
    const el = this.pop?.el.querySelector<HTMLElement>('.rot');
    if (!el) return;
    el.style.transition = trans;
    el.style.transform = `rotateX(${(this.rx + this.tilt.x).toFixed(2)}deg) rotateY(${(this.ry + this.tilt.y).toFixed(2)}deg)`;
    // líc a rub přepíná kód podle natočení: backface-visibility některé prohlížeče u obrázků nedodrží a ukážou zrcadlový líc
    const front = Math.cos(this.rx * Math.PI / 180) * Math.cos(this.ry * Math.PI / 180) >= 0, fc = el.children;
    (fc[0] as HTMLElement).style.visibility = front ? '' : 'hidden';
    (fc[1] as HTMLElement).style.visibility = front ? 'hidden' : 'visible';
    const g = this.pop?.el.querySelector<HTMLElement>('.glare');
    if (g) g.style.backgroundPosition = `${(50 + Math.sin(this.ry * Math.PI / 180) * 70 + this.rx).toFixed(1)}% 0`;
  }

  private spin() {
    if (this.sraf) return;
    let last = performance.now();
    const step = (now: number) => {
      if (this.dead || !this.pop) { this.sraf = 0; return; }
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      if (!this.r) {
        if (this.mode === 'free') {
          this.ry += this.w * dt; this.w *= Math.exp(-1.15 * dt);
          if (Math.abs(this.w) < 260) { this.mode = 'snap'; this.tgt = (this.w >= 0 ? Math.ceil(this.ry / 180) : Math.floor(this.ry / 180)) * 180; }
        } else {
          const k = 55, c = 2 * Math.sqrt(k) * 0.62, a = k * (this.tgt - this.ry) - c * this.w; this.w += a * dt; this.ry += this.w * dt;
        }
        const kx = 90, cx = 2 * Math.sqrt(kx) * 0.8; this.vx += (kx * (0 - this.rx) - cx * this.vx) * dt; this.rx += this.vx * dt;
      }
      this.rot();
      if (!this.r && this.mode === 'snap' && Math.abs(this.tgt - this.ry) < 0.05 && Math.abs(this.w) < 0.5 && Math.abs(this.rx) < 0.05 && Math.abs(this.vx) < 0.5) {
        this.ry = this.tgt; this.rx = 0; this.w = 0; this.vx = 0; this.rot(); this.sraf = 0; return;
      }
      this.sraf = requestAnimationFrame(step);
    };
    this.sraf = requestAnimationFrame(step);
  }

  private rHover(e: PointerEvent | null) {
    const p = this.pop;
    if (!p || p.closing) return;
    const pc = p.el.querySelector<HTMLElement>('.pc')!;
    if (!e || this.r || e.pointerType === 'touch') {
      if (this.tilt.x || this.tilt.y) { this.tilt = { x: 0, y: 0 }; if (!this.sraf) this.rot('transform .45s ease-out'); }
      pc.classList.remove('hv');
      return;
    }
    const b = pc.getBoundingClientRect(), mx = clamp((e.clientX - b.left) / b.width, 0, 1), my = clamp((e.clientY - b.top) / b.height, 0, 1);
    // rub se naklání zrcadlově, aby karta pořád „uhýbala“ od kurzoru stejně
    const back = Math.cos(this.ry * Math.PI / 180) < 0 ? -1 : 1;
    this.tilt = { x: (0.5 - my) * 16, y: (mx - 0.5) * 16 * back };
    pc.style.setProperty('--mx', `${(mx * 100).toFixed(1)}%`);
    pc.classList.toggle('hv', back > 0);
    if (!this.sraf) this.rot('transform .25s ease-out');
  }

  private rDown(e: PointerEvent) {
    if (!this.pop || this.pop.closing) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* nic */ }
    this.tilt = { x: 0, y: 0 }; this.pop.el.querySelector('.pc')?.classList.remove('hv');
    this.r = { x: e.clientX, y: e.clientY, ry: this.ry, rx: this.rx, h: [[performance.now(), this.ry]] }; this.w = 0; this.vx = 0; this.spin();
  }

  private rMove(e: PointerEvent) {
    const r = this.r;
    if (!r) return;
    e.stopPropagation();
    this.ry = r.ry + (e.clientX - r.x) * 0.6; this.rx = clamp(r.rx - (e.clientY - r.y) * 0.3, -28, 28);
    const now = performance.now(); r.h.push([now, this.ry]); while (r.h.length > 2 && now - r.h[0][0] > 90) r.h.shift();
  }

  private rUp() {
    const r = this.r;
    if (!r) return;
    this.r = null;
    const a = r.h[0], b = r.h[r.h.length - 1], dt = (b[0] - a[0]) / 1000, fresh = performance.now() - b[0] < 60;
    this.w = dt > 0.008 && fresh ? clamp((b[1] - a[1]) / dt, -2600, 2600) : 0;
    if (Math.abs(this.w) > 260) this.mode = 'free'; else { this.mode = 'snap'; this.tgt = Math.round(this.ry / 180) * 180; }
    this.spin();
  }

  // ---------- plnění z hromádky (1B, 2B, 2C, 3B) ----------
  private tween(dur: number, fn: (t: number) => void) {
    return new Promise<void>((res) => {
      const t0 = performance.now();
      const st = (now: number) => { if (this.dead) return res(); const t = Math.min(1, (now - t0) / dur); fn(t); if (t < 1) requestAnimationFrame(st); else res(); };
      requestAnimationFrame(st);
    });
  }

  /**
   * Vloží karty na místa `indices` (karty už musí mít owned > 0).
   * Přidávání (1B, 2B, 2C): celé hromádce se naráz nasadí obaly, pak karty jedna po druhé odlétají
   * a v oblouku kolem alba se ohýbají do kapes. Album listuje a zrychluje jako ve 3A.
   * Založení (founding) je deska 3B: rychlý proud karet z hromádky, list se otočí po zaplnění dvoustrany.
   * Po více kartách přijde přehled 2A.
   */
  async play(indices: number[], opts: { founding?: boolean; title?: string } = {}) {
    if (this.busy || !indices.length) return;
    this.closeCard();
    this.busy = true;
    this.unhover();
    const list = [...new Set(indices)].filter((i) => this.cards[i]).sort((a, b) => a - b);
    list.forEach((i) => this.hidden.add(i));
    this.sel = null;
    this.glow.clear();
    const alive = () => !this.dead;
    const n = list.length, single = n === 1, founding = !!opts.founding;
    const haveBefore = this.cards.filter((c, i) => c.owned > 0 && !this.hidden.has(i)).length;
    let have = haveBefore;
    this.sync(true);
    this.root.querySelector('.ind')?.classList.add('live');

    // hromádka (2B): obaly se nasadí všem kartám naráz, zatímco se otevírá deska
    const pile = this.makePile(list);
    const intro = pile.intro();
    const D = pile.origin();
    if (founding) { await sleep(500); if (!alive()) return; }

    if (this.side[0] === 'R' && !this.F[0]) {
      if (founding) {
        // hloubka listů vyjíždí postupně zpod otevírané desky (3B)
        this.edgeK = 0;
        await Promise.all([
          this.flip(0, 1, { dur: 1000, ease: easeBack }),
          this.tween(1000, (t) => { this.edgeK = clamp((t - 0.35) / 0.65, 0, 1); this.apply(); }),
        ]);
        this.edgeK = 1; this.apply();
      } else await Promise.all([this.flip(0, 1, { dur: 900, ease: easeBack }), sleep(single ? 0 : 200)]);
    }
    if (!alive()) return;

    const spreads = [...new Set(list.map((i) => this.spreadOf(i)))].sort((a, b) => a - b);
    const cos = (u: number) => 0.5 * (1 + Math.cos(Math.PI * clamp(u, 0, 1)));
    const rel = (el: Element) => this.local(el.getBoundingClientRect());
    const kc = (ci: number) => this.root.querySelector<HTMLElement>(`.kc[data-c="${ci}"]`);
    const land = (ci: number, k: number) => {
      this.hidden.delete(ci); this.glow.add(ci);
      const el = kc(ci);
      if (el) this.landCard(el, k);
      have++;
    };
    const pop = (ci: number) => {
      this.hidden.delete(ci); this.glow.add(ci);
      const el = kc(ci);
      if (el) {
        el.classList.remove('off'); el.parentElement?.classList.add('glow');
        el.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.08)', offset: 0.6 }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      }
      have++;
    };

    if (founding) {
      // 3B: plynulé zrychlení přes prvních 5 dvoustran (kosinová křivka), pak se dvoustrany plní okamžitě
      await intro;
      if (!alive()) return;
      for (let s = 0; s < spreads.length; s++) {
        if (!alive()) return;
        const tgt = spreads[s];
        if (tgt !== this.logicalT()) await this.goToRaw(tgt, 220 + 480 * cos(s / 5), 70);
        if (!alive()) return;
        const mine = list.filter((i) => this.spreadOf(i) === tgt);
        const lands: Promise<void>[] = [];
        let t = 0;
        mine.forEach((ci, idx) => {
          // zrychlení se zastaví na nejrychlejším letu (k těsně nad hranicí okamžitého vložení), karty tak létají až do konce
          const k = Math.max(0.2, cos((s + idx / Math.max(1, mine.length)) / 5)), t0 = t;
          t += 6 + 52 * k;
          lands.push(sleep(t0).then(async () => {
            if (!alive()) return;
            pile.take();
            const el = kc(ci);
            if (k > 0.18 && el) {
              await this.flyArc(ci, D, rel(el), k, idx);
              if (!alive()) return;
              this.hidden.delete(ci); this.glow.add(ci);
              const e2 = kc(ci);
              if (e2) {
                e2.classList.remove('off'); e2.parentElement?.classList.add('glow');
                e2.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.06)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
              }
              have++;
            } else { pop(ci); await sleep(60 + 140 * k); }
          }));
        });
        await Promise.all(lands);
        await sleep(30 + 200 * cos((s + 1) / 5));
      }
    } else {
      // 2B / 2C: karty odlétají z hromádky po 420 ms; po ~12 kartách se tempo zrychluje až k okamžitému vkládání
      const kOf = (x: number) => cos((x - 12) / 28);
      let seen = 0, first = true;
      for (let s = 0; s < spreads.length; s++) {
        if (!alive()) return;
        const tgt = spreads[s];
        const mine = list.filter((i) => this.spreadOf(i) === tgt);
        const k0 = kOf(seen);
        const cur = this.logicalT();
        const riffle = tgt !== cur
          ? this.goToRaw(tgt, Math.max(170, 340 * Math.max(0.5, k0)), Math.max(30, Math.min(135, 700 / Math.abs(tgt - cur))))
          : Promise.resolve();
        await Promise.all([riffle, first ? intro : null]);
        first = false;
        if (!alive()) return;
        const lands: Promise<void>[] = [];
        for (let j = 0; j < mine.length; j++) {
          const ci = mine[j], k = kOf(seen + j);
          if (k < 0.12) { pile.take(); pop(ci); await sleep(4 + 30 * k); continue; }
          const el = kc(ci);
          if (!el) { pile.take(); this.hidden.delete(ci); continue; }
          const T = rel(el);
          lands.push(pile.lift().then(() => this.flyBend(ci, D, T, k, single)).then(() => { if (alive()) land(ci, k); }));
          if (j < mine.length - 1) await sleep(420 * Math.max(0.25, k));
        }
        await Promise.all(lands);
        seen += mine.length;
        // list se otočí až po dosednutí poslední karty
        await sleep(single ? 0 : 120 + 600 * k0);
      }
    }
    if (!alive()) return;
    pile.end();
    await sleep(single ? 900 : 650);
    this.root.querySelector('.ind')?.classList.remove('live');
    this.busy = false;
    const fresh = new Set(list);
    if (!single) {
      // album se oddálí do přehledu dvoustran, kam karty přibyly (2A)
      this.book.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.9' }], { duration: 450, easing: 'ease-in', fill: 'forwards' });
      await sleep(380);
      const total = this.cards.length;
      this.sumData = {
        title: opts.title ?? (founding ? 'Album založeno' : `Přidáno ${n} ${cardsWord(n)}`),
        sub: `${this.o.name} · ${haveBefore} → ${have}${this.o.counterTotal ? ` / ${total}` : ''} · ${spreads.length} ${spreadsWord(spreads.length)}`,
        spreads,
        fresh,
      };
      this.sumPage = 0;
      this.showSum(true);
    } else {
      setTimeout(() => { if (!this.dead) { this.glow.clear(); this.root.querySelectorAll('.pk.glow').forEach((e) => e.classList.remove('glow')); } }, 3200);
    }
  }

  /** Karta v obalu pro hromádku a let (obal je samostatná vrstva, aby se dal nasunout). */
  private cardHTML(card: EngineCard) {
    const src = card.image ? thumbUrl(card.image) ?? card.image : '';
    return `<div class="asl own f-${this.o.sleeve.film}"><svg class="sv" aria-hidden="true"><use href="#s${this.o.sleeve.id}"></use></svg><span class="sb"></span>` +
      `<div class="img">${src ? `<img src="${esc(src)}" alt="" decoding="sync" draggable="false">` : ''}</div><span class="fm"></span></div>`;
  }

  /**
   * Hromádka karet vlevo od alba (2B, 2C). Ukazuje nejvýš 6 karet, každá trochu pootočená a posunutá,
   * hlubší karty vykukují nahoru. Vrchní karta se před odletem srovná.
   */
  private makePile(list: number[]) {
    const host = this.root.querySelector<HTMLElement>('.deck')!;
    const n = list.length, PV = 6;
    host.innerHTML = `<div class="cnt"><span class="cv">${n}</span><small>${n === 1 ? 'karta k vložení' : `${cardsWord(n)} k vložení`}</small></div>`;
    const cv = host.querySelector<HTMLElement>('.cv')!, sm = host.querySelector<HTMLElement>('.cnt small')!;
    const rnd = (i: number, s: number) => { const r = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return r - Math.floor(r); };
    const pose = (i: number, d: number) => d === 0 && i === 0
      ? 'translate(0px,0px) rotate(-1.5deg)'
      : `translate(${(rnd(i, 1) * 7 - 3.5 - d * 0.5).toFixed(1)}px,${(rnd(i, 2) * 6 - 3 - d * 1.3).toFixed(1)}px) rotate(${((rnd(i, 3) - 0.5) * 7).toFixed(1)}deg)`;
    const els: Array<{ el: HTMLElement; i: number }> = [];
    let next = 0, left = n;
    const add = (anim: boolean) => {
      if (next >= n) return;
      const i = next++, el = document.createElement('div');
      el.className = 'fly pl';
      el.innerHTML = `<div class="fz" style="transform:scale(${S_PILE})"><div class="fsq"><div class="fsp">${this.cardHTML(this.cards[list[i]])}<span class="sring"></span></div></div></div>`;
      host.insertBefore(el, host.firstChild);
      els.push({ el, i });
      el.style.transform = pose(i, els.length - 1);
      if (anim) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'backwards' });
    };
    for (let j = 0; j < Math.min(PV, n); j++) add(false);
    const restack = () => els.forEach((e, d) => { e.el.style.zIndex = String(10 - d); e.el.style.transition = 'transform .32s cubic-bezier(.3,0,.2,1)'; e.el.style.transform = pose(e.i, d); });
    restack();
    const dec = () => { left = Math.max(0, left - 1); cv.textContent = String(left); sm.textContent = left === 1 ? 'karta k vložení' : `${cardsWord(left)} k vložení`; };
    const shift = () => { const e = els.shift(); if (e) e.el.remove(); add(true); restack(); };
    return {
      // klidová poloha hromádky: v tu chvíli ještě vyjíždí zleva (translateX), a let by pak začal o kus vedle karty
      origin: () => {
        if (host.offsetParent === this.stage) return { x: host.offsetLeft, y: host.offsetTop };
        const r = this.local(host.getBoundingClientRect()); return { x: r.x, y: r.y };
      },
      /** Obaly se nasunou celé hromádce naráz: karty se roztočí, shora se nasune obal, cvakne a zajiskří (2B). */
      intro: async () => {
        host.classList.add('on');
        els.forEach((e, d) => {
          const q = (c: string) => [...e.el.querySelectorAll<HTMLElement>(c)];
          const dl = d * 60;
          q('.fsp').forEach((x) => x.animate([
            { opacity: 0, transform: 'rotateY(-540deg) scale(.4)' },
            { opacity: 1, transform: 'rotateY(-500deg) scale(.45)', offset: 0.12 },
            { opacity: 1, transform: 'rotateY(0) scale(1)' },
          ], { duration: 790, delay: dl, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
          const slv = [
            { opacity: 0, transform: 'translateY(-78%) scale(1.22,.62)', offset: 0 },
            { opacity: 1, offset: 0.25 },
            { opacity: 1, transform: 'translateY(3%) scale(.97,1.03)', offset: 0.52 },
            { opacity: 1, transform: 'translateY(-1%) scale(1.01,.99)', offset: 0.76 },
            { opacity: 1, transform: 'translateY(0) scale(1,1)' },
          ];
          q('.sv,.sb,.fm').forEach((x) => x.animate(slv, { duration: 1150, delay: 430 + dl * 1.3, easing: 'cubic-bezier(.22,.9,.3,1)', fill: 'backwards' }));
          q('.asl').forEach((x) => x.animate([
            { transform: 'none', offset: 0 },
            { transform: 'scale(.93) rotateX(12deg)', offset: 0.18 },
            { transform: 'scale(1.03) rotateX(-5deg) rotateY(4deg)', offset: 0.5 },
            { transform: 'scale(.995) rotateX(1.5deg) rotateY(-1.5deg)', offset: 0.8 },
            { transform: 'none' },
          ], { duration: 620, delay: 980 + dl * 1.3, easing: 'ease-out' }));
        });
        const top = els[0]?.el;
        if (top) {
          top.querySelector<HTMLElement>('.sring')!.animate([{ opacity: 0, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1)', offset: 0.1 }, { opacity: 0, transform: 'scale(1.14)' }], { duration: 640, delay: 1000, fill: 'both' });
          const fsp = top.querySelector<HTMLElement>('.fsp')!;
          for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2 + 0.4, s = document.createElement('i');
            s.className = 'spk'; s.textContent = '✦';
            s.style.setProperty('--dx', `${(Math.cos(a) * 95).toFixed(0)}px`); s.style.setProperty('--dy', `${(Math.sin(a) * 120).toFixed(0)}px`);
            fsp.appendChild(s);
            s.animate([
              { opacity: 0, transform: 'translate(0,0) scale(0) rotate(0)' },
              { opacity: 1, transform: 'translate(calc(var(--dx)*.35),calc(var(--dy)*.35)) scale(1.5) rotate(60deg)', offset: 0.12 },
              { opacity: 1, transform: 'translate(calc(var(--dx)*.8),calc(var(--dy)*.8)) scale(1) rotate(170deg)', offset: 0.7 },
              { opacity: 0, transform: 'translate(var(--dx),var(--dy)) scale(.2) rotate(260deg)' },
            ], { duration: 680, delay: 1030 + i * 12, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' }).onfinish = () => s.remove();
          }
        }
        await sleep(1650);
      },
      /** Vrchní karta se srovná a odletí (aStk). */
      lift: async () => {
        const e = els[0];
        dec();
        if (!e) return;
        e.el.style.transition = 'transform .3s cubic-bezier(.3,0,.2,1)';
        e.el.style.transform = 'translate(0px,0px) rotate(0deg)';
        await sleep(300);
        shift();
      },
      /** Karta odejde bez zvednutí (rychlé vkládání). */
      take: () => { dec(); shift(); },
      end: () => { host.classList.remove('on'); setTimeout(() => { if (!host.classList.contains('on')) host.innerHTML = ''; }, 500); },
    };
  }

  /**
   * Let z hromádky do kapsy (1B, 2B): smyčka kolem alba a karta se v letu ohýbá jako pružný karton.
   * Karta je rozřezaná na vodorovné proužky; každý je pootočený o kousek víc než předchozí podle toho,
   * jak rychle se karta otáčí. Při zrychleném vkládání (k < 0.5) krátký oblouk bez ohybu.
   */
  private flyBend(ci: number, D: { x: number; y: number }, T: { x: number; y: number }, k: number, single: boolean) {
    const N = 26, CW = 92, CH = 126, h = CH / N;
    const dx = T.x - D.x, dy = T.y - D.y;
    const loop = k >= 0.5;
    const dur = loop ? (single ? 1430 : 1330) * (0.55 + 0.45 * k) : 300 + 520 * k;
    const f = document.createElement('div');
    f.className = 'flyb';
    const html = this.cardHTML(this.cards[ci]);
    let h2 = '';
    for (let j = 0; j < N; j++) {
      // proužky se kousek překrývají, aby na vnější straně ohybu nevznikaly mezery
      const top = Math.max(0, j * h - 0.4), bot = Math.max(0, CH - (j + 1) * h - h * 0.8);
      h2 += `<div class="st" style="clip-path:inset(${top.toFixed(2)}px -2px ${bot.toFixed(2)}px -2px)">${html}</div>`;
    }
    f.innerHTML = h2;
    this.stage.appendChild(f);
    const st = [...f.querySelectorAll<HTMLElement>('.st')];
    // dráha: smyčka z desky 1B, nebo krátký oblouk
    const lift = -60 - Math.abs(dx) * 0.08, rotEnd = (T.x > 480 ? 1 : -1) * 14;
    const path = (u: number): [number, number, number, number, number] => {
      if (!loop) {
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        const ar = Math.sin(Math.PI * e);
        return [D.x + dx * e, D.y + dy * e + lift * ar, -6 * (1 - e) + rotEnd * ar, 1, 1];
      }
      let a = 0;
      while (a < FLIGHT.length - 2 && FLIGHT[a + 1][0] < u) a++;
      const A = FLIGHT[a], B = FLIGHT[a + 1], v = clamp((u - A[0]) / (B[0] - A[0]), 0, 1);
      const L = (i: number) => A[i] + (B[i] - A[i]) * v;
      return [D.x + dx * u + L(1), D.y + dy * u + L(2), L(3), L(4), L(5)];
    };
    // velikost: z hromádky se zvedne, do kapsy se zmenší (aRot)
    const scaleAt = (u: number) => u < 0.18 ? S_PILE + (S_LIFT - S_PILE) * smooth(u / 0.18) : S_LIFT + (1 - S_LIFT) * outCubic((u - 0.18) / 0.82);
    const BMAX = 80 / (N - 1);
    let beta = 0, lastR = path(0)[2], lastT = performance.now();
    const t0 = lastT;
    const draw = (now: number) => {
      const u = clamp((now - t0) / dur, 0, 1);
      const [x0, y, r, sx, sy] = path(u);
      // na začátku smyčky karta nesmí vyletět za levý okraj jeviště (hromádka je těsně u něj)
      const x = Math.max(x0, CW * (scaleAt(u) - 1) / 2 - 14);
      const dt = Math.max(1, now - lastT);
      const w = (r - lastR) / dt * 1000;
      lastR = r; lastT = now;
      const want = loop && u < 0.8 ? -clamp(w / 260, -1, 1) * BMAX : 0;
      beta += (want - beta) * Math.min(1, dt / 70);
      const sc = scaleAt(u);
      const base = `translate(${(x + CW / 2).toFixed(2)}px,${(y + CH / 2).toFixed(2)}px) rotate(${r.toFixed(2)}deg) scale(${(sc * sx).toFixed(4)},${(sc * sy).toFixed(4)})`;
      // řetěz proužků od středu karty nahoru a dolů
      const pos: Array<[number, number, number]> = new Array(N);
      const mid = N / 2;
      let px = 0, py = 0;
      for (let j = mid; j < N; j++) {
        const ph = (j - (N - 1) / 2) * beta * Math.PI / 180, s = Math.sin(ph), c = Math.cos(ph);
        pos[j] = [px - s * h / 2, py + c * h / 2, ph];
        px -= s * h; py += c * h;
      }
      px = 0; py = 0;
      for (let j = mid - 1; j >= 0; j--) {
        const ph = (j - (N - 1) / 2) * beta * Math.PI / 180, s = Math.sin(ph), c = Math.cos(ph);
        pos[j] = [px + s * h / 2, py - c * h / 2, ph];
        px += s * h; py -= c * h;
      }
      for (let j = 0; j < N; j++) {
        const [cx, cy, ph] = pos[j];
        st[j].style.transform = `${base} translate(${cx.toFixed(2)}px,${cy.toFixed(2)}px) rotate(${(ph * 180 / Math.PI).toFixed(2)}deg) translate(${-CW / 2}px,${(-(j + 0.5) * h).toFixed(2)}px)`;
      }
      return u;
    };
    draw(t0);
    // rozmazaná stopa za kartou (aGhost)
    let ghost: HTMLElement | null = null;
    if (loop) {
      ghost = document.createElement('div');
      ghost.className = 'fly ghost';
      ghost.innerHTML = '<div class="fz"><div class="gfill"></div></div>';
      this.stage.insertBefore(ghost, f);
      const frames = FLIGHT.map(([u, ox, oy, r, sx, sy]) => ({ offset: u, transform: `translate(${(D.x + dx * u + ox).toFixed(1)}px,${(D.y + dy * u + oy).toFixed(1)}px) rotate(${r}deg) scale(${sx},${sy})` }));
      const gz = ghost.firstElementChild as HTMLElement;
      gz.animate([{ transform: `scale(${S_PILE})` }, { transform: `scale(${S_LIFT})`, offset: 0.18 }, { transform: 'scale(1)' }], { duration: dur, delay: 70, fill: 'both' });
      ghost.animate(frames, { duration: dur, delay: 70, easing: 'linear', fill: 'both' });
      ghost.animate([{ opacity: 0 }, { opacity: 0.3, offset: 0.08 }, { opacity: 0.25, offset: 0.7 }, { opacity: 0 }], { duration: dur, delay: 70, fill: 'both', composite: 'replace' });
    }
    return new Promise<void>((res) => {
      const step = (now: number) => {
        if (this.dead) { f.remove(); ghost?.remove(); return res(); }
        if (draw(now) >= 1) { f.remove(); ghost?.remove(); return res(); }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** Let při založení (3B): krátký oblouk z hromádky, karty jdou rychle za sebou. */
  private flyArc(ci: number, D: { x: number; y: number }, T: { x: number; y: number }, k: number, idx: number) {
    const f = document.createElement('div');
    f.className = 'fly arc';
    f.innerHTML = `<div class="fz"><div class="fsq"><div class="fsp">${this.cardHTML(this.cards[ci])}</div></div></div>`;
    this.stage.appendChild(f);
    const dur = 220 + 420 * k;
    const dx = T.x - D.x, dy = T.y - D.y, lift = -60 - Math.abs(dx) * 0.08, rot = (idx % 2 ? 1 : -1) * (8 + (idx % 5) * 3);
    const an = f.animate([
      { transform: `translate(${D.x}px,${D.y}px) rotate(-6deg) scale(${S_PILE})` },
      { transform: `translate(${D.x + dx * 0.55}px,${D.y + dy * 0.55 + lift}px) rotate(${rot}deg) scale(${(S_PILE + 1) / 2})`, offset: 0.55 },
      { transform: `translate(${T.x}px,${T.y}px) rotate(0deg) scale(1)` },
    ], { duration: dur, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
    return new Promise<void>((res) => { an.onfinish = () => { f.remove(); res(); }; an.oncancel = () => { f.remove(); res(); }; });
  }

  /** Dopad do kapsy (1B): odskok, zmáčknutí, záře kapsy, kruhy, lesk; stejné pro jednu i více karet. */
  private landCard(kc: HTMLElement, k: number) {
    kc.classList.remove('off');
    const pk = kc.parentElement as HTMLElement | null;
    kc.animate([
      { transform: 'translateY(0) scale(1.12,.84)', offset: 0 },
      { transform: 'translateY(11px) scale(1.04,.96)', offset: 0.2 },
      { transform: 'translateY(-4px) scale(.99,1.01)', offset: 0.55 },
      { transform: 'translateY(1.5px) scale(1,1)', offset: 0.8 },
      { transform: 'translateY(0) scale(1,1)' },
    ], { duration: 300 + 500 * k, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    if (!pk) return;
    pk.classList.add('glow');
    if (k < 0.35) return;
    pk.animate([
      { boxShadow: 'inset 0 0 0 1px var(--pocket),0 0 0 0 rgba(124,242,200,0)' },
      { boxShadow: 'inset 0 0 0 1px var(--pocket),0 0 0 4px #7cf2c8,0 0 100px rgba(124,242,200,1),inset 0 0 40px rgba(124,242,200,.6)', offset: 0.07 },
      { boxShadow: 'inset 0 0 0 1px var(--pocket),0 0 0 2px rgba(124,242,200,.45),0 0 16px rgba(124,242,200,.25)', offset: 0.55 },
      { boxShadow: 'inset 0 0 0 1px var(--pocket),0 0 0 2px rgba(124,242,200,.75),0 0 18px rgba(124,242,200,.45)' },
    ], { duration: 3000 * Math.max(0.4, k), easing: 'ease-out' });
    const fx = document.createElement('span');
    fx.className = 'lfx';
    fx.innerHTML = '<i class="lr"></i><i class="lr r2"></i><i class="sw"></i>';
    // kruhy leží nad oběma stránkami: v kapse u hřbetu by je jinak ořízla stránka a zakryla druhá strana dvoustrany
    const r = this.local(pk.getBoundingClientRect());
    Object.assign(fx.style, { inset: 'auto', left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, zIndex: '44' });
    this.stage.appendChild(fx);
    const [r1, r2, sw] = [...fx.querySelectorAll<HTMLElement>('i')];
    r1.animate([{ opacity: 1, transform: 'scale(.85)' }, { opacity: 0, transform: 'scale(2.7)' }], { duration: 1150, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });
    r2.animate([{ opacity: 0.7, transform: 'scale(.85)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 1230, delay: 170, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
    sw.animate([{ opacity: 0, backgroundPosition: '160% 0' }, { opacity: 1, offset: 0.1 }, { opacity: 0, backgroundPosition: '-60% 0' }], { duration: 1200, delay: 100, easing: 'cubic-bezier(.3,0,.3,1)', fill: 'both' });
    setTimeout(() => fx.remove(), 1600);
  }

  // ---------- přehled dvoustran (2A) ----------
  private showSum(anim: boolean) {
    const sd = this.sumData;
    if (!sd) return;
    const sum = this.root.querySelector<HTMLElement>('.sum')!;
    const per = 6, P = Math.ceil(sd.spreads.length / per);
    const list = sd.spreads.slice(this.sumPage * per, (this.sumPage + 1) * per);
    const m = list.length;
    // rozložení: 1 velká, 2 vedle sebe, 3 = 2+1, 4 = 2×2, 5 = 3+2, 6 = 3×2
    const rows = m <= 2 ? [m] : m === 3 ? [2, 1] : m === 4 ? [2, 2] : m === 5 ? [3, 2] : [3, 3];
    const AW = 840, AH = 380, gapX = 34, gapY = 22, lab = 22;
    const cols = Math.max(...rows), R = rows.length;
    const sw = Math.min((AW - (cols - 1) * gapX) / cols, ((AH - (R - 1) * gapY) / R - lab) * 1.5, 520);
    const sh = sw / 1.5;
    const totalH = R * (sh + lab) + (R - 1) * gapY;
    const pw = sw / 2, pad = pw * 0.06, gap = pw * 0.03;
    const mini = (p: number) => {
      if (p < 1 || p > 2 * (this.NL - 1)) return `<div class="mpg ins" style="width:${pw}px;height:${sh}px"></div>`;
      let h = `<div class="mpg" style="width:${pw}px;height:${sh}px;padding:${pad}px;gap:${gap}px">`;
      for (let k = 0; k < 9; k++) {
        const idx = (p - 1) * 9 + k, c = p <= this.NP ? this.cards[idx] : undefined;
        if (c && c.owned > 0) {
          const src = c.image ? thumbUrl(c.image) ?? c.image : '';
          h += `<span class="mk ${sd.fresh.has(idx) ? 'n' : 'f'}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ''}</span>`;
        } else h += '<span class="mk"></span>';
      }
      return h + '</div>';
    };
    let g = '', k = 0;
    rows.forEach((cnt, r) => {
      const rowW = cnt * sw + (cnt - 1) * gapX, x0 = (AW - rowW) / 2, y = (AH - totalH) / 2 + r * (sh + lab + gapY);
      for (let j = 0; j < cnt && k < m; j++, k++) {
        const t = list[k], a = 2 * t - 2, b = 2 * t - 1;
        const label = a < 1 ? 'Strana 1' : b > this.NP ? `Strana ${a}` : `Strany ${a}–${b}`;
        g += `<div class="ms" data-t="${t}" style="left:${x0 + j * (sw + gapX)}px;top:${y}px;width:${sw}px;animation-delay:${anim ? 120 + k * 90 : 0}ms">` +
          `<div class="msp">${mini(a)}${mini(b)}</div><b>${label}</b></div>`;
      }
    });
    const nav = P > 1
      ? `<div class="spg"><button type="button" class="pv" aria-label="Předchozí"${this.sumPage === 0 ? ' disabled' : ''}>‹</button><span>${Array.from({ length: P }, (_, i) => `<i class="${i === this.sumPage ? 'on' : ''}"></i>`).join('')}</span><button type="button" class="nx" aria-label="Další"${this.sumPage === P - 1 ? ' disabled' : ''}>›</button></div>`
      : '';
    sum.innerHTML = `<h2>${esc(sd.title)}</h2><div class="sub">${esc(sd.sub)}</div><div class="sgr">${g}</div>${nav}<button type="button" class="bt pri done">Prohlédnout album</button>`;
    sum.classList.add('on');
    if (anim) {
      // deska 2B: až jsou dvoustrany vidět, ostatní karty ztmavnou a nové se rozsvítí jedna po druhé
      const t0 = 120 + (m - 1) * 90 + 500;
      sum.querySelectorAll<HTMLElement>('.mk.f').forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0.42 }], { duration: 500, delay: t0 - 50, easing: 'ease-out', fill: 'both' }));
      const fresh = [...sum.querySelectorAll<HTMLElement>('.mk.n')];
      const step = Math.min(130, 2400 / Math.max(1, fresh.length));
      fresh.forEach((el, j) => el.animate([
        { boxShadow: '0 0 0 0 rgba(124,242,200,0)', transform: 'none' },
        { boxShadow: '0 0 0 2px #7cf2c8,0 0 22px rgba(124,242,200,.9)', transform: 'translateY(-4px) scale(1.06)', offset: 0.23 },
        { boxShadow: '0 0 0 1.5px rgba(124,242,200,.85),0 0 10px rgba(124,242,200,.45)', transform: 'translateY(-2px) scale(1.03)' },
      ], { duration: 700, delay: t0 + j * step, easing: 'ease-out', fill: 'both' }));
    }
    sum.querySelector<HTMLElement>('.spg .pv')?.addEventListener('click', () => { this.sumPage--; this.showSum(true); });
    sum.querySelector<HTMLElement>('.spg .nx')?.addEventListener('click', () => { this.sumPage++; this.showSum(true); });
    sum.querySelectorAll<HTMLElement>('.ms').forEach((el) => el.addEventListener('click', () => this.closeSum(Number(el.dataset.t))));
    sum.querySelector<HTMLElement>('.done')!.addEventListener('click', () => this.closeSum(null));
  }

  private closeSum(t: number | null) {
    const sum = this.root.querySelector<HTMLElement>('.sum')!;
    sum.classList.remove('on');
    this.sumData = null;
    this.glow.clear();
    this.book.getAnimations().forEach((a) => a.cancel());
    this.book.animate([{ opacity: 0, transform: `${this.book.style.transform} scale(.96)` }, { opacity: 1, transform: this.book.style.transform }], { duration: 380, easing: 'ease-out' });
    if (t !== null && t !== this.logicalT()) {
      // otevři vybranou dvoustranu bez listování přes celé album
      this.F = {};
      for (let i = 0; i < this.NL; i++) this.side[i] = i < t ? 'L' : 'R';
      this.sync(true);
    } else this.sync(true);
  }
}
