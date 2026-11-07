'use strict';
(() => {
  // ---------------------------------------------------------------------------
  // Welt & Konstanten (virtuelle Einheiten, werden auf den Bildschirm skaliert)
  // ---------------------------------------------------------------------------
  const W = 400, H = 720;
  const DANGER_Y = 200;               // rote Linie
  const DANGER_TIME = 3.0;            // Sekunden über der Linie bis Game Over
  const CANNON = { x: W / 2, y: 74 };
  const GRAVITY = 1500;
  const STEP = 1 / 60;
  const SUBSTEPS = 4;
  const HS = STEP / SUBSTEPS;
  const ITER = 2;
  const DAMP = 0.9993;
  const SHOT_SPEED = 860;
  const COOLDOWN = 0.5;

  const LEVELS = [
    { r: 16, c: '#ff6b81', d: '#b8304a' },
    { r: 20, c: '#ffa94d', d: '#c4650f' },
    { r: 25, c: '#ffe066', d: '#b89317' },
    { r: 31, c: '#8ce99a', d: '#2f9246' },
    { r: 39, c: '#66d9e8', d: '#16889a' },
    { r: 49, c: '#74c0fc', d: '#2a6fb8' },
    { r: 61, c: '#b197fc', d: '#6145c4' },
    { r: 76, c: '#f783ac', d: '#b53b70' },
    { r: 95, c: '#ff8787', d: '#bd3b3b' },
    { r: 119,c: '#63e6be', d: '#0f9470' },
    { r: 149,c: '#ffd43b', d: '#c98f00' },
  ];
  const MAX_LEVEL = LEVELS.length - 1;
  const SPAWN_WEIGHTS = [32, 27, 20, 13, 8];
  const NOTES = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // Pentatonik

  const CFG = window.BLOBBO_CONFIG || {};
  const ONLINE_URL = (CFG.firebaseUrl || '').replace(/\/+$/, '');

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
      const n = this.n = 12 + Math.min(level, 10);
      this.x = new Float32Array(n); this.y = new Float32Array(n);
      this.px = new Float32Array(n); this.py = new Float32Array(n);
      this.rx = new Float32Array(n); this.ry = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.rx[i] = Math.cos(a) * this.R; this.ry[i] = Math.sin(a) * this.R;
        this.x[i] = this.px[i] = x + this.rx[i] * scale;
        this.y[i] = this.py[i] = y + this.ry[i] * scale;
      }
      this.invMass = n / (this.R * this.R);
      this.k = 0.15 - level * 0.008;     // große Blobs sind weicher
      this.cx = x; this.cy = y; this.ang = 0;
      this.age = 0; this.dead = false;
      this.lastVx = 0; this.lastVy = 0; this.prevCx = x; this.prevCy = y;
      this.blink = rand(1, 5); this.surprise = 0; this.wob = rand(0, 6);
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
      const g = GRAVITY * HS * HS;
      for (let i = 0; i < this.n; i++) {
        const vx = (this.x[i] - this.px[i]) * DAMP, vy = (this.y[i] - this.py[i]) * DAMP;
        this.px[i] = this.x[i]; this.py[i] = this.y[i];
        this.x[i] += vx; this.y[i] += vy + g;
      }
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
          const vy = y - this.py[i]; y = H; this.py[i] = y + vy * 0.2;
          this.px[i] = x - (x - this.px[i]) * 0.85;   // Reibung am Boden
        } else if (y < 0) { y = 0; this.py[i] = y; }
        if (x < 0) {
          const vx = x - this.px[i]; x = 0; this.px[i] = x + vx * 0.2;
          this.py[i] = y - (y - this.py[i]) * 0.92;
        } else if (x > W) {
          const vx = x - this.px[i]; x = W; this.px[i] = x + vx * 0.2;
          this.py[i] = y - (y - this.py[i]) * 0.92;
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
      hit = true;
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
    state: 'menu', blobs: [], parts: [], floats: [],
    score: 0, best: store.get('blobbo_best', 0),
    cur: 0, next: 0, cooldown: 0,
    aim: Math.PI / 2, aiming: false,
    danger: 0, warnTick: 0, combo: 0, comboTimer: 0,
    shake: 0, time: 0, maxLevel: 0, overTimer: 0,
  };
  let username = store.get('blobbo_name', '');

  function randomLevel() {
    // am Anfang nur kleine, später bis Stufe 4
    const cap = clamp(G.maxLevel, 2, SPAWN_WEIGHTS.length - 1);
    let tot = 0;
    for (let i = 0; i <= cap; i++) tot += SPAWN_WEIGHTS[i];
    let r = Math.random() * tot;
    for (let i = 0; i <= cap; i++) { r -= SPAWN_WEIGHTS[i]; if (r <= 0) return i; }
    return 0;
  }

  function newGame() {
    G.blobs = []; G.parts = []; G.floats = [];
    G.score = 0; G.cooldown = 0; G.danger = 0; G.combo = 0; G.comboTimer = 0;
    G.maxLevel = 0; G.aim = Math.PI / 2; G.aiming = false; G.overTimer = 0;
    G.cur = randomLevel(); G.next = randomLevel();
    G.state = 'playing';
    updateHud();
    show(null);
    $('hud').classList.remove('hidden');
  }

  function shoot() {
    if (G.state !== 'playing' || G.cooldown > 0) return;
    const dx = Math.cos(G.aim), dy = Math.sin(G.aim);
    const b = new Blob(CANNON.x + dx * 26, CANNON.y + dy * 26, G.cur);
    b.setVel(dx * SHOT_SPEED, dy * SHOT_SPEED);
    b.shot = true;
    G.blobs.push(b);
    G.cur = G.next; G.next = randomLevel();
    G.cooldown = COOLDOWN;
    Sound.shoot();
    vibrate(8);
  }

  function addScore(pts, x, y, color) {
    G.score += pts;
    if (G.score > G.best) { G.best = G.score; store.set('blobbo_best', G.best); }
    G.floats.push({ x, y, t: 0, txt: '+' + pts, c: color });
    updateHud();
  }

  function burst(x, y, color, count, power) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * power;
      G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - power * 0.3, r: rand(2, 6), life: rand(0.4, 0.9), t: 0, c: color });
    }
  }

  function doMerge(a, b) {
    a.dead = b.dead = true;
    const lvl = a.level;
    const cx = (a.cx + b.cx) / 2, cy = (a.cy + b.cy) / 2;
    const vx = ((a.cx - a.prevCx) + (b.cx - b.prevCx)) / 2 / STEP;
    const vy = ((a.cy - a.prevCy) + (b.cy - b.prevCy)) / 2 / STEP;
    G.combo = G.comboTimer > 0 ? G.combo + 1 : 1;
    G.comboTimer = 1.2;
    const mult = Math.min(G.combo, 8);
    if (lvl < MAX_LEVEL) {
      const nl = lvl + 1, R = LEVELS[nl].r;
      const nx = clamp(cx, R + 1, W - R - 1), ny = Math.min(cy, H - R - 1);
      const nb = new Blob(nx, ny, nl, 0.7);
      nb.setVel(vx * 0.4, vy * 0.4 - 120);
      nb.age = 1; nb.surprise = 0.6;
      G.blobs.push(nb);
      G.maxLevel = Math.max(G.maxLevel, nl);
      const pts = ((nl + 1) * (nl + 2)) / 2 * mult;
      addScore(pts, nx, ny - R, LEVELS[nl].c);
      burst(nx, ny, LEVELS[lvl].c, 10 + nl * 3, 120 + nl * 25);
      G.shake = Math.max(G.shake, 1 + nl * 0.9);
      Sound.merge(nl, G.combo);
      vibrate(nl >= 6 ? [20, 30, 20] : 15);
    } else {
      // zwei Riesen = Mega-Bonus, beide verschwinden
      addScore(500 * mult, cx, cy - 60, '#ffffff');
      for (let i = 0; i < 5; i++) burst(cx + rand(-60, 60), cy + rand(-60, 60), LEVELS[i * 2].c, 20, 400);
      G.shake = 14;
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
    const merges = [];
    for (const b of blobs) { b.prevCx = b.cx; b.prevCy = b.cy; }
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < n; i++) blobs[i].integrate();
      for (let it = 0; it < ITER; it++) {
        for (let i = 0; i < n; i++) { blobs[i].shapeMatch(); blobs[i].walls(); }
        for (let i = 0; i < n; i++) {
          const A = blobs[i];
          for (let j = i + 1; j < n; j++) {
            const B = blobs[j];
            const dx = A.cx - B.cx, dy = A.cy - B.cy, rr = (A.R + B.R) * 1.25;
            if (dx * dx + dy * dy > rr * rr) continue;
            const h1 = pushOut(A, B), h2 = pushOut(B, A);
            if ((h1 || h2) && A.level === B.level && !A.dead && !B.dead) merges.push([A, B]);
          }
        }
      }
    }
    for (const b of blobs) b.centroid();
    for (const [a, b] of merges) if (!a.dead && !b.dead) doMerge(a, b);
    if (merges.length) G.blobs = G.blobs.filter((b) => !b.dead);
  }

  function update(dt) {
    G.time += dt;
    if (G.state === 'playing' || G.state === 'over') {
      if (G.state === 'playing') physics();
      G.cooldown = Math.max(0, G.cooldown - dt);
      G.comboTimer = Math.max(0, G.comboTimer - dt);
      if (G.comboTimer === 0) G.combo = 0;

      // Aufprall-Geräusche + Gesichter
      for (const b of G.blobs) {
        b.age += dt;
        const vx = (b.cx - b.prevCx) / dt, vy = (b.cy - b.prevCy) / dt;
        const dv = Math.hypot(vx - b.lastVx, vy - b.lastVy);
        if (G.state === 'playing' && dv > 260 && b.age > 0.05) Sound.squish(dv / 1400);
        b.lastVx = vx; b.lastVy = vy;
        b.blink -= dt; if (b.blink < -0.12) b.blink = rand(2, 6);
        b.surprise = Math.max(0, b.surprise - dt);
      }

      // Gefahrenlinie
      if (G.state === 'playing') {
        let over = false;
        for (const b of G.blobs) if (b.age > 1.2 && b.cy - b.R < DANGER_Y) { over = true; break; }
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
    for (const p of G.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; }
    G.parts = G.parts.filter((p) => p.t < p.life);
    for (const f of G.floats) f.t += dt;
    G.floats = G.floats.filter((f) => f.t < 1);
    G.shake *= 0.88;
  }

  // ---------------------------------------------------------------------------
  // Zeichnen
  // ---------------------------------------------------------------------------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const topPad = 100, botPad = 12;
    scale = Math.min((cw - 16) / W, (ch - topPad - botPad) / H);
    offX = (cw - W * scale) / 2;
    offY = topPad + (ch - topPad - botPad - H * scale) / 2;
  }

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

  function drawFace(c, x, y, R, ang, lookX, lookY, blink, surprise) {
    c.save();
    c.translate(x, y);
    c.rotate(ang * 0.6);
    const er = Math.max(2.6, R * 0.17), sp = R * 0.34, ey = -R * 0.08;
    const open = blink < 0 ? 0.15 : 1;
    let lx = lookX - x, ly = lookY - y;
    const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
    for (const s of [-1, 1]) {
      c.fillStyle = '#fff';
      c.beginPath(); c.ellipse(s * sp, ey, er, er * 1.15 * open, 0, 0, Math.PI * 2); c.fill();
      if (open > 0.5) {
        c.fillStyle = '#231942';
        const pr = er * 0.55;
        c.beginPath(); c.arc(s * sp + lx * er * 0.35, ey + ly * er * 0.4, pr, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(s * sp + lx * er * 0.35 - pr * 0.35, ey + ly * er * 0.4 - pr * 0.4, pr * 0.35, 0, Math.PI * 2); c.fill();
      }
    }
    c.strokeStyle = 'rgba(35,25,66,.85)'; c.fillStyle = 'rgba(35,25,66,.85)';
    c.lineWidth = Math.max(1.6, R * 0.07); c.lineCap = 'round';
    if (surprise > 0) {
      c.beginPath(); c.ellipse(0, R * 0.28, R * 0.1, R * 0.13, 0, 0, Math.PI * 2); c.fill();
    } else {
      c.beginPath(); c.arc(0, R * 0.16, R * 0.17, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    }
    // Bäckchen
    c.fillStyle = 'rgba(255,120,150,.35)';
    c.beginPath(); c.ellipse(-sp * 1.45, R * 0.18, R * 0.12, R * 0.07, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(sp * 1.45, R * 0.18, R * 0.12, R * 0.07, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function drawBlob(c, b) {
    const L = LEVELS[b.level];
    blobPath(c, b);
    const g = c.createRadialGradient(b.cx - b.R * 0.35, b.cy - b.R * 0.4, b.R * 0.1, b.cx, b.cy, b.R * 1.15);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.18, L.c);
    g.addColorStop(1, L.d);
    c.fillStyle = g; c.fill();
    c.lineWidth = 3; c.strokeStyle = L.d; c.stroke();
    // Glanz
    c.fillStyle = 'rgba(255,255,255,.45)';
    c.beginPath(); c.ellipse(b.cx - b.R * 0.42, b.cy - b.R * 0.5, b.R * 0.2, b.R * 0.11, -0.6, 0, Math.PI * 2); c.fill();
    drawFace(c, b.cx, b.cy, b.R, b.ang, CANNON.x, CANNON.y, b.blink, b.surprise);
  }

  // Statischer Blob (für Kanone / Vorschau)
  function drawStatic(c, x, y, level, s = 1, t = 0) {
    const L = LEVELS[level], R = L.r * s;
    const wob = Math.sin(t * 4) * 0.04;
    c.save(); c.translate(x, y); c.scale(1 + wob, 1 - wob);
    const g = c.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.15);
    g.addColorStop(0, '#fff'); g.addColorStop(0.18, L.c); g.addColorStop(1, L.d);
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.lineWidth = 3 * Math.min(1, s + 0.3); c.strokeStyle = L.d; c.stroke();
    c.restore();
    drawFace(c, x, y, R, 0, x, y + 10, 1, 0);
  }

  function drawTrajectory(c) {
    let x = CANNON.x + Math.cos(G.aim) * 26, y = CANNON.y + Math.sin(G.aim) * 26;
    let vx = Math.cos(G.aim) * SHOT_SPEED, vy = Math.sin(G.aim) * SHOT_SPEED;
    const R = LEVELS[G.cur].r, dt = 1 / 60;
    c.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 40; i++) {
      for (let k = 0; k < 2; k++) {
        vy += GRAVITY * dt * 0.5; x += vx * dt * 0.5; y += vy * dt * 0.5;
        if (x < R) { x = R; vx = -vx * 0.3; }
        if (x > W - R) { x = W - R; vx = -vx * 0.3; }
      }
      if (y > H - R) break;
      let hit = false;
      for (const b of G.blobs) { if (Math.hypot(b.cx - x, b.cy - y) < b.R + R * 0.9) { hit = true; break; } }
      if (i % 2 === 0) {
        c.globalAlpha = 1 - i / 44;
        c.beginPath(); c.arc(x, y, 3.2, 0, Math.PI * 2); c.fill();
      }
      if (hit) {
        c.globalAlpha = 0.5;
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.setLineDash([5, 5]);
        c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        break;
      }
    }
    c.globalAlpha = 1;
  }

  function render() {
    const c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Hintergrund
    const bg = c.createLinearGradient(0, 0, 0, ch);
    bg.addColorStop(0, '#2a1f6b'); bg.addColorStop(1, '#130e33');
    c.fillStyle = bg; c.fillRect(0, 0, cw, ch);
    // Deko-Punkte
    c.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 30; i++) {
      const x = (i * 137.5) % cw, y = ((i * 89.3 + G.time * (8 + (i % 5) * 3)) % (ch + 40)) - 20;
      c.beginPath(); c.arc(x, ch - y, 2 + (i % 4) * 2, 0, Math.PI * 2); c.fill();
    }

    const sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
    c.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offX + sx * scale), dpr * (offY + sy * scale));

    // Glas / Kasten
    c.fillStyle = 'rgba(255,255,255,.06)';
    roundRect(c, -6, -6, W + 12, H + 12, 22); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 5;
    roundRect(c, -6, -6, W + 12, H + 12, 22); c.stroke();
    c.save();
    roundRect(c, -3, -3, W + 6, H + 6, 20); c.clip();

    // Gefahrenlinie
    const dangerK = G.danger / DANGER_TIME;
    const pulse = dangerK > 0 ? 0.5 + 0.5 * Math.sin(G.time * 18) : 0;
    if (dangerK > 0) {
      c.fillStyle = `rgba(255,60,80,${0.08 + 0.12 * pulse * dangerK})`;
      c.fillRect(0, 0, W, DANGER_Y);
    }
    c.strokeStyle = dangerK > 0 ? `rgba(255,70,90,${0.6 + 0.4 * pulse})` : 'rgba(255,90,110,.45)';
    c.lineWidth = 3; c.setLineDash([12, 10]);
    c.beginPath(); c.moveTo(0, DANGER_Y); c.lineTo(W, DANGER_Y); c.stroke(); c.setLineDash([]);

    if (G.state === 'playing' && G.aiming) drawTrajectory(c);

    for (const b of G.blobs) drawBlob(c, b);

    // Partikel
    for (const p of G.parts) {
      c.globalAlpha = 1 - p.t / p.life;
      c.fillStyle = p.c;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;

    // Kanone
    if (G.state !== 'menu') {
      c.save(); c.translate(CANNON.x, CANNON.y); c.rotate(G.aim - Math.PI / 2);
      c.fillStyle = '#4c3fb0'; c.strokeStyle = '#1b1640'; c.lineWidth = 3;
      roundRect(c, -18, 0, 36, 44, 10); c.fill(); c.stroke();
      c.fillStyle = '#6c5ce7';
      roundRect(c, -22, 36, 44, 12, 6); c.fill(); c.stroke();
      c.restore();
      c.fillStyle = '#3a2f86'; c.strokeStyle = '#1b1640'; c.lineWidth = 3;
      c.beginPath(); c.arc(CANNON.x, CANNON.y, 30, 0, Math.PI * 2); c.fill(); c.stroke();
      const ready = 1 - G.cooldown / COOLDOWN;
      const sc = Math.min(1, 25 / LEVELS[G.cur].r) * (0.6 + 0.4 * ready);
      drawStatic(c, CANNON.x, CANNON.y, G.cur, sc, G.time);
      // Nächster
      c.fillStyle = 'rgba(255,255,255,.1)';
      c.beginPath(); c.arc(W - 40, 46, 26, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '700 11px Fredoka, sans-serif'; c.textAlign = 'center';
      c.fillText('NÄCHSTER', W - 40, 88);
      drawStatic(c, W - 40, 46, G.next, Math.min(1, 18 / LEVELS[G.next].r), G.time + 1);
    }

    // Punkte-Texte
    c.textAlign = 'center';
    for (const f of G.floats) {
      c.globalAlpha = 1 - f.t;
      c.font = '700 26px Fredoka, sans-serif';
      c.lineWidth = 5; c.strokeStyle = '#1b1640';
      c.strokeText(f.txt, f.x, f.y - f.t * 50);
      c.fillStyle = f.c; c.fillText(f.txt, f.x, f.y - f.t * 50);
    }
    c.globalAlpha = 1;

    if (dangerK > 0 && G.state === 'playing') {
      c.font = '700 40px Fredoka, sans-serif'; c.lineWidth = 6; c.strokeStyle = '#1b1640';
      const t = Math.ceil(DANGER_TIME - G.danger);
      c.strokeText(String(t), W / 2, DANGER_Y - 16); c.fillStyle = '#ff5c74'; c.fillText(String(t), W / 2, DANGER_Y - 16);
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
    const rs = LEVELS.map((L) => Math.sqrt(L.r) * 2.2);
    const gap = 2, total = rs.reduce((a, r) => a + r * 2 + gap, 0) - gap;
    const f = Math.min(1, 312 / total, 26 / rs[rs.length - 1]);
    let x = (320 - total * f) / 2;
    for (let i = 0; i < LEVELS.length; i++) {
      const rr = rs[i] * f;
      drawStatic(c, x + rr, 28, i, rr / LEVELS[i].r);
      x += rr * 2 + gap * f;
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
    local() { return store.get('blobbo_scores', []); },
    addLocal(name, score) {
      const list = this.local();
      const entry = { name, score, ts: Date.now() };
      list.push(entry);
      list.sort((a, b) => b.score - a.score);
      const top = list.slice(0, 50);
      store.set('blobbo_scores', top);
      return top.indexOf(entry);
    },
    async submit(name, score) {
      if (!ONLINE_URL || score <= 0) return;
      await fetch(ONLINE_URL + '/scores.json', {
        method: 'POST',
        body: JSON.stringify({ name, score, ts: { '.sv': 'timestamp' } }),
      });
    },
    async online() {
      const res = await fetch(ONLINE_URL + '/scores.json?orderBy=%22score%22&limitToLast=100');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return Object.values(data || {})
        .filter((e) => e && typeof e.name === 'string' && typeof e.score === 'number')
        .sort((a, b) => b.score - a.score);
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
      renderList([], 'Weltweite Rangliste ist noch nicht eingerichtet (siehe README). Lokale Bestenliste unter „Dieses Gerät“.');
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
    $('best').textContent = G.best.toLocaleString('de-DE');
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
    const rank = Board.addLocal(username, G.score);
    $('finalScore').textContent = G.score.toLocaleString('de-DE');
    let info = G.score >= G.best && G.score > 0 ? '🎉 Neuer Rekord!' : 'Rekord: ' + G.best.toLocaleString('de-DE');
    if (rank >= 0 && rank < 10) info += ' · Platz ' + (rank + 1) + ' auf diesem Gerät';
    $('overInfo').textContent = info;
    setTimeout(() => { if (G.state === 'over') show('over'); }, 900);
    if (ONLINE_URL) {
      try {
        await Board.submit(username, G.score);
        const list = await Board.online();
        const pos = list.findIndex((e) => e.name === username && e.score === G.score);
        if (pos >= 0) $('overInfo').textContent = info + ' · Weltweit Platz ' + (pos + 1);
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
    if (Sound.ctx) Sound.ctx.suspend();
  }
  function resume() {
    if (G.state !== 'paused') return;
    if (Sound.ctx) Sound.ctx.resume();
    G.state = 'playing';
    show(null);
  }
  function toMenu() {
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
  G.cur = 0; G.next = 1;
  requestAnimationFrame(loop);

  // für Tests
  window.__blobbo = { G, LEVELS, Blob };
})();
