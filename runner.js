'use strict';
(() => {
  // ---------------------------------------------------------------------------
  // Grundlagen
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } },
  };
  const CFG = window.BLOBBO_CONFIG || {};
  const STORE_KEY = window.BlobboStore && window.BlobboStore.parse(CFG.leaderboard) ? CFG.leaderboard : '';
  const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* egal */ } };

  // Zahlen kurz anzeigen: 1234 -> 1.2K
  function fmt(n) {
    n = Math.floor(n);
    if (n < 1000) return String(n);
    if (!isFinite(n)) return '∞';
    const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    if (n >= 1e36) return n.toExponential(1).replace('+', '');
    let i = -1;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return (n < 10 ? n.toFixed(1) : Math.floor(n)) + u[i];
  }

  // ---------------------------------------------------------------------------
  // Spielwerte
  // ---------------------------------------------------------------------------
  const SPEED = 34;          // Laufgeschwindigkeit (Welt-Einheiten/s)
  const RANGE = 120;         // Schussweite
  const ROW_GAP = 90;        // Abstand der Reihen
  const ROWS_PER_SEG = 6;    // Reihen bis zur nächsten Welle
  const ENEMY_SPEED = 30;
  const Z0 = 55;             // Perspektive
  const FAR = 520;
  const WAVE_K = 28;

  // erwartete Stärke vor Welle i (daran richten sich Tore und Gegner)
  // Welle i: Gegneranzahl = Truppstärke zu Beginn des Abschnitts × K(i).
  // Wer im Abschnitt gute Tore nimmt, ist bei der Welle deutlich stärker.
  const K = (i) => WAVE_K * Math.pow(1.25, i - 1);
  const EHP = (i) => Math.pow(1.15, i - 1);       // Lebenspunkte pro Gegner
  const EN = (i) => Math.max(G.segN, 10);           // Bezugsgröße für Tore und Gegner

  // ---------------------------------------------------------------------------
  // Audio (synthetisiert)
  // ---------------------------------------------------------------------------
  const Sound = {
    ctx: null, sfxOn: store.get('blobbo_sfx', true), musOn: store.get('blobbo_music', true), last: {},
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
      this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(comp);
      this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxOn ? 1 : 0; this.sfx.connect(this.master);
      this.mus = ctx.createGain(); this.mus.gain.value = this.musOn ? 0.5 : 0; this.mus.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.startMusic();
    },
    setSfx(on) { this.sfxOn = on; store.set('blobbo_sfx', on); if (this.sfx) this.sfx.gain.value = on ? 1 : 0; },
    setMusic(on) { this.musOn = on; store.set('blobbo_music', on); if (this.mus) this.mus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.1); },
    throttle(k, ms) { const t = performance.now(); if (t - (this.last[k] || 0) < ms) return false; this.last[k] = t; return true; },
    tone(f, dur, type, vol, slide, delay = 0, dest) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
    },
    hiss(dur, vol, f, type = 'bandpass', delay = 0, dest) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + delay, s = this.ctx.createBufferSource(), fl = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = this.noise; fl.type = type; fl.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl); fl.connect(g); g.connect(dest || this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
    },
    shot() { if (this.throttle('shot', 70)) { this.tone(rand(700, 900), 0.05, 'square', 0.025, 300); this.hiss(0.04, 0.03, 3000); } },
    gate(good) {
      if (good) [0, 4, 7, 12].forEach((n, i) => this.tone(523 * Math.pow(2, n / 12), 0.18, 'triangle', 0.13, null, i * 0.05));
      else [0, -3, -7].forEach((n, i) => this.tone(330 * Math.pow(2, n / 12), 0.2, 'sawtooth', 0.06, null, i * 0.07));
    },
    upgrade() { [0, 7, 12, 19].forEach((n, i) => this.tone(659 * Math.pow(2, n / 12), 0.2, 'sine', 0.12, null, i * 0.06)); },
    crack() { if (this.throttle('crack', 90)) this.hiss(0.06, 0.05, 1200); },
    wallBreak() { this.hiss(0.5, 0.35, 600, 'lowpass'); this.tone(90, 0.4, 'sine', 0.3, 40); },
    hit() { if (this.throttle('hit', 60)) { this.tone(140, 0.2, 'sine', 0.25, 50); this.hiss(0.15, 0.12, 500); } },
    pop() { if (this.throttle('pop', 50)) this.tone(rand(300, 500), 0.06, 'sine', 0.06, 120); },
    horn() { this.tone(110, 0.9, 'sawtooth', 0.09, 98); this.tone(165, 0.9, 'sawtooth', 0.06, 147); this.tone(55, 1.0, 'sine', 0.25); },
    win() { [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone(392 * Math.pow(2, n / 12), 0.35, 'triangle', 0.13, null, i * 0.07)); },
    over() { [7, 4, 0, -5].forEach((n, i) => this.tone(330 * Math.pow(2, n / 12), 0.35, 'triangle', 0.18, null, i * 0.16)); },
    click() { this.tone(660, 0.06, 'sine', 0.12, 880); },
    startMusic() {
      const ctx = this.ctx, bpm = 124, st = 60 / bpm / 2;
      const bass = [0, 0, 12, 0, 3, 3, 15, 3, 5, 5, 17, 5, 3, 3, 15, 2];
      let step = 0, next = ctx.currentTime + 0.1;
      setInterval(() => {
        if (ctx.state !== 'running') return;
        while (next < ctx.currentTime + 0.25) {
          const d = next - ctx.currentTime, s = step % 16;
          if (s % 4 === 0) this.tone(120, 0.18, 'sine', 0.35, 45, d, this.mus);                // Kick
          if (s % 4 === 2) this.hiss(0.05, 0.05, 8000, 'highpass', d, this.mus);               // Hi-Hat
          if (s === 4 || s === 12) this.hiss(0.12, 0.08, 1800, 'bandpass', d, this.mus);       // Snare
          this.tone(55 * Math.pow(2, bass[s] / 12), st * 0.9, 'square', 0.035, null, d, this.mus);
          if (Math.floor(step / 32) % 2 === 1 && s % 2 === 0) this.tone(440 * Math.pow(2, [0, 3, 7, 10, 12, 10, 7, 3][s / 2] / 12), st * 0.8, 'triangle', 0.025, null, d, this.mus);
          next += st; step++;
        }
      }, 60);
    },
  };

  // ---------------------------------------------------------------------------
  // Zustand
  // ---------------------------------------------------------------------------
  const canvas = $('game'), ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1, horizonY = 0, bottomY = 0, laneW = 0;
  let username = store.get('blobbo_name', '');
  const G = {
    state: 'menu', phase: 'run', N: 10, dmg: 1, rate: 1, lane: 0, x: 0, dist: 0, wave: 1, waves: 0,
    objs: [], enemies: [], parts: [], floats: [], tracers: [], time: 0, segN: 10, fireAcc: 0, shake: 0, best: store.get('horde_best', 0),
  };

  function score() { return Math.floor(G.dist / 4) + G.waves * 150; }

  // ---------------------------------------------------------------------------
  // Strecke erzeugen
  // ---------------------------------------------------------------------------
  function gate(lane, z, op, v, wall) {
    const good = op === '+' || op === 'x' || op === 'dmg' || op === 'rate';
    return { type: 'gate', lane, z, op, v, good, wallHp: wall || 0, wallMax: wall || 0, row: z };
  }

  function gateRow(z, i) {
    const n = Math.max(G.N, 10), power = Math.max(G.N, 10) * G.dmg * G.rate;
    const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
    const out = [];
    const roll = Math.random();
    // eine starke Mauer-Option?
    if (roll < 0.45) {
      const big = Math.random() < 0.06 ? 99 : Math.random() < 0.3 ? 20 : Math.random() < 0.6 ? 10 : 5;
      const sec = big === 99 ? 3.2 : big === 20 ? 2.6 : big === 10 ? 2.0 : 1.3;  // Sekunden Dauerfeuer
      out.push(gate(lanes[0], z, 'x', big, Math.max(10, Math.round(power * sec))));
    } else {
      out.push(gate(lanes[0], z, 'x', Math.random() < 0.7 ? 2 : 3));
    }
    out.push(gate(lanes[1], z, '+', Math.max(3, Math.round(n * rand(0.25, 0.7)))));
    out.push(Math.random() < 0.5
      ? gate(lanes[2], z, '-', Math.max(2, Math.round(n * rand(0.2, 0.5))))
      : gate(lanes[2], z, '/', 2));
    return out;
  }

  function upgradeRow(z, i) {
    const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
    return [
      gate(lanes[0], z, 'dmg', 1.25),
      gate(lanes[1], z, 'rate', 1.2),
      Math.random() < 0.5 ? gate(lanes[2], z, '-', Math.max(2, Math.round(Math.max(G.N, 10) * rand(0.2, 0.4)))) : gate(lanes[2], z, '+', Math.max(3, Math.round(Math.max(G.N, 10) * 0.3))),
    ];
  }

  function squadRow(z, i) {
    const lanes = [-1, 0, 1].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.5 ? 1 : 2);
    return lanes.map((l) => ({ type: 'squad', lane: l, z, n: Math.max(3, Math.round(Math.max(G.N, 10) * rand(0.15, 0.4))), hp: EHP(i) }));
  }

  function spawnSegment(startZ) {
    const i = G.wave;
    G.segN = Math.max(G.N, 1);
    const plan = ['gate', 'squad', 'gate', 'up', 'gate', Math.random() < 0.5 ? 'squad' : 'gate'];
    plan.forEach((t, k) => {
      const z = startZ + k * ROW_GAP;
      const row = t === 'gate' ? gateRow(z, i) : t === 'up' ? upgradeRow(z, i) : squadRow(z, i);
      G.objs.push(...row);
    });
    G.objs.push({ type: 'wave', lane: 9, z: startZ + ROWS_PER_SEG * ROW_GAP + 20 });
  }

  function startWave() {
    G.phase = 'wave';
    const i = G.wave, total = EN(i) * K(i), k = 4 + Math.min(i, 8);
    G.enemies = [];
    for (let s = 0; s < k; s++) {
      G.enemies.push({ x: pick([-1, 0, 1]) + rand(-0.2, 0.2), z: 260 + s * rand(28, 42), n: Math.max(2, total / k * rand(0.7, 1.3)), hp: EHP(i) });
    }
    if (i % 5 === 0) G.enemies.push({ x: 0, z: 260 + k * 40, n: total * 0.6, hp: EHP(i) * 2, boss: true });
    banner('WELLE ' + i, 'Halte sie auf!', 1.8);
    Sound.horn(); vibrate([40, 60, 40]);
  }

  // ---------------------------------------------------------------------------
  // Spielablauf
  // ---------------------------------------------------------------------------
  function newGame() {
    Object.assign(G, { state: 'playing', phase: 'run', N: 10, dmg: 1, rate: 1, lane: 0, x: 0, dist: 0, wave: 1, waves: 0,
      objs: [], enemies: [], parts: [], floats: [], tracers: [], fireAcc: 0, shake: 0 });
    spawnSegment(160);
    show(null);
    $('rhud').classList.remove('hidden');
    hud();
    banner('LOS!', 'Wähl die richtigen Tore', 1.2);
  }

  function applyGate(o) {
    const before = G.N;
    if (o.op === '+') G.N += o.v;
    else if (o.op === '-') G.N -= o.v;
    else if (o.op === 'x') G.N *= o.v;
    else if (o.op === '/') G.N = Math.ceil(G.N / o.v);
    else if (o.op === 'dmg') G.dmg *= o.v;
    else if (o.op === 'rate') G.rate *= o.v;
    if (o.op === 'dmg' || o.op === 'rate') { Sound.upgrade(); floatText(o.op === 'dmg' ? '🔫 +25%' : '⚡ +20%', '#ffd93d'); }
    else {
      Sound.gate(o.good);
      const d = Math.floor(G.N) - Math.floor(before);
      floatText((d >= 0 ? '+' : '−') + fmt(Math.abs(d)), o.good ? '#7fd4ff' : '#ff5c74');
    }
    vibrate(o.good ? 12 : [20, 30, 20]);
  }

  function loseUnits(k, x, z) {
    const lost = Math.min(G.N, k);
    G.N -= lost;
    if (lost >= 1) {
      floatText('−' + fmt(lost), '#ff5c74');
      const p = proj(x, z);
      for (let i = 0; i < Math.min(30, 4 + lost); i++) G.parts.push({ x: p.x + rand(-30, 30), y: p.y + rand(-20, 10), vx: rand(-120, 120), vy: rand(-220, -60), r: rand(2, 5), t: 0, life: rand(0.4, 0.8), c: '#4d8df7' });
      Sound.hit(); G.shake = Math.max(G.shake, 6);
    }
  }

  function damageTarget(t, dmg) {
    if (t.type === 'gate') {
      t.wallHp -= dmg;
      Sound.crack();
      if (t.wallHp <= 0) {
        t.wallHp = 0;
        Sound.wallBreak(); G.shake = Math.max(G.shake, 8); vibrate(25);
        const p = proj(t.lane, t.z);
        for (let i = 0; i < 24; i++) G.parts.push({ x: p.x + rand(-40, 40), y: p.y - rand(0, 40), vx: rand(-200, 200), vy: rand(-300, -50), r: rand(3, 7), t: 0, life: rand(0.5, 1), c: '#b0a7c8' });
      }
    } else {
      const kill = Math.min(t.n, dmg / t.hp);
      t.n -= kill;
      if (Math.random() < 0.3) Sound.pop();
    }
  }

  function findTarget() {
    if (G.phase === 'wave') {
      let best = null;
      for (const e of G.enemies) if (e.z < RANGE + 60 && (!best || e.z < best.z)) best = e;
      return best;
    }
    let best = null;
    for (const o of G.objs) {
      if (o.z <= 0 || o.z > RANGE || Math.abs(o.lane - G.x) > 0.55) continue;
      if ((o.type === 'gate' && o.wallHp > 0) || o.type === 'squad') if (!best || o.z < best.z) best = o;
    }
    return best;
  }

  function update(dt) {
    G.time += dt;
    if (G.state !== 'playing') { stepFx(dt); return; }
    G.x += (G.lane - G.x) * Math.min(1, dt * 12);

    // Schießen
    const t = findTarget();
    if (t && G.N >= 1) {
      const dps = Math.floor(G.N) * G.dmg * G.rate;
      damageTarget(t, dps * dt);
      G.fireAcc += dt * Math.min(25, 4 + Math.sqrt(G.N) * 2);
      while (G.fireAcc > 1) {
        G.fireAcc -= 1;
        const tx = t.type ? t.lane : t.x;
        G.tracers.push({ x0: G.x + rand(-0.25, 0.25), z0: 2, x1: tx + rand(-0.2, 0.2), z1: t.z, t: 0 });
        Sound.shot();
      }
    }

    if (G.phase === 'run') {
      const dz = SPEED * dt;
      G.dist += dz;
      for (const o of G.objs) o.z -= dz;
      // erreicht
      const here = Math.round(G.x);
      for (const o of G.objs) {
        if (o.z > 0 || o.done) continue;
        o.done = true;
        if (o.type === 'wave') { startWave(); continue; }
        if (o.lane !== here) continue;
        if (o.type === 'gate') {
          if (o.wallHp > 0) { loseUnits(Math.ceil(G.N * 0.35), o.lane, 0); banner('MAUER!', 'Zu spät kaputtgeschossen', 0.9); }
          else applyGate(o);
        } else if (o.type === 'squad' && o.n >= 1) {
          loseUnits(Math.ceil(o.n * o.hp / G.dmg), o.lane, 0);
        }
      }
      G.objs = G.objs.filter((o) => !o.done && (o.type !== 'squad' || o.n >= 1));
    } else {
      // Welle
      for (const e of G.enemies) {
        e.z -= ENEMY_SPEED * dt;
        if (e.z < 140) e.x += (G.x - e.x) * Math.min(1, dt * 0.8);
        if (e.z <= 3 && e.n >= 1) { loseUnits(Math.ceil(e.n * e.hp / G.dmg), e.x, 3); e.n = 0; }
      }
      G.enemies = G.enemies.filter((e) => e.n >= 1);
      if (!G.enemies.length && G.N >= 1) {
        G.waves++; G.wave++;
        G.phase = 'run';
        G.objs = [];
        spawnSegment(140);
        banner('GESCHAFFT!', 'Welle ' + (G.wave - 1) + ' überstanden', 1.6);
        Sound.win(); vibrate([20, 40, 20]);
      }
    }

    if (G.N < 1) { G.N = 0; gameOver(); }
    stepFx(dt);
    hud();
  }

  function stepFx(dt) {
    for (const p of G.parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 700 * dt; }
    G.parts = G.parts.filter((p) => p.t < p.life);
    for (const f of G.floats) f.t += dt;
    G.floats = G.floats.filter((f) => f.t < 1.1);
    for (const tr of G.tracers) tr.t += dt * 6;
    G.tracers = G.tracers.filter((tr) => tr.t < 1);
    G.shake *= 0.86;
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.add('hidden'); }
  }

  function floatText(txt, c) { G.floats.push({ txt, c, t: 0, x: G.x }); }

  let bannerT = 0;
  function banner(big, small, t) {
    const el = $('banner');
    el.textContent = big;
    if (small) { const s = document.createElement('small'); s.textContent = small; el.appendChild(s); }
    el.classList.remove('hidden');
    bannerT = t;
  }

  // ---------------------------------------------------------------------------
  // Zeichnen
  // ---------------------------------------------------------------------------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    horizonY = ch * 0.24;
    bottomY = ch * 0.84;
    laneW = Math.min(cw * 0.46, 230) / 1.5;
  }
  function proj(x, z) {
    const s = Z0 / (Z0 + Math.max(z, -Z0 * 0.6));
    return { x: cw / 2 + x * laneW * s, y: horizonY + (bottomY - horizonY) * s, s };
  }

  function drawPeople(cx, cy, s, count, color, dark, t) {
    const n = Math.min(Math.floor(count), 90);
    const rr = Math.max(1.6, 5.5 * s);
    const spread = 6.2 * s;
    for (let i = n - 1; i >= 0; i--) {
      const a = i * 2.39996, d = Math.sqrt(i) * spread;
      const x = cx + Math.cos(a) * d * 1.25, y = cy + Math.sin(a) * d * 0.55;
      const bob = Math.abs(Math.sin(t * 12 + i)) * 2 * s;
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(x, y - rr * 0.9 - bob, rr * 0.75, rr * 1.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y - rr * 2.3 - bob, rr * 0.8, 0, Math.PI * 2); ctx.fill();
    }
    return Math.sqrt(Math.max(n, 1)) * spread;
  }

  function label(txt, x, y, size, color) {
    ctx.font = '700 ' + Math.round(size) + 'px Fredoka, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size * 0.18); ctx.strokeStyle = 'rgba(10,8,30,.9)';
    ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
  }

  function gateText(o) {
    if (o.op === '+') return '+' + fmt(o.v);
    if (o.op === '-') return '−' + fmt(o.v);
    if (o.op === 'x') return '×' + o.v;
    if (o.op === '/') return '÷' + o.v;
    if (o.op === 'dmg') return '🔫+25%';
    return '⚡+20%';
  }

  function drawGate(o) {
    const p = proj(o.lane, o.z), w = laneW * p.s * 0.92, h = 120 * p.s;
    const left = p.x - w / 2;
    const up = o.op === 'dmg' || o.op === 'rate';
    const col = up ? '255,217,61' : o.good ? '77,160,255' : '255,77,109';
    ctx.fillStyle = 'rgba(' + col + ',.32)';
    ctx.fillRect(left, p.y - h, w, h);
    ctx.fillStyle = 'rgba(' + col + ',.95)';
    ctx.fillRect(left - 3 * p.s, p.y - h - 4 * p.s, 6 * p.s, h + 4 * p.s);
    ctx.fillRect(left + w - 3 * p.s, p.y - h - 4 * p.s, 6 * p.s, h + 4 * p.s);
    ctx.fillRect(left - 3 * p.s, p.y - h - 6 * p.s, w + 6 * p.s, 7 * p.s);
    label(gateText(o), p.x, p.y - h * 0.55, Math.max(10, 46 * p.s), '#fff');
    if (o.wallHp > 0) {
      // Mauer davor
      const q = proj(o.lane, o.z - 6), ww = laneW * q.s * 0.96, wh = 62 * q.s;
      const wl = q.x - ww / 2;
      ctx.fillStyle = '#6d6589'; ctx.fillRect(wl, q.y - wh, ww, wh);
      ctx.strokeStyle = '#4a4363'; ctx.lineWidth = Math.max(1, 2 * q.s);
      const bh = wh / 4;
      for (let r = 0; r < 4; r++) {
        const y = q.y - wh + r * bh;
        ctx.beginPath(); ctx.moveTo(wl, y); ctx.lineTo(wl + ww, y); ctx.stroke();
        const off = r % 2 ? ww / 6 : 0;
        for (let c = off; c < ww; c += ww / 3) { ctx.beginPath(); ctx.moveTo(wl + c, y); ctx.lineTo(wl + c, y + bh); ctx.stroke(); }
      }
      // Lebensbalken
      const k = o.wallHp / o.wallMax;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(wl, q.y - wh - 14 * q.s, ww, 8 * q.s);
      ctx.fillStyle = '#ff5c74'; ctx.fillRect(wl, q.y - wh - 14 * q.s, ww * k, 8 * q.s);
      label('🧱 ' + fmt(Math.ceil(o.wallHp)), q.x, q.y - wh * 0.5, Math.max(9, 30 * q.s), '#fff');
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sk = ctx.createLinearGradient(0, 0, 0, horizonY);
    sk.addColorStop(0, '#15103a'); sk.addColorStop(1, '#3a2f86');
    ctx.fillStyle = sk; ctx.fillRect(0, 0, cw, horizonY + 1);
    // Sterne
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(G.time * 1.3 + i);
      ctx.fillRect((i * 137.5) % cw, (i * 53.3) % (horizonY - 10), 2, 2);
    }
    ctx.globalAlpha = 1;
    // Boden
    const gr = ctx.createLinearGradient(0, horizonY, 0, ch);
    gr.addColorStop(0, '#1d4a49'); gr.addColorStop(1, '#0f2b33');
    ctx.fillStyle = gr; ctx.fillRect(0, horizonY, cw, ch - horizonY);

    const sx = (Math.random() - 0.5) * G.shake, sy = (Math.random() - 0.5) * G.shake;
    ctx.save(); ctx.translate(sx, sy);

    // Straße
    const a = proj(-1.6, FAR), b = proj(1.6, FAR), c = proj(1.6, -20), d = proj(-1.6, -20);
    ctx.fillStyle = '#2b2838';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(d.x, d.y); ctx.moveTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    // Spurlinien (laufen mit)
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    const off = G.dist % 30;
    for (const lx of [-0.5, 0.5]) {
      for (let z = -off; z < FAR; z += 30) {
        const p1 = proj(lx, z), p2 = proj(lx, z + 14);
        const w1 = 3 * p1.s;
        ctx.beginPath(); ctx.moveTo(p1.x - w1, p1.y); ctx.lineTo(p1.x + w1, p1.y); ctx.lineTo(p2.x + w1 * 0.5, p2.y); ctx.lineTo(p2.x - w1 * 0.5, p2.y); ctx.fill();
      }
    }

    // Objekte, weit weg zuerst
    const items = [];
    for (const o of G.objs) if (o.z < FAR && o.z > -10 && o.type !== 'wave') items.push(o);
    for (const e of G.enemies) if (e.z < FAR) items.push(e);
    items.sort((p, q) => q.z - p.z);
    for (const o of items) {
      if (o.type === 'gate') drawGate(o);
      else {
        const x = o.type ? o.lane : o.x, p = proj(x, o.z);
        const big = o.boss ? 1.8 : 1;
        const rad = drawPeople(p.x, p.y, p.s * big, o.n, '#ff8a8a', '#c9372c', G.time);
        label(fmt(Math.ceil(o.n)), p.x, p.y - rad * 0.55 - 30 * p.s * big, Math.max(10, 30 * p.s * big), '#ff8a8a');
        if (o.boss) label('BOSS', p.x, p.y - rad * 0.55 - 62 * p.s * big, Math.max(10, 22 * p.s * big), '#ffd93d');
      }
    }

    // Schüsse
    ctx.strokeStyle = '#ffe066'; ctx.lineCap = 'round';
    for (const tr of G.tracers) {
      const k = tr.t, x = tr.x0 + (tr.x1 - tr.x0) * k, z = tr.z0 + (tr.z1 - tr.z0) * k;
      const p1 = proj(x, z), p2 = proj(x - (tr.x1 - tr.x0) * 0.06, z - (tr.z1 - tr.z0) * 0.06);
      ctx.lineWidth = Math.max(1, 3 * p1.s);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y - 22 * p1.s); ctx.lineTo(p2.x, p2.y - 22 * p2.s); ctx.stroke();
    }

    // eigener Trupp
    if (G.state !== 'menu') {
      const p = proj(G.x, 0);
      const rad = drawPeople(p.x, p.y, p.s, Math.max(G.N, 0), '#9fd0ff', '#2f6fd6', G.time);
      const ly = p.y - rad * 0.55 - 34 * p.s;
      ctx.fillStyle = '#4d8df7';
      const t = fmt(G.N), w = 18 + t.length * 13;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x - w / 2, ly - 16, w, 32, 10) : ctx.rect(p.x - w / 2, ly - 16, w, 32); ctx.fill();
      label(t, p.x, ly + 1, 24, '#fff');
      for (const f of G.floats) {
        ctx.globalAlpha = Math.max(0, 1 - f.t);
        label(f.txt, proj(f.x, 0).x, ly - 30 - f.t * 60, 28, f.c);
      }
      ctx.globalAlpha = 1;
    }

    for (const p of G.parts) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Wellen-Fortschritt
    if (G.state === 'playing' && G.phase === 'wave') {
      const left = G.enemies.reduce((s, e) => s + e.n, 0);
      label('Gegner: ' + fmt(left), cw / 2, horizonY + 24, 20, '#ff8a8a');
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & Eingabe
  // ---------------------------------------------------------------------------
  function hud() {
    $('hWave').textContent = G.wave;
    $('hDist').textContent = fmt(G.dist / 4);
    $('hScore').textContent = score().toLocaleString('de-DE');
    $('hDmg').textContent = '🔫 ' + G.dmg.toFixed(1);
    $('hRate').textContent = '⚡ ' + G.rate.toFixed(1);
  }

  function laneFromX(px) { return px < cw / 3 ? -1 : px > (cw * 2) / 3 ? 1 : 0; }
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    if (G.state !== 'playing') return;
    e.preventDefault();
    dragging = true;
    G.lane = laneFromX(e.clientX);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
  });
  canvas.addEventListener('pointermove', (e) => { if (dragging && G.state === 'playing') G.lane = laneFromX(e.clientX); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  window.addEventListener('keydown', (e) => {
    if (G.state !== 'playing') return;
    if (e.key === 'ArrowLeft' || e.key === 'a') G.lane = Math.max(-1, G.lane - 1);
    if (e.key === 'ArrowRight' || e.key === 'd') G.lane = Math.min(1, G.lane + 1);
  });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // Rangliste (eigene Liste "runner" im gleichen Online-Speicher)
  // ---------------------------------------------------------------------------
  function cleanName(s) { return String(s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16); }
  const Board = {
    local() { return store.get('horde_scores', []); },
    addLocal(name, sc) {
      const list = this.local(), entry = { name, score: sc, ts: Date.now() };
      list.push(entry); list.sort((a, b) => b.score - a.score);
      const top = list.slice(0, 50); store.set('horde_scores', top);
      return top.indexOf(entry);
    },
    clean(list) {
      const best = new Map();
      for (const e of Array.isArray(list) ? list : []) {
        if (!e || typeof e.name !== 'string' || typeof e.score !== 'number' || !isFinite(e.score)) continue;
        const name = cleanName(e.name), sc = Math.max(0, Math.min(99999999, Math.floor(e.score)));
        if (!name) continue;
        const old = best.get(name);
        if (!old || sc > old.score) best.set(name, { name, score: sc, ts: Number(e.ts) || 0 });
      }
      return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 200);
    },
    async online() { const d = await BlobboStore.read(STORE_KEY); return this.clean((d && d.runner) || []); },
    async submit(name, sc) {
      const d = (await BlobboStore.read(STORE_KEY)) || {};
      const list = this.clean(d.runner || []);
      list.push({ name, score: sc, ts: Date.now() });
      await BlobboStore.write(STORE_KEY, Object.assign({}, d, { runner: this.clean(list) }));
    },
  };
  let boardTab = STORE_KEY ? 'online' : 'local', boardReturn = 'menu';
  function renderList(list, msg) {
    const ol = $('boardList'); ol.textContent = '';
    if (msg || !list.length) {
      const li = document.createElement('li'); li.className = 'empty';
      li.textContent = msg || 'Noch keine Einträge – sei der Erste!'; ol.appendChild(li); return;
    }
    let me = false;
    list.slice(0, 100).forEach((e, i) => {
      const li = document.createElement('li');
      if (!me && username && e.name === username) { li.className = 'me'; me = true; }
      const r = document.createElement('span'); r.className = 'rank'; r.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
      const n = document.createElement('span'); n.className = 'name'; n.textContent = e.name;
      const p = document.createElement('span'); p.className = 'pts'; p.textContent = e.score.toLocaleString('de-DE');
      li.append(r, n, p); ol.appendChild(li);
    });
  }
  async function openBoard(from) {
    boardReturn = from; show('board');
    $('tabOnline').classList.toggle('active', boardTab === 'online');
    $('tabLocal').classList.toggle('active', boardTab === 'local');
    if (boardTab === 'local') { renderList(Board.local()); return; }
    if (!STORE_KEY) { renderList([], 'Die weltweite Rangliste ist noch nicht eingerichtet.'); return; }
    renderList([], 'Lade…');
    try { renderList(await Board.online()); } catch (e) { renderList([], 'Keine Verbindung zur Rangliste 😕'); }
  }

  // ---------------------------------------------------------------------------
  // Bildschirme
  // ---------------------------------------------------------------------------
  const screens = ['menu', 'pause', 'over', 'board'];
  function show(id) { for (const s of screens) $(s).classList.toggle('hidden', s !== id); }
  function soundLabels() {
    $('btnMusic').textContent = '🎵 Musik: ' + (Sound.musOn ? 'an' : 'aus');
    $('btnSfx').textContent = '🔊 Effekte: ' + (Sound.sfxOn ? 'an' : 'aus');
    $('btnSound').textContent = Sound.sfxOn || Sound.musOn ? '🔊' : '🔇';
  }

  async function gameOver() {
    G.state = 'over';
    Sound.over(); vibrate([60, 50, 120]);
    const sc = score();
    const isBest = sc > G.best;
    if (isBest) { G.best = sc; store.set('horde_best', sc); }
    const rank = Board.addLocal(username, sc);
    $('finalScore').textContent = sc.toLocaleString('de-DE');
    let info = (isBest ? '🎉 Neuer Rekord! · ' : 'Rekord: ' + G.best.toLocaleString('de-DE') + ' · ') + 'Welle ' + G.wave + ' erreicht';
    if (rank >= 0 && rank < 10) info += ' · Platz ' + (rank + 1) + ' auf diesem Gerät';
    $('overInfo').textContent = info;
    setTimeout(() => { if (G.state === 'over') show('over'); }, 1000);
    if (STORE_KEY && sc > 0) {
      try {
        await Board.submit(username, sc);
        const list = await Board.online();
        const pos = list.findIndex((e) => e.name === username);
        if (pos >= 0) $('overInfo').textContent = info + ' · Weltweit Platz ' + (pos + 1) + ' (dein Bestwert)';
      } catch (e) { /* offline */ }
    }
  }

  function startFromMenu() {
    const name = cleanName($('nameInput').value);
    if (!name) { $('nameInput').focus(); $('nameInput').style.borderColor = '#ff6b81'; return; }
    username = name; store.set('blobbo_name', name);
    $('nameInput').blur();
    Sound.init(); Sound.click();
    newGame();
  }
  function pause() {
    if (G.state !== 'playing') return;
    G.state = 'paused'; show('pause');
    if (Sound.ctx) Sound.ctx.suspend();
  }
  function resume() {
    if (G.state !== 'paused') return;
    if (Sound.ctx) Sound.ctx.resume();
    G.state = 'playing'; show(null);
  }
  function toMenu() {
    G.state = 'menu'; G.objs = []; G.enemies = [];
    $('rhud').classList.add('hidden'); $('banner').classList.add('hidden');
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
  $('btnSound').onclick = () => { Sound.init(); const on = !(Sound.sfxOn || Sound.musOn); Sound.setSfx(on); Sound.setMusic(on); soundLabels(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G.state !== 'paused') update(dt);
    render();
    requestAnimationFrame(loop);
  }
  resize(); soundLabels(); hud();
  requestAnimationFrame(loop);

  window.__horde = { G, EN, startWave, update, setLane: (l) => { G.lane = l; } };
})();
