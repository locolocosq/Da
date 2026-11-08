'use strict';
(() => {
  // ---------------------------------------------------------------------------
  // Welt & Konstanten (virtuelle Einheiten, werden auf den Bildschirm skaliert)
  // ---------------------------------------------------------------------------
  // Fast quadratischer Kasten mit abgeschrägten unteren Ecken und Seiten-Bumpern
  const W = 400, H = 450;
  const BEVEL = 34;
  const BUMPERS = [{ x: -8, y: 205, r: 30 }, { x: W + 8, y: 205, r: 30 }];
  const DANGER_Y = 92;                // rote Linie
  const DANGER_TIME = 5.0;            // Sekunden über der Linie bis Game Over
  // aus der Weltrangliste entfernte Einträge (nur Einträge bis zu diesem Zeitpunkt; neue Ergebnisse zählen wieder)
  const REMOVED = [{ name: 'bilal', before: 1794180844455 }];
  const SNIPER_AT = [150000, 500000, 15000000];  // bei diesen Punktständen gibt es je einen Sniper
  const SHAKE_PULSES = [0, 0.85, 1.7]; // drei kräftige Stöße (Zeitpunkte in s)
  const SHAKE_TIME = 2.6;             // Dauer Schütteln (s)
  const shakeAcc = { x: 0, y: 0, on: false };  // on: beim Schütteln kein Abfedern    // Zusatz-Beschleunigung beim Schütteln
  const CANNON = { x: W / 2, y: 36 };
  const GRAVITY = 1300;
  const STEP = 1 / 60;
  const SUBSTEPS = 4;
  const HS = STEP / SUBSTEPS;
  const ITER = 3;
  const DAMP = 0.9990;
  const SHOT_SPEED = 720;
  const COOLDOWN = 0.45;
  const INNER_DAMP = 0.95;           // innere Dämpfung: schluckt den Aufprall (kaum Hüpfen)
  const PRESSURE = 0.3;             // wie stark das Volumen zurückgedrückt wird
  const MERGE_TIME = 0.001;         // gleiche Blobs verschmelzen sofort bei Berührung
  const GROW_TIME = 0.8;            // so lange bläst sich der neue Blob auf
  const GHOST_TIME = 0.45;          // so lange schrumpfen die alten Blobs zusammen
  const UP_DAMP = 0.6;               // Rückprall nach oben bei Kontakt
  const SPIN_DAMP = 0.08;            // bremst Drehen
  const VMAX = 1400 * HS;             // Tempolimit pro Teilschritt (verhindert Explosionen)

  // Zahlen-Blobs: 2, 4, 8 … gleiche Zahlen verschmelzen zur doppelten
  const PALETTE = [
    '#ffd93d', '#ff9f43', '#4be3b0', '#4d8df7', '#9b5cff', '#ff5fa2', '#ff7b3a',
    '#d8f24a', '#6ef06a', '#3fd0ff', '#ff4d6d', '#c84bff', '#ffffff', '#ffb3f0',
  ];
  const LEVELS = PALETTE.map((c, i) => ({ v: Math.pow(2, i + 1), r: Math.round(i <= 6 ? 25 * Math.pow(1.15, i) : 58 * Math.pow(1.04, i - 6)), c }));
  const MAX_LEVEL = LEVELS.length - 1;
  const SPAWN_WEIGHTS = [30, 26, 20, 14, 10];
  const NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31]; // Pentatonik

  const CFG = window.BLOBBO_CONFIG || {};
  const STORE_KEY = window.BlobboStore && window.BlobboStore.parse(CFG.leaderboard) ? CFG.leaderboard : '';
  const ONLINE_URL = STORE_KEY || (CFG.firebaseUrl || '').replace(/\/+$/, '');

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } },
  };

  // ---------------------------------------------------------------------------
  // Audio (komplett synthetisiert mit WebAudio – keine Dateien nötig)
  // ---------------------------------------------------------------------------
  const Sound = {
    ctx: null, sfxOn: store.get('blobbo_sfx', true), musOn: store.get('blobbo_music', true),
    lastSquish: 0,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
      this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxOn ? 1 : 0; this.sfx.connect(this.master);
      this.mus = ctx.createGain(); this.mus.gain.value = this.musOn ? 0.55 : 0; this.mus.connect(this.master);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startMusic();
    },
    setSfx(on) { this.sfxOn = on; store.set('blobbo_sfx', on); if (this.sfx) this.sfx.gain.value = on ? 1 : 0; },
    setMusic(on) { this.musOn = on; store.set('blobbo_music', on); if (this.mus) this.mus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.1); },
    tone(freq, dur, type, vol, slide, delay = 0, dest) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime + delay;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || this.sfx);
      o.start(t); o.stop(t + dur + 0.05);
    },
    noiseBurst(dur, vol, freq, type = 'bandpass', delay = 0, dest) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime + delay;
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest || this.sfx);
      s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    },
    shoot() {
      this.tone(220, 0.16, 'square', 0.05, 660);
      this.tone(440, 0.12, 'sine', 0.16, 1100);
      this.noiseBurst(0.08, 0.08, 2500);
    },
    squish(v) {
      const now = performance.now();
      if (now - this.lastSquish < 45) return;
      this.lastSquish = now;
      v = clamp(v, 0.05, 1);
      this.tone(rand(150, 230), 0.16, 'sine', 0.28 * v, 60);
      this.noiseBurst(0.1, 0.12 * v, rand(500, 900));
    },
    merge(level, combo) {
      const f = 262 * Math.pow(2, NOTES[Math.min(level, NOTES.length - 1)] / 12) * (combo > 1 ? 1.06 : 1);
      this.tone(f * 0.5, 0.18, 'sine', 0.3, f * 1.1);          // Blubb
      this.tone(f, 0.3, 'triangle', 0.18, null, 0.05);
      this.tone(f * 1.5, 0.35, 'sine', 0.1, null, 0.1);
      if (combo > 1) this.tone(f * 2, 0.25, 'sine', 0.08, null, 0.16);
      this.noiseBurst(0.15, 0.06, 1500);
    },
    mega() {
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(392 * Math.pow(2, n / 12), 0.4, 'triangle', 0.15, null, i * 0.07));
    },
    snipe() {
      this.tone(1400, 0.08, 'square', 0.06, 300);
      this.noiseBurst(0.25, 0.25, 1200);
      this.tone(120, 0.3, 'sine', 0.3, 40, 0.03);
    },
    undo() { [12, 7, 4, 0].forEach((n, i) => this.tone(523 * Math.pow(2, n / 12), 0.12, 'triangle', 0.12, null, i * 0.05)); },
    rumble() {
      this.tone(70, 0.35, 'sine', 0.35, 40); this.noiseBurst(0.3, 0.18, 400, 'lowpass'); this.tone(140, 0.15, 'square', 0.04, 70);
    },
    warn() { this.tone(880, 0.09, 'square', 0.05); this.tone(660, 0.09, 'square', 0.04, null, 0.1); },
    over() { [7, 4, 0, -5].forEach((n, i) => this.tone(330 * Math.pow(2, n / 12), 0.35, 'triangle', 0.18, null, i * 0.16)); },
    click() { this.tone(660, 0.06, 'sine', 0.12, 880); },
    // Hintergrundmusik: kleiner Loop, im Takt geplant
    startMusic() {
      const ctx = this.ctx;
      const chords = [[261.63, 'M'], [220, 'm'], [174.61, 'M'], [196, 'M']];
      const bpm = 100, eighth = 60 / bpm / 2;
      let step = 0, next = ctx.currentTime + 0.1;
      const melody = [12, null, 16, 14, 12, null, 9, null, 7, null, 9, 12, null, 14, null, null];
      setInterval(() => {
        if (ctx.state !== 'running') return;
        while (next < ctx.currentTime + 0.25) {
          const bar = Math.floor(step / 8) % 4, s = step % 8;
          const [root, q] = chords[bar];
          const iv = q === 'M' ? [0, 4, 7, 12] : [0, 3, 7, 12];
          const delay = next - ctx.currentTime;
          const arp = root * Math.pow(2, iv[[0, 1, 2, 3, 2, 1, 2, 3][s]] / 12);
          this.tone(arp, eighth * 0.9, 'triangle', 0.045, null, delay, this.mus);
          if (s === 0 || s === 4) this.tone(root / 2, eighth * 1.8, 'sine', 0.14, null, delay, this.mus);
          if (s % 2 === 1) this.noiseBurst(0.04, 0.025, 7000, 'highpass', delay, this.mus);
          const mi = melody[step % 16];
          if (mi !== null && Math.floor(step / 16) % 2 === 1) this.tone(root * Math.pow(2, mi / 12), eighth * 1.6, 'sine', 0.035, null, delay, this.mus);
          next += eighth; step++;
        }
      }, 60);
    },
  };

  const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* egal */ } };

  // ---------------------------------------------------------------------------
  // Soft-Body-Blob: Ring aus Massepunkten (Verlet) + Shape-Matching
  // ---------------------------------------------------------------------------
  let blobIds = 1;
  class Blob {
    constructor(x, y, level, scale = 1) {
      this.id = blobIds++;
      this.level = level;
      const L = LEVELS[level];
      this.R = L.r;
      const n = this.n = Math.min(36, 22 + level);
      this.x = new Float32Array(n); this.y = new Float32Array(n);
      this.px = new Float32Array(n); this.py = new Float32Array(n);
      this.rx = new Float32Array(n); this.ry = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.rx[i] = Math.cos(a) * this.R; this.ry[i] = Math.sin(a) * this.R;
        this.x[i] = this.px[i] = x + this.rx[i] * scale;
        this.y[i] = this.py[i] = y + this.ry[i] * scale;
      }
      // Fläche des Ring-Polygons (positiv bei dieser Punktreihenfolge im y-nach-unten-System)
      this.area0 = 0.5 * n * this.R * this.R * Math.sin((2 * Math.PI) / n);
      this.edge0 = 2 * this.R * Math.sin(Math.PI / n);
      this.invMass = n / (this.R * this.R);
      this.base = { R: this.R, area0: this.area0, edge0: this.edge0, rx: this.rx.slice(), ry: this.ry.slice() };
      this.growT = -1;
      this.k = 0.002;                  // kaum Formerhalt -> Wasserballon statt Gummi
      this.cx = x; this.cy = y; this.ang = 0;
      this.age = 0; this.dead = false;
      this.lastVx = 0; this.lastVy = 0; this.prevCx = x; this.prevCy = y;
      this.flash = 0;
      this.stored = 0;
      this.soft = clamp(Math.pow(40 / this.R, 4.5), 0.04, 1);   // große Blobs lassen sich unter Last stärker eindrücken
      this.glow = 0;
      this.sortAcc = 0;               // beim Schütteln: klein steigt auf, groß sinkt ab                 // Punkte, die in diesem Blob stecken (für den Sniper)
    }
    // Größe stufenlos ändern (für das Aufblasen nach dem Verschmelzen)
    setScale(k) {
      const B = this.base;
      this.R = B.R * k; this.area0 = B.area0 * k * k; this.edge0 = B.edge0 * k;
      for (let i = 0; i < this.n; i++) { this.rx[i] = B.rx[i] * k; this.ry[i] = B.ry[i] * k; }
    }
    setVel(vx, vy) {
      for (let i = 0; i < this.n; i++) { this.px[i] = this.x[i] - vx * HS; this.py[i] = this.y[i] - vy * HS; }
    }
    centroid() {
      let sx = 0, sy = 0;
      for (let i = 0; i < this.n; i++) { sx += this.x[i]; sy += this.y[i]; }
      this.cx = sx / this.n; this.cy = sy / this.n;
    }
    integrate() {
      const g = GRAVITY * HS * HS, n = this.n, x = this.x, y = this.y;
      // Schwerpunkt + mittlere Geschwindigkeit
      let cx = 0, cy = 0, mx = 0, my = 0;
      for (let i = 0; i < n; i++) { cx += x[i]; cy += y[i]; mx += x[i] - this.px[i]; my += y[i] - this.py[i]; }
      cx /= n; cy /= n; mx /= n; my /= n;
      // Aufprall schlucken: beim Berühren federt der Ballon kaum nach oben zurück
      if (this.touch && my < 0 && !shakeAcc.on) {
        const nmy = my * UP_DAMP;
        for (let i = 0; i < n; i++) this.py[i] += my - nmy;
        my = nmy;
      }
      this.touch = false;
      // Drehgeschwindigkeit (Wasserballons drehen sich kaum)
      let L = 0, I = 0;
      for (let i = 0; i < n; i++) {
        const rx = x[i] - cx, ry = y[i] - cy;
        L += rx * (y[i] - this.py[i] - my) - ry * (x[i] - this.px[i] - mx);
        I += rx * rx + ry * ry;
      }
      const w = I > 0 ? (L / I) * SPIN_DAMP : 0;
      for (let i = 0; i < n; i++) {
        const rx = x[i] - cx, ry = y[i] - cy;
        let vx = x[i] - this.px[i] + w * ry, vy = y[i] - this.py[i] - w * rx;
        vx = (mx + (vx - mx) * INNER_DAMP) * DAMP;
        vy = (my + (vy - my) * INNER_DAMP) * DAMP;
        const v2 = vx * vx + vy * vy;
        if (v2 > VMAX * VMAX) { const f = VMAX / Math.sqrt(v2); vx *= f; vy *= f; }
        this.px[i] = x[i]; this.py[i] = y[i];
        x[i] += vx + shakeAcc.x * HS * HS; y[i] += vy + g + (shakeAcc.y + this.sortAcc) * HS * HS;
      }
    }
    // Druck: Fläche bleibt erhalten (wie ein Wasserballon)
    pressure() {
      const n = this.n, x = this.x, y = this.y;
      let A = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) A += x[j] * y[i] - x[i] * y[j];
      A *= 0.5;
      const C = this.area0 - A;
      let sum = 0;
      const gx = this._gx || (this._gx = new Float32Array(n)), gy = this._gy || (this._gy = new Float32Array(n));
      for (let i = 0; i < n; i++) {
        const p = i === 0 ? n - 1 : i - 1, q = i === n - 1 ? 0 : i + 1;
        gx[i] = 0.5 * (y[q] - y[p]); gy[i] = 0.5 * (x[p] - x[q]);
        sum += gx[i] * gx[i] + gy[i] * gy[i];
      }
      if (sum < 1e-9) return;
      const lam = (C / sum) * PRESSURE * this.soft;
      for (let i = 0; i < n; i++) { x[i] += lam * gx[i]; y[i] += lam * gy[i]; }
    }
    // Hautspannung: Kanten dürfen sich etwas dehnen/stauchen
    edges() {
      const n = this.n, x = this.x, y = this.y, mx = this.edge0 * 1.25, mn = this.edge0 * 0.5;
      this.flip = !this.flip;
      for (let k = 0; k < n; k++) {
        const i = this.flip ? k : n - 1 - k;
        const j = i === n - 1 ? 0 : i + 1;
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        let t = 0;
        if (d > mx) t = mx; else if (d < mn) t = mn; else continue;
        const c = (d - t) / d * 0.5;
        x[i] += dx * c; y[i] += dy * c; x[j] -= dx * c; y[j] -= dy * c;
      }
      // Umriss glätten (gleichzeitig für alle Punkte, damit nichts in eine Richtung wandert)
      const sx = this._sx || (this._sx = new Float32Array(n)), sy = this._sy || (this._sy = new Float32Array(n));
      for (let i = 0; i < n; i++) {
        const p = i === 0 ? n - 1 : i - 1, q = i === n - 1 ? 0 : i + 1;
        sx[i] = ((x[p] + x[q]) * 0.5 - x[i]) * 0.1;
        sy[i] = ((y[p] + y[q]) * 0.5 - y[i]) * 0.1;
      }
      for (let i = 0; i < n; i++) { x[i] += sx[i]; y[i] += sy[i]; }
    }
    shapeMatch() {
      this.centroid();
      const cx = this.cx, cy = this.cy;
      let a = 0, b = 0;
      for (let i = 0; i < this.n; i++) {
        const qx = this.x[i] - cx, qy = this.y[i] - cy;
        a += this.rx[i] * qx + this.ry[i] * qy;
        b += this.rx[i] * qy - this.ry[i] * qx;
      }
      const ang = this.ang = Math.atan2(b, a);
      const c = Math.cos(ang), s = Math.sin(ang), k = this.k;
      for (let i = 0; i < this.n; i++) {
        const gx = cx + c * this.rx[i] - s * this.ry[i];
        const gy = cy + s * this.rx[i] + c * this.ry[i];
        this.x[i] += (gx - this.x[i]) * k;
        this.y[i] += (gy - this.y[i]) * k;
      }
    }
    walls() {
      for (let i = 0; i < this.n; i++) {
        let x = this.x[i], y = this.y[i];
        if (y > H) {
          y = H; this.touch = true;
          this.px[i] = x - (x - this.px[i]) * 0.97;  // leichte Bodenreibung
        } else if (y < -200) { y = -200; }
        if (x < 0) x = 0; else if (x > W) x = W;
        // abgeschrägte Ecken unten
        let d = x + (H - y) - BEVEL;               // links unten
        if (d < 0) { x -= d * 0.5; y += d * 0.5; }
        d = (W - x) + (H - y) - BEVEL;             // rechts unten
        if (d < 0) { x += d * 0.5; y += d * 0.5; }
        for (const b of BUMPERS) {
          const dx = x - b.x, dy = y - b.y, dd = dx * dx + dy * dy;
          if (dd < b.r * b.r) {
            const l = Math.sqrt(dd) || 1e-6;
            x = b.x + (dx / l) * b.r; y = b.y + (dy / l) * b.r;
          }
        }
        this.x[i] = x; this.y[i] = y;
      }
    }
  }

  // Punkt in Polygon (Ray-Casting)
  function inside(B, px, py) {
    let c = false;
    const n = B.n, xs = B.x, ys = B.y;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if ((ys[i] > py) !== (ys[j] > py) && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]) c = !c;
    }
    return c;
  }

  // Punkte von A, die in B stecken, auf die nächste Kante von B schieben
  function pushOut(A, B) {
    let hit = false;
    const lim = (B.R * 1.35) * (B.R * 1.35);
    const wa = A.invMass, wb = B.invMass;
    for (let i = 0; i < A.n; i++) {
      const px = A.x[i], py = A.y[i];
      const dx0 = px - B.cx, dy0 = py - B.cy;
      if (dx0 * dx0 + dy0 * dy0 > lim) continue;
      if (!inside(B, px, py)) continue;
      hit = true; A.touch = B.touch = true;
      const dd0 = Math.sqrt(dx0 * dx0 + dy0 * dy0);
      if (dd0 < B.R * 0.45) {
        // steckt tief drin: radial nach außen schieben
        const l = dd0 || 1e-6, ux = dd0 ? dx0 / l : 0, uy = dd0 ? dy0 / l : -1;
        const push = (B.R * 0.45 - dd0) * 0.5;
        A.x[i] += ux * push; A.y[i] += uy * push;
        continue;
      }
      let best = Infinity, bj = 0, bt = 0, bqx = 0, bqy = 0;
      for (let j = 0; j < B.n; j++) {
        const k = j + 1 === B.n ? 0 : j + 1;
        const ax = B.x[j], ay = B.y[j], ex = B.x[k] - ax, ey = B.y[k] - ay;
        const ll = ex * ex + ey * ey || 1e-6;
        let t = ((px - ax) * ex + (py - ay) * ey) / ll;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + ex * t, qy = ay + ey * t;
        const d = (qx - px) * (qx - px) + (qy - py) * (qy - py);
        if (d < best) { best = d; bj = j; bt = t; bqx = qx; bqy = qy; }
      }
      const bk = bj + 1 === B.n ? 0 : bj + 1;
      const dx = bqx - px, dy = bqy - py;
      const u = 1 - bt, v = bt;
      const lam = 1 / (wa + wb * (u * u + v * v));
      A.x[i] += dx * wa * lam; A.y[i] += dy * wa * lam;
      B.x[bj] -= dx * wb * u * lam; B.y[bj] -= dy * wb * u * lam;
      B.x[bk] -= dx * wb * v * lam; B.y[bk] -= dy * wb * v * lam;
      // etwas Reibung zwischen den Blobs
      const tx = -dy, ty = dx, tl = Math.hypot(tx, ty);
      if (tl > 1e-6) {
        const nx = tx / tl, ny = ty / tl;
        const rvx = (A.x[i] - A.px[i]) - (B.x[bj] - B.px[bj]);
        const rvy = (A.y[i] - A.py[i]) - (B.y[bj] - B.py[bj]);
        const tv = (rvx * nx + rvy * ny) * 0.08;
        A.px[i] += nx * tv; A.py[i] += ny * tv;
      }
    }
    return hit;
  }

  // ---------------------------------------------------------------------------
  // Spielzustand
  // ---------------------------------------------------------------------------
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let dpr = 1, scale = 1, offX = 0, offY = 0, cw = 0, ch = 0;

  const G = {
    state: 'menu', blobs: [], parts: [], floats: [], ghosts: [],
    score: 0, best: store.get('blobbo_best_s2', 0),
    queue: [0, 1, 2], cooldown: 0,
    aim: Math.PI / 2, aiming: false,
    danger: 0, warnTick: 0, combo: 0, comboTimer: 0,
    shake: 0, time: 0, maxLevel: 0, overTimer: 0,
    jokers: { sniper: 0 }, nextJoker: 0,
    snap: null, sniper: false, shakeT: 0, safeT: 0,
  };
  let username = store.get('blobbo_name', '');

  function randomLevel() {
    // am Anfang nur 2/4/8, später bis 32
    const cap = clamp(G.maxLevel - 2, 2, SPAWN_WEIGHTS.length - 1);
    let tot = 0;
    for (let i = 0; i <= cap; i++) tot += SPAWN_WEIGHTS[i];
    let r = Math.random() * tot;
    for (let i = 0; i <= cap; i++) { r -= SPAWN_WEIGHTS[i]; if (r <= 0) return i; }
    return 0;
  }

  function newGame() {
    G.blobs = []; G.parts = []; G.floats = []; G.ghosts = [];
    G.score = 0; G.cooldown = 0; G.danger = 0; G.combo = 0; G.comboTimer = 0;
    G.maxLevel = 0; G.aim = Math.PI / 2; G.aiming = false; G.overTimer = 0;
    G.queue = [randomLevel(), randomLevel(), randomLevel()];
    G.jokers = { sniper: 0 }; G.nextJoker = 0;
    G.snap = null; G.mergeT = new Map(); G.sniper = false; G.shakeT = 0; G.safeT = 0; shakeAcc.x = shakeAcc.y = 0;
    G.state = 'playing';
    updateHud();
    show(null);
    $('hud').classList.remove('hidden');
    $('jokers').classList.remove('hidden');
    updateJokers();
  }

  function shoot() {
    if (G.state !== 'playing' || G.cooldown > 0) return;
    const dx = Math.cos(G.aim), dy = Math.sin(G.aim);
    const lvl = G.queue.shift();
    G.queue.push(randomLevel());
    const off = Math.min(LEVELS[lvl].r, 24) + 4;
    const b = new Blob(CANNON.x + dx * off, CANNON.y + dy * off, lvl, 0.8);
    b.setVel(dx * SHOT_SPEED, dy * SHOT_SPEED);
    G.blobs.push(b);
    G.cooldown = COOLDOWN;
    Sound.shoot();
    vibrate(8);
  }

  function addScore(pts, x, y, color) {
    G.score += pts;
    G.floats.push({ x, y, t: 0, txt: '+' + pts, c: color });
    while (G.nextJoker < SNIPER_AT.length && G.score >= SNIPER_AT[G.nextJoker]) {
      G.nextJoker++;
      G.jokers.sniper++;
      setTimeout(() => showCombo('🎯 +1 SNIPER!'), 350);
      Sound.mega();
    }
    updateHud();
    updateJokers();
  }

  // ---------------------------------------------------------------------------
  // Joker
  // ---------------------------------------------------------------------------
  function toggleSniper() {
    if (G.state !== 'playing') return;
    if (!G.sniper && G.jokers.sniper <= 0) return;
    G.sniper = !G.sniper; G.aiming = false;
    Sound.click();
    updateJokers();
  }

  function snipeAt(p) {
    let hit = null;
    for (const b of G.blobs) if (inside(b, p.x, p.y)) { hit = b; break; }
    if (!hit) {
      // daneben getippt: nächsten Blob in der Nähe nehmen
      let best = 30 * 30;
      for (const b of G.blobs) { const d = (b.cx - p.x) ** 2 + (b.cy - p.y) ** 2 - b.R * b.R; if (d < best) { best = d; hit = b; } }
    }
    if (!hit) return;
    G.blobs = G.blobs.filter((b) => b !== hit);
    G.jokers.sniper--; G.sniper = false;
    const lose = Math.min(hit.stored, G.score);
    G.score -= lose;
    if (lose > 0) G.floats.push({ x: hit.cx, y: hit.cy - hit.R * 0.5, t: 0, txt: '−' + lose, c: '#ff5c74' });
    burst(hit.cx, hit.cy, LEVELS[hit.level].c, 18 + hit.level * 2, 160 + hit.level * 20);
    G.shake = Math.max(G.shake, 4);
    Sound.snipe(); vibrate([15, 20, 30]);
    updateHud(); updateJokers();
  }

  // Ein Stoß: alles springt hoch – kleine Blobs höher, große kaum (so sortieren sie sich: groß unten, klein oben)
  function shakePulse() {
    if (!G.blobs.length) return;
    let rMin = Infinity, rMax = 0;
    for (const b of G.blobs) { rMin = Math.min(rMin, b.R); rMax = Math.max(rMax, b.R); }
    for (const b of G.blobs) {
      const k = rMax > rMin ? (b.R - rMin) / (rMax - rMin) : 0.5;   // 0 = kleinster, 1 = größter
      const up = 820 - 560 * k;                                      // Startgeschwindigkeit nach oben
      const side = (Math.random() < 0.5 ? -1 : 1) * rand(200, 380) * (1 - k * 0.85);
      nudge(b, side * HS, -up * HS);
    }
    G.shake = Math.max(G.shake, 10);
    Sound.rumble(); vibrate(60);
  }

  function updateShake(dt) {
    shakeAcc.x = shakeAcc.y = 0;
    shakeAcc.on = G.shakeT > 0;
    if (!shakeAcc.on) for (const b of G.blobs) b.sortAcc = 0;
    if (G.shakeT > 0) {
      const t0 = SHAKE_TIME - G.shakeT;
      G.shakeT = Math.max(0, G.shakeT - dt);
      const t1 = SHAKE_TIME - G.shakeT;
      for (const pt of SHAKE_PULSES) if (pt >= t0 && pt < t1) shakePulse();
      // Sortieren: kleine werden leichter, große schwerer
      let rMin = Infinity, rMax = 0;
      for (const b of G.blobs) { rMin = Math.min(rMin, b.R); rMax = Math.max(rMax, b.R); }
      for (const b of G.blobs) {
        const k = rMax > rMin ? (b.R - rMin) / (rMax - rMin) : 0.5;
        b.sortAcc = (k - 0.5) * 2 * 2600;
      }
      // zwischen den Stößen leicht hin und her
      shakeAcc.x = Math.sin(t1 * Math.PI * 2 * 4) * 900;
    }
    G.safeT = Math.max(0, G.safeT - dt);
  }

  function updateJokers() {
    const set = (id, n, on) => {
      const b = $(id);
      b.querySelector('.cnt').textContent = n;
      b.disabled = !on;
    };
    const playing = G.state === 'playing';
    set('jkSniper', G.jokers.sniper, playing && (G.jokers.sniper > 0 || G.sniper));
    $('jkSniper').classList.toggle('active', G.sniper);
    $('sniperHint').classList.toggle('hidden', !G.sniper);
  }

  function burst(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * power;
      G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - power * 0.3, r: rand(2, 5), life: rand(0.35, 0.8), t: 0, c: color });
    }
  }

  function doMerge(a, b) {
    a.dead = b.dead = true;
    // die alten Blobs schrumpfen sichtbar zum Treffpunkt zusammen
    const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2;
    for (const o of [a, b]) G.ghosts.push({ x: o.x.slice(), y: o.y.slice(), n: o.n, level: o.level, cx: o.cx, cy: o.cy, mx, my, R: o.R, ang: o.ang, t: 0 });
    const lvl = a.level;
    const cx = (a.cx + b.cx) / 2, cy = (a.cy + b.cy) / 2;
    const vx = ((a.cx - a.prevCx) + (b.cx - b.prevCx)) / 2 / STEP;
    const vy = ((a.cy - a.prevCy) + (b.cy - b.prevCy)) / 2 / STEP;
    G.combo = G.comboTimer > 0 ? G.combo + 1 : 1;
    G.comboTimer = 2.2;
    const mult = Math.min(G.combo, 8);
    if (lvl < MAX_LEVEL) {
      const nl = lvl + 1, R = LEVELS[nl].r;
      const nx = clamp(cx, R * 0.7, W - R * 0.7), ny = Math.min(cy, H - R * 0.7);
      const nb = new Blob(nx, ny, nl, 0.35);
      nb.growT = 0; nb.setScale(0.35);
      nb.setVel(vx * 0.3, vy * 0.3 - 60);
      nb.age = 1; nb.flash = 1;
      nb.stored = a.stored + b.stored;
      G.blobs.push(nb);
      G.maxLevel = Math.max(G.maxLevel, nl);
      const pts = LEVELS[nl].v * mult;
      nb.stored += pts;
      addScore(pts, nx, ny - R * 0.6, LEVELS[nl].c);
      burst(nx, ny, LEVELS[lvl].c, 8 + nl * 2, 110 + nl * 18);
      G.shake = Math.max(G.shake, nl * 0.6);
      Sound.merge(nl, G.combo);
      vibrate(nl >= 8 ? [20, 30, 20] : 15);
    } else {
      addScore(LEVELS[MAX_LEVEL].v * 2 * mult, cx, cy - 60, '#ffffff');
      for (let i = 0; i < 6; i++) burst(cx + rand(-60, 60), cy + rand(-60, 60), LEVELS[i * 2].c, 20, 380);
      G.shake = 12;
      Sound.mega();
      vibrate([40, 40, 80]);
    }
    if (G.combo >= 2) showCombo('COMBO x' + G.combo + '!');
  }

  function showCombo(text) {
    const el = $('combo');
    el.textContent = text;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(showCombo.t);
    showCombo.t = setTimeout(() => el.classList.add('hidden'), 700);
  }

  function physics() {
    const blobs = G.blobs, n = blobs.length;
    const touching = new Map();
    for (const b of blobs) { b.prevCx = b.cx; b.prevCy = b.cy; }
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < n; i++) blobs[i].integrate();
      for (let it = 0; it < ITER; it++) {
        for (let i = 0; i < n; i++) { const b = blobs[i]; b.shapeMatch(); b.edges(); b.pressure(); b.walls(); }
        for (let i = 0; i < n; i++) {
          const A = blobs[i];
          for (let j = i + 1; j < n; j++) {
            const B = blobs[j];
            const dx = A.cx - B.cx, dy = A.cy - B.cy, rr = (A.R + B.R) * 1.45;
            const d2 = dx * dx + dy * dy;
            if (d2 > rr * rr) continue;
            // stecken die Blobs tief ineinander: als Ganzes auseinanderschieben (ohne Schwung zu erzeugen)
            const deep = (A.R + B.R) * 0.55;
            if (d2 < deep * deep) {
              const d = Math.sqrt(d2) || 1e-3;
              const ux = d2 ? dx / d : 0, uy = d2 ? dy / d : -1;
              const mA = A.R * A.R, mB = B.R * B.R, sep = (deep - d) * 0.25;
              shift(A, ux * sep * mB / (mA + mB), uy * sep * mB / (mA + mB));
              shift(B, -ux * sep * mA / (mA + mB), -uy * sep * mA / (mA + mB));
            }
            const h1 = pushOut(A, B), h2 = pushOut(B, A);
            if (A.level === B.level && !A.dead && !B.dead && (h1 || h2 || near(A, B))) touching.set(A.id + '-' + B.id, [A, B]);
          }
        }
      }
    }
    for (const b of blobs) { b.centroid(); b.glow = 0; }
    // Verschmelzen dauert: gleiche Blobs müssen sich eine Weile berühren
    const MT = G.mergeT || (G.mergeT = new Map());
    for (const [k, pair] of touching) {
      const e = MT.get(k) || { a: pair[0], b: pair[1], t: 0 };
      e.t += STEP; e.seen = true; MT.set(k, e);
    }
    let merged = false;
    for (const [k, e] of MT) {
      if (e.a.dead || e.b.dead) { MT.delete(k); continue; }
      if (!e.seen) { e.t -= STEP; if (e.t <= 0) { MT.delete(k); continue; } }
      e.seen = false;
      const prog = Math.min(1, e.t / MERGE_TIME);
      e.a.glow = Math.max(e.a.glow, prog); e.b.glow = Math.max(e.b.glow, prog);
      // sanft zueinander ziehen
      const dx = e.b.cx - e.a.cx, dy = e.b.cy - e.a.cy, d = Math.hypot(dx, dy) || 1;
      const pull = 0.12 * prog;
      nudge(e.a, dx / d * pull, dy / d * pull); nudge(e.b, -dx / d * pull, -dy / d * pull);
      if (e.t >= MERGE_TIME) { MT.delete(k); doMerge(e.a, e.b); merged = true; }
    }
    if (merged) G.blobs = G.blobs.filter((b) => !b.dead);
  }

  function nudge(b, vx, vy) {  // Geschwindigkeit leicht ändern
    for (let i = 0; i < b.n; i++) { b.px[i] -= vx; b.py[i] -= vy; }
  }

  function shift(b, sx, sy) {
    for (let i = 0; i < b.n; i++) { b.x[i] += sx; b.y[i] += sy; b.px[i] += sx; b.py[i] += sy; }
    b.cx += sx; b.cy += sy;
  }

  // berühren sich zwei Blobs (auch ohne Überlappung)?
  function near(A, B) {
    for (let i = 0; i < A.n; i++) {
      for (let j = 0; j < B.n; j++) {
        const dx = A.x[i] - B.x[j], dy = A.y[i] - B.y[j];
        if (dx * dx + dy * dy < 64) return true;   // bis 8 Einheiten Abstand zählt als Berührung
      }
    }
    return false;
  }

  function topOf(b) { let m = Infinity; for (let i = 0; i < b.n; i++) if (b.y[i] < m) m = b.y[i]; return m; }

  function update(dt) {
    G.time += dt;
    if (G.state === 'playing' || G.state === 'over') {
      if (G.state === 'playing') physics();
      G.cooldown = Math.max(0, G.cooldown - dt);
      G.comboTimer = Math.max(0, G.comboTimer - dt);
      if (G.comboTimer === 0) G.combo = 0;

      for (const b of G.blobs) {
        b.age += dt;
        const vx = (b.cx - b.prevCx) / dt, vy = (b.cy - b.prevCy) / dt;
        const dv = Math.hypot(vx - b.lastVx, vy - b.lastVy);
        if (G.state === 'playing' && dv > 220 && b.age > 0.05) { Sound.squish(dv / 1200); if (dv > 420) b.ouch = 0.4; }
        b.lastVx = vx; b.lastVy = vy;
        b.flash = Math.max(0, b.flash - dt * 1.4);
        if (b.growT >= 0) {
          b.growT += dt;
          const k = Math.min(1, b.growT / GROW_TIME);
          // weich mit kleinem Überschwingen (easeOutBack)
          const c1 = 1.6, e = 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
          b.setScale(0.35 + 0.65 * e);
          if (k >= 1) { b.setScale(1); b.growT = -1; }
        }
        b.ouch = Math.max(0, (b.ouch || 0) - dt);
        b.blinkT = (b.blinkT === undefined ? rand(1, 5) : b.blinkT) - dt;
        if (b.blinkT < -0.13) b.blinkT = rand(2, 6);
      }

      // Gefahrenlinie
      if (G.state === 'playing') updateShake(dt);
      if (G.state === 'playing' && G.safeT > 0) {
        // beim Schütteln läuft kein Timer
      } else if (G.state === 'playing') {
        let over = false;
        for (const b of G.blobs) if (b.age > 1.2 && topOf(b) < DANGER_Y) { over = true; break; }
        if (over) {
          G.danger += dt;
          G.warnTick -= dt;
          if (G.warnTick <= 0) { Sound.warn(); G.warnTick = 0.5; vibrate(10); }
          if (G.danger >= DANGER_TIME) gameOver();
        } else {
          G.danger = Math.max(0, G.danger - dt * 2); G.warnTick = 0;
        }
      } else {
        G.overTimer += dt;
      }
    }
    for (const g of G.ghosts) g.t += dt;
    G.ghosts = G.ghosts.filter((g) => g.t < GHOST_TIME);
    for (const p of G.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; }
    G.parts = G.parts.filter((p) => p.t < p.life);
    for (const f of G.floats) f.t += dt;
    G.floats = G.floats.filter((f) => f.t < 1);
    G.shake *= 0.88;
  }

  // ---------------------------------------------------------------------------
  // Zeichnen
  // ---------------------------------------------------------------------------
  const FRAME = 16;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const topPad = 100, botPad = 100;
    scale = Math.min((cw - 12) / (W + FRAME * 2), (ch - topPad - botPad) / (H + FRAME * 2));
    offX = (cw - W * scale) / 2;
    offY = topPad + (ch - topPad - botPad - H * scale) / 2;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = (v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f);
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  }
  LEVELS.forEach((L) => { L.d = shade(L.c, -0.35); L.l = shade(L.c, 0.45); });

  function blobPath(c, b) {
    const n = b.n, x = b.x, y = b.y;
    c.beginPath();
    c.moveTo((x[n - 1] + x[0]) / 2, (y[n - 1] + y[0]) / 2);
    for (let i = 0; i < n; i++) {
      const k = i + 1 === n ? 0 : i + 1;
      c.quadraticCurveTo(x[i], y[i], (x[i] + x[k]) / 2, (y[i] + y[k]) / 2);
    }
    c.closePath();
  }

  // ---------------------------------------------------------------------------
  // Gesichter: jede Zahl hat ihr eigenes Smiley-Design
  // ---------------------------------------------------------------------------
  const INK = 'rgba(28,18,52,.92)';
  const FACES = ['happy', 'grin', 'wink', 'tongue', 'wow', 'love', 'cool', 'stars', 'cheeky', 'sleepy', 'happy', 'cool', 'stars', 'love'];

  function eye(c, x, y, er, lx, ly) {
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(x, y, er, er * 1.15, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = INK;
    c.beginPath(); c.arc(x + lx * er * 0.35, y + ly * er * 0.4, er * 0.58, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(x + lx * er * 0.35 - er * 0.2, y + ly * er * 0.4 - er * 0.25, er * 0.2, 0, Math.PI * 2); c.fill();
  }
  function lid(c, x, y, er, up) { // geschlossenes Auge
    c.beginPath();
    if (up) c.arc(x, y + er * 0.3, er * 0.8, Math.PI * 1.15, Math.PI * 1.85);
    else c.arc(x, y - er * 0.3, er * 0.8, Math.PI * 0.15, Math.PI * 0.85);
    c.stroke();
  }
  function heart(c, x, y, s) {
    c.fillStyle = '#ff3b6b';
    c.beginPath();
    c.moveTo(x, y + s * 0.9);
    c.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
    c.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
    c.fill();
  }
  function star(c, x, y, s) {
    c.fillStyle = '#fff6a0'; c.strokeStyle = '#e8a400'; c.lineWidth = Math.max(1, s * 0.15);
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.45 : s;
      c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    c.closePath(); c.fill(); c.stroke();
  }
  function crown(c, R) {
    const w = R * 0.62, h = R * 0.34, y = -R * 0.98;
    c.fillStyle = '#ffd43b'; c.strokeStyle = '#c98f00'; c.lineWidth = Math.max(1.2, R * 0.04);
    c.beginPath();
    c.moveTo(-w / 2, y + h); c.lineTo(-w / 2, y); c.lineTo(-w / 4, y + h * 0.55); c.lineTo(0, y - h * 0.15);
    c.lineTo(w / 4, y + h * 0.55); c.lineTo(w / 2, y); c.lineTo(w / 2, y + h); c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#ff5c74';
    c.beginPath(); c.arc(0, y + h * 0.62, R * 0.05, 0, Math.PI * 2); c.fill();
  }

  // Gesicht im lokalen System (Mitte = 0,0), Zahl darunter
  function face(c, R, level, st) {
    const type = FACES[level] || 'happy';
    const ex = R * 0.3, ey = -R * 0.3, er = Math.max(2.2, R * 0.16), my = -R * 0.04;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = INK; c.lineWidth = Math.max(1.4, R * 0.065);
    const lx = st.lx, ly = st.ly;
    const blink = st.blink, ouch = st.ouch > 0, hype = st.glow > 0.25;

    // Bäckchen
    c.fillStyle = 'rgba(255,90,140,.28)';
    c.beginPath(); c.ellipse(-ex * 1.55, my + R * 0.02, R * 0.13, R * 0.08, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(ex * 1.55, my + R * 0.02, R * 0.13, R * 0.08, 0, 0, Math.PI * 2); c.fill();

    // Augen
    if (ouch) {
      for (const sx of [-1, 1]) {
        c.beginPath(); c.moveTo(sx * ex - er * 0.7 * sx, ey - er * 0.7); c.lineTo(sx * ex + er * 0.5 * sx, ey); c.lineTo(sx * ex - er * 0.7 * sx, ey + er * 0.7); c.stroke();
      }
    } else if (type === 'cool') {
      c.fillStyle = '#16121f';
      for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * ex, ey + er * 0.1, er * 1.35, er * 0.95, 0, 0, Math.PI * 2); c.fill(); }
      c.beginPath(); c.moveTo(-ex, ey - er * 0.2); c.lineTo(ex, ey - er * 0.2); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.55)';
      for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * ex - er * 0.5, ey - er * 0.25, er * 0.35, er * 0.18, -0.4, 0, Math.PI * 2); c.fill(); }
    } else if (type === 'love' && !blink) {
      heart(c, -ex, ey, er * 1.25); heart(c, ex, ey, er * 1.25);
    } else if (type === 'stars' && !blink) {
      star(c, -ex, ey, er * 1.3); star(c, ex, ey, er * 1.3);
    } else if (type === 'sleepy' || blink) {
      lid(c, -ex, ey, er, false); lid(c, ex, ey, er, false);
    } else if (type === 'wink' && !hype) {
      lid(c, -ex, ey, er, true); eye(c, ex, ey, er, lx, ly);
    } else {
      const big = type === 'wow' || hype ? 1.25 : 1;
      eye(c, -ex, ey, er * big, lx, ly); eye(c, ex, ey, er * big, lx, ly);
      if (type === 'cheeky') { // freche Augenbrauen
        c.beginPath(); c.moveTo(-ex - er, ey - er * 1.5); c.lineTo(-ex + er, ey - er * 1.1); c.stroke();
        c.beginPath(); c.moveTo(ex + er, ey - er * 1.5); c.lineTo(ex - er, ey - er * 1.1); c.stroke();
      }
    }

    // Mund
    const mw = R * 0.2;
    if (ouch) {
      c.beginPath(); c.moveTo(-mw, my + R * 0.05);
      for (let i = 1; i <= 4; i++) c.lineTo(-mw + (mw * 2 * i) / 4, my + R * 0.05 + (i % 2 ? -R * 0.05 : 0));
      c.stroke();
    } else if (type === 'wow' || type === 'sleepy') {
      c.fillStyle = INK; c.beginPath(); c.ellipse(0, my + R * 0.04, R * 0.07, R * 0.09, 0, 0, Math.PI * 2); c.fill();
      if (type === 'sleepy') {
        c.fillStyle = INK; c.font = '700 ' + (R * 0.22).toFixed(1) + 'px Fredoka, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('z', R * 0.48, -R * 0.62 - Math.sin(st.t * 2) * R * 0.05);
      }
    } else if (type === 'grin' || hype) {
      c.fillStyle = INK; c.beginPath(); c.arc(0, my - R * 0.02, mw, 0, Math.PI); c.closePath(); c.fill();
      c.fillStyle = '#ff7b9c'; c.beginPath(); c.ellipse(0, my + mw * 0.6, mw * 0.5, mw * 0.28, 0, 0, Math.PI * 2); c.fill();
    } else if (type === 'tongue') {
      c.beginPath(); c.arc(0, my - R * 0.06, mw, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
      c.fillStyle = '#ff7b9c'; c.beginPath(); c.ellipse(mw * 0.25, my + mw * 0.45, mw * 0.32, mw * 0.42, 0.2, 0, Math.PI * 2); c.fill();
    } else if (type === 'cool' || type === 'cheeky') {
      c.beginPath(); c.moveTo(-mw * 0.8, my + R * 0.03); c.quadraticCurveTo(mw * 0.2, my + R * 0.1, mw, my - R * 0.02); c.stroke();
    } else {
      c.beginPath(); c.arc(0, my - R * 0.08, mw, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
    }
    if (level >= 10) crown(c, R);
  }

  function label(c, x, y, R, level, ang, st) {
    const txt = String(LEVELS[level].v);
    const withFace = R >= 14;
    c.save(); c.translate(x, y); c.rotate(ang);
    if (withFace) face(c, R, level, st || { lx: 0, ly: 0.4, blink: false, ouch: 0, glow: 0, t: G.time });
    const size = withFace ? Math.min(R * 0.4, (R * 1.15) / txt.length) : Math.min(R * 0.62, (R * 1.5) / txt.length);
    c.font = '700 ' + size.toFixed(1) + 'px Fredoka, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(20,16,40,.82)';
    c.fillText(txt, 0, withFace ? R * 0.45 : size * 0.05);
    c.restore();
  }

  function drawBlob(c, b) {
    const L = LEVELS[b.level];
    blobPath(c, b);
    c.fillStyle = L.c; c.fill();
    c.lineJoin = 'round';
    c.lineWidth = 2.5; c.strokeStyle = L.d; c.stroke();
    // weicher Glanz oben links
    c.save(); c.clip();
    c.fillStyle = 'rgba(255,255,255,.22)';
    c.beginPath(); c.ellipse(b.cx - b.R * 0.35, b.cy - b.R * 0.45, b.R * 0.45, b.R * 0.25, -0.5, 0, Math.PI * 2); c.fill();
    if (b.glow > 0) {
      const a = b.glow * (0.35 + 0.25 * Math.sin(G.time * 30));
      c.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; c.fillRect(b.cx - b.R * 2, b.cy - b.R * 2, b.R * 4, b.R * 4);
    }
    if (b.flash > 0) { c.fillStyle = 'rgba(255,255,255,' + (b.flash * 0.8).toFixed(2) + ')'; c.fillRect(b.cx - b.R * 2, b.cy - b.R * 2, b.R * 4, b.R * 4); }
    c.restore();
    // Blick: zum Werfer oben
    const dx = CANNON.x - b.cx, dy = CANNON.y - b.cy, d = Math.hypot(dx, dy) || 1;
    const ca = Math.cos(-b.ang), sa = Math.sin(-b.ang);
    const lx = (dx * ca - dy * sa) / d, ly = (dx * sa + dy * ca) / d;
    label(c, b.cx, b.cy, b.R, b.level, b.ang, { lx, ly, blink: b.blinkT < 0, ouch: b.ouch || 0, glow: Math.max(b.glow || 0, b.growT >= 0 ? 1 : 0), t: G.time });
  }

  // Alter Blob, der beim Verschmelzen zum Treffpunkt schrumpft
  function drawGhost(c, g) {
    const k = Math.min(1, g.t / GHOST_TIME), e = k * k * (3 - 2 * k);
    const sc = 1 - 0.75 * e;
    const ox = g.cx + (g.mx - g.cx) * e, oy = g.cy + (g.my - g.cy) * e;
    const L = LEVELS[g.level];
    c.save();
    c.globalAlpha = 1 - e * 0.8;
    c.beginPath();
    const px = (i) => ox + (g.x[i] - g.cx) * sc, py = (i) => oy + (g.y[i] - g.cy) * sc;
    c.moveTo((px(g.n - 1) + px(0)) / 2, (py(g.n - 1) + py(0)) / 2);
    for (let i = 0; i < g.n; i++) { const j = (i + 1) % g.n; c.quadraticCurveTo(px(i), py(i), (px(i) + px(j)) / 2, (py(i) + py(j)) / 2); }
    c.closePath();
    c.fillStyle = L.c; c.fill(); c.lineWidth = 2.5; c.strokeStyle = L.d; c.stroke();
    c.fillStyle = 'rgba(255,255,255,' + (0.5 * e).toFixed(2) + ')'; c.fill();
    c.restore();
    c.save(); c.globalAlpha = 1 - e;
    label(c, ox, oy, g.R * sc, g.level, g.ang, { lx: (g.mx - g.cx) / (g.R || 1), ly: 0, blink: false, ouch: 0, glow: 1, t: G.time });
    c.restore();
  }

  // Statischer Blob (Warteschlange / Menü)
  function drawStatic(c, x, y, level, R, t = 0) {
    const L = LEVELS[level];
    const wob = Math.sin(t * 4) * 0.05;
    c.save(); c.translate(x, y); c.scale(1 + wob, 1 - wob);
    c.fillStyle = L.c; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.lineWidth = Math.max(1.5, R * 0.1); c.strokeStyle = L.d; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.22)';
    c.beginPath(); c.ellipse(-R * 0.35, -R * 0.42, R * 0.4, R * 0.22, -0.5, 0, Math.PI * 2); c.fill();
    c.restore();
    label(c, x, y, R, level, 0);
  }

  function containerPath(c, g) {
    c.beginPath();
    c.moveTo(-g, -g); c.lineTo(W + g, -g); c.lineTo(W + g, H - BEVEL + g * 0.4);
    c.lineTo(W - BEVEL + g * 0.4, H + g); c.lineTo(BEVEL - g * 0.4, H + g); c.lineTo(-g, H - BEVEL + g * 0.4);
    c.closePath();
  }

  function drawTrajectory(c) {
    const R = LEVELS[G.queue[0]].r * 0.8;
    const off = Math.min(LEVELS[G.queue[0]].r, 24) + 4;
    let x = CANNON.x + Math.cos(G.aim) * off, y = CANNON.y + Math.sin(G.aim) * off;
    let vx = Math.cos(G.aim) * SHOT_SPEED, vy = Math.sin(G.aim) * SHOT_SPEED;
    const dt = 1 / 60;
    c.fillStyle = 'rgba(255,255,255,.8)';
    for (let i = 0; i < 40; i++) {
      for (let k = 0; k < 2; k++) {
        vy += GRAVITY * dt * 0.5; x += vx * dt * 0.5; y += vy * dt * 0.5;
        if (x < R) { x = R; vx = -vx * 0.3; }
        if (x > W - R) { x = W - R; vx = -vx * 0.3; }
      }
      if (y > H - R) break;
      let hit = false;
      for (const b of G.blobs) { if (Math.hypot(b.cx - x, b.cy - y) < b.R + R * 0.85) { hit = true; break; } }
      if (i % 2 === 0) {
        c.globalAlpha = 1 - i / 44;
        c.beginPath(); c.arc(x, y, 2.6, 0, Math.PI * 2); c.fill();
      }
      if (hit) {
        c.globalAlpha = 0.9;
        c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill();
        break;
      }
    }
    c.globalAlpha = 1;
  }

  function render() {
    const c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Hintergrund: Sternenhimmel
    const bg = c.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#2a1f6b'); bg.addColorStop(1, '#130e33');
    c.fillStyle = bg; c.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 60; i++) {
      const x = (i * 137.5) % cw, y = (i * 211.7) % ch;
      c.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(G.time * 1.5 + i));
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(x, y, (i % 3) * 0.6 + 0.7, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;

    const sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
    c.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offX + sx * scale), dpr * (offY + sy * scale));

    // Rahmen
    containerPath(c, FRAME); c.fillStyle = '#2b2838'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#4a4560'; c.stroke();
    containerPath(c, 4); c.fillStyle = '#1a1824'; c.fill();
    containerPath(c, 0); c.fillStyle = '#07060c'; c.fill();
    // Schiene oben
    c.fillStyle = '#5a5570';
    roundRect(c, 10, -10, 120, 5, 2.5); c.fill();
    roundRect(c, W - 130, -10, 120, 5, 2.5); c.fill();
    // Bumper
    for (const b of BUMPERS) {
      c.fillStyle = '#3d3a4f'; c.strokeStyle = '#5a5570'; c.lineWidth = 2;
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill(); c.stroke();
    }

    c.save();
    containerPath(c, 0); c.clip();

    // Gefahrenlinie
    const dangerK = G.danger / DANGER_TIME;
    const pulse = dangerK > 0 ? 0.5 + 0.5 * Math.sin(G.time * 18) : 0;
    if (dangerK > 0) {
      c.fillStyle = `rgba(255,60,80,${0.1 + 0.15 * pulse * dangerK})`;
      c.fillRect(0, 0, W, DANGER_Y);
    }
    c.strokeStyle = dangerK > 0 ? `rgba(255,70,90,${0.6 + 0.4 * pulse})` : 'rgba(255,90,110,.35)';
    c.lineWidth = 2; c.setLineDash([10, 9]);
    c.beginPath(); c.moveTo(0, DANGER_Y); c.lineTo(W, DANGER_Y); c.stroke(); c.setLineDash([]);

    if (G.state === 'playing' && G.aiming) drawTrajectory(c);

    for (const g of G.ghosts) drawGhost(c, g);
    for (const b of G.blobs) drawBlob(c, b);
    if (G.sniper) {
      c.strokeStyle = '#ff5c74'; c.lineWidth = 2; c.setLineDash([6, 5]);
      for (const b of G.blobs) { blobPath(c, b); c.stroke(); }
      c.setLineDash([]);
    }

    for (const p of G.parts) {
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.c;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;

    // Warteschlange oben: aktueller Blob am Werfer, dahinter die nächsten
    if (G.state !== 'menu' && G.queue) {
      const ready = 1 - G.cooldown / COOLDOWN;
      const q = G.queue;
      c.save(); c.translate(CANNON.x, CANNON.y); c.rotate(G.aim - Math.PI / 2);
      c.fillStyle = 'rgba(255,255,255,.12)';
      roundRect(c, -7, 0, 14, 34, 7); c.fill();
      c.restore();
      const r0 = Math.min(LEVELS[q[0]].r, 24) * (0.55 + 0.45 * ready);
      drawStatic(c, CANNON.x, CANNON.y, q[0], r0, G.time);
      let x = CANNON.x + 24 + 14;
      for (let i = 1; i < q.length; i++) {
        const r = Math.min(LEVELS[q[i]].r * 0.7, 15);
        x += r;
        c.globalAlpha = i === 1 ? 0.9 : 0.6;
        drawStatic(c, x, CANNON.y - 6, q[i], r, G.time + i);
        x += r + 8;
      }
      c.globalAlpha = 1;
    }

    // Punkte-Texte
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (const f of G.floats) {
      c.globalAlpha = 1 - f.t;
      c.font = '700 22px Fredoka, sans-serif';
      c.lineWidth = 5; c.strokeStyle = '#07060c';
      c.strokeText(f.txt, f.x, f.y - f.t * 45);
      c.fillStyle = f.c; c.fillText(f.txt, f.x, f.y - f.t * 45);
    }
    c.globalAlpha = 1;

    if (dangerK > 0 && G.state === 'playing') {
      c.font = '700 34px Fredoka, sans-serif'; c.lineWidth = 6; c.strokeStyle = '#07060c';
      const t = Math.ceil(DANGER_TIME - G.danger);
      c.strokeText(String(t), 60, DANGER_Y - 14); c.fillStyle = '#ff5c74'; c.fillText(String(t), 60, DANGER_Y - 14);
    }
    c.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function drawEvolution() {
    const ec = $('evo'), c = ec.getContext('2d');
    const r = window.devicePixelRatio || 1;
    ec.width = 320 * r; ec.height = 56 * r;
    c.setTransform(r, 0, 0, r, 0, 0);
    c.clearRect(0, 0, 320, 56);
    // zwei Reihen à 7
    for (let i = 0; i < LEVELS.length; i++) {
      const row = Math.floor(i / 7), col = i % 7;
      drawStatic(c, 25 + col * 45, 14 + row * 28, i, 12.5);
    }
  }

  // ---------------------------------------------------------------------------
  // Eingabe
  // ---------------------------------------------------------------------------
  function toWorld(e) { return { x: (e.clientX - offX) / scale, y: (e.clientY - offY) / scale }; }
  function setAim(p) {
    let dx = p.x - CANNON.x, dy = p.y - CANNON.y;
    if (dy < 12) dy = 12;
    G.aim = clamp(Math.atan2(dy, dx), 0.1, Math.PI - 0.1);
  }
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    if (G.state !== 'playing') return;
    e.preventDefault();
    if (G.sniper) { snipeAt(toWorld(e)); return; }
    G.aiming = true; setAim(toWorld(e));
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
  });
  canvas.addEventListener('pointermove', (e) => { if (G.aiming) setAim(toWorld(e)); });
  canvas.addEventListener('pointerup', (e) => {
    if (!G.aiming) return;
    G.aiming = false; setAim(toWorld(e)); shoot();
  });
  canvas.addEventListener('pointercancel', () => { G.aiming = false; });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (G.state !== 'playing') return;
    if (e.key === 'ArrowLeft') G.aim = clamp(G.aim + 0.06, 0.1, Math.PI - 0.1);
    if (e.key === 'ArrowRight') G.aim = clamp(G.aim - 0.06, 0.1, Math.PI - 0.1);
    if (e.key === ' ' || e.key === 'Enter') shoot();
  });

  // ---------------------------------------------------------------------------
  // Rangliste
  // ---------------------------------------------------------------------------
  const Board = {
    local() { return store.get('blobbo_scores_s2', []); },
    addLocal(name, score) {
      const list = this.local();
      const entry = { name, score, ts: Date.now() };
      list.push(entry);
      list.sort((a, b) => b.score - a.score);
      const top = list.slice(0, 50);
      store.set('blobbo_scores_s2', top);
      return top.indexOf(entry);
    },
    // Einträge prüfen: nur gültige Namen/Punkte, pro Name der beste
    clean(list) {
      const best = new Map();
      for (const e of Array.isArray(list) ? list : []) {
        if (!e || typeof e.name !== 'string' || typeof e.score !== 'number' || !isFinite(e.score)) continue;
        const name = cleanName(e.name), score = Math.max(0, Math.min(99999999, Math.floor(e.score)));
        if (!name) continue;
        if (REMOVED.some((r) => r.name === name.toLowerCase() && (Number(e.ts) || 0) <= r.before)) continue;
        const old = best.get(name);
        if (!old || score > old.score) best.set(name, { name, score, ts: Number(e.ts) || 0 });
      }
      return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 200);
    },
    async submit(name, score) {
      if (!ONLINE_URL || score <= 0) return;
      if (STORE_KEY) {
        // lesen, eigenen Eintrag einfügen, zurückschreiben
        const data = await BlobboStore.read(STORE_KEY);
        const list = this.clean((data && data.blobbo) || []);
        list.push({ name, score, ts: Date.now() });
        await BlobboStore.write(STORE_KEY, Object.assign({}, data || {}, { blobbo: this.clean(list) }));
        return;
      }
      await fetch(ONLINE_URL + '/scores.json', {
        method: 'POST',
        body: JSON.stringify({ name, score, ts: { '.sv': 'timestamp' } }),
      });
    },
    async online() {
      if (STORE_KEY) {
        const data = await BlobboStore.read(STORE_KEY);
        return this.clean((data && data.blobbo) || []);
      }
      const res = await fetch(ONLINE_URL + '/scores.json?orderBy=%22score%22&limitToLast=100');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return this.clean(Object.values(data || {}));
    },
  };

  let boardTab = ONLINE_URL ? 'online' : 'local';
  let boardReturn = 'menu';

  function renderList(list, msg) {
    const ol = $('boardList');
    ol.textContent = '';
    if (msg || !list.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = msg || 'Noch keine Einträge – sei der Erste!';
      ol.appendChild(li);
      return;
    }
    let meMarked = false;
    list.slice(0, 100).forEach((e, i) => {
      const li = document.createElement('li');
      if (!meMarked && username && e.name === username) { li.className = 'me'; meMarked = true; }
      const r = document.createElement('span'); r.className = 'rank';
      r.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
      const n = document.createElement('span'); n.className = 'name'; n.textContent = e.name;
      const p = document.createElement('span'); p.className = 'pts'; p.textContent = e.score.toLocaleString('de-DE');
      li.append(r, n, p);
      ol.appendChild(li);
    });
  }

  async function openBoard(from) {
    boardReturn = from;
    show('board');
    $('tabOnline').classList.toggle('active', boardTab === 'online');
    $('tabLocal').classList.toggle('active', boardTab === 'local');
    if (boardTab === 'local') { renderList(Board.local()); return; }
    if (!ONLINE_URL) {
      renderList([], 'Die weltweite Rangliste ist noch nicht eingerichtet. Deine Bestenliste findest du unter „Dieses Gerät“.');
      return;
    }
    renderList([], 'Lade…');
    try { renderList(await Board.online()); } catch (e) { renderList([], 'Keine Verbindung zur Rangliste 😕'); }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const screens = ['menu', 'pause', 'over', 'board'];
  function show(id) { for (const s of screens) $(s).classList.toggle('hidden', s !== id); }
  function updateHud() {
    $('score').textContent = G.score.toLocaleString('de-DE');
    $('best').textContent = Math.max(G.best, G.score).toLocaleString('de-DE');
  }
  function cleanName(s) { return s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16); }
  function soundLabels() {
    $('btnMusic').textContent = '🎵 Musik: ' + (Sound.musOn ? 'an' : 'aus');
    $('btnSfx').textContent = '🔊 Effekte: ' + (Sound.sfxOn ? 'an' : 'aus');
    $('btnSound').textContent = Sound.sfxOn || Sound.musOn ? '🔊' : '🔇';
  }

  async function gameOver() {
    G.state = 'over';
    G.aiming = false;
    Sound.over();
    vibrate([60, 50, 120]);
    const isBest = G.score > G.best;
    if (isBest) { G.best = G.score; store.set('blobbo_best_s2', G.best); }
    G.sniper = false; shakeAcc.x = shakeAcc.y = 0;
    updateJokers();
    const rank = Board.addLocal(username, G.score);
    $('finalScore').textContent = G.score.toLocaleString('de-DE');
    let info = isBest ? '🎉 Neuer Rekord!' : 'Rekord: ' + G.best.toLocaleString('de-DE');
    if (rank >= 0 && rank < 10) info += ' · Platz ' + (rank + 1) + ' auf diesem Gerät';
    $('overInfo').textContent = info;
    setTimeout(() => { if (G.state === 'over') show('over'); }, 900);
    if (ONLINE_URL) {
      try {
        await Board.submit(username, G.score);
        const list = await Board.online();
        const pos = list.findIndex((e) => e.name === username);
        if (pos >= 0) $('overInfo').textContent = info + ' · Weltweit Platz ' + (pos + 1) + ' (dein Bestwert)';
      } catch (e) { /* offline */ }
    }
  }

  function startFromMenu() {
    const name = cleanName($('nameInput').value);
    if (!name) {
      $('nameInput').focus();
      $('nameInput').style.borderColor = '#ff6b81';
      return;
    }
    username = name; store.set('blobbo_name', name);
    $('nameInput').blur();
    Sound.init(); Sound.click();
    newGame();
  }

  function pause() {
    if (G.state !== 'playing') return;
    G.state = 'paused'; G.aiming = false;
    show('pause');
    updateJokers();
    if (Sound.ctx) Sound.ctx.suspend();
  }
  function resume() {
    if (G.state !== 'paused') return;
    if (Sound.ctx) Sound.ctx.resume();
    G.state = 'playing';
    show(null);
    updateJokers();
  }
  function toMenu() {
    $('jokers').classList.add('hidden');
    G.state = 'menu'; G.blobs = [];
    $('hud').classList.add('hidden');
    show('menu');
    if (Sound.ctx && Sound.ctx.state === 'suspended') Sound.ctx.resume();
  }

  $('nameInput').value = username;
  $('nameInput').addEventListener('input', (e) => { e.target.style.borderColor = ''; });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') startFromMenu(); });
  $('btnPlay').onclick = startFromMenu;
  $('btnBoardMenu').onclick = () => { Sound.init(); Sound.click(); openBoard('menu'); };
  $('btnBoardOver').onclick = () => { Sound.click(); openBoard('over'); };
  $('btnBoardBack').onclick = () => { Sound.click(); show(boardReturn); };
  $('tabOnline').onclick = () => { boardTab = 'online'; openBoard(boardReturn); };
  $('tabLocal').onclick = () => { boardTab = 'local'; openBoard(boardReturn); };
  $('btnAgain').onclick = () => { Sound.click(); newGame(); };
  $('btnOverMenu').onclick = () => { Sound.click(); toMenu(); };
  $('btnPause').onclick = () => { Sound.click(); pause(); };
  $('btnResume').onclick = resume;
  $('btnRestart').onclick = () => { if (Sound.ctx) Sound.ctx.resume(); newGame(); };
  $('btnToMenu').onclick = toMenu;
  $('btnMusic').onclick = () => { Sound.init(); Sound.setMusic(!Sound.musOn); soundLabels(); };
  $('btnSfx').onclick = () => { Sound.init(); Sound.setSfx(!Sound.sfxOn); soundLabels(); Sound.click(); };
  $('jkSniper').onclick = () => { Sound.init(); toggleSniper(); };
  $('btnSound').onclick = () => {
    Sound.init();
    const on = !(Sound.sfxOn || Sound.musOn);
    Sound.setSfx(on); Sound.setMusic(on); soundLabels();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------------------
  // Hauptschleife (feste Zeitschritte)
  // ---------------------------------------------------------------------------
  let last = performance.now(), acc = 0;
  function loop(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    let steps = 0;
    while (acc >= STEP && steps < 3) {
      if (G.state !== 'paused') update(STEP);
      acc -= STEP; steps++;
    }
    if (steps === 3) acc = 0;
    render();
    requestAnimationFrame(loop);
  }

  resize();
  updateHud();
  soundLabels();
  drawEvolution();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawEvolution);
  requestAnimationFrame(loop);

  // für Tests
  window.__blobbo = { G, LEVELS, Blob, toScreen: (x, y) => ({ x: offX + x * scale, y: offY + y * scale }) };
})();
