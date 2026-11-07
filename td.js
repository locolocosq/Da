'use strict';
(() => {
  const { $, rand, clamp, store, vibrate, fmt } = Kit;

  // ---------------------------------------------------------------------------
  // Karte: 8 × 12 Felder, der Weg schlängelt sich von oben nach unten
  // ---------------------------------------------------------------------------
  const COLS = 8, ROWS = 12;
  const WP = [[1, -1], [1, 2], [6, 2], [6, 5], [1, 5], [1, 8], [6, 8], [6, 12.5]];
  const PATH = WP.map(([c, r]) => ({ x: c + 0.5, y: r + 0.5 }));
  const SEG = [];
  let PATH_LEN = 0;
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i], b = PATH[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    SEG.push({ a, b, len, start: PATH_LEN }); PATH_LEN += len;
  }
  const onPath = new Set();
  for (let i = 0; i < WP.length - 1; i++) {
    const [c1, r1] = WP[i], [c2, r2] = WP[i + 1];
    const steps = Math.ceil(Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1)));
    for (let k = 0; k <= steps; k++) {
      const c = Math.round(c1 + (c2 - c1) * k / steps), r = Math.round(r1 + (r2 - r1) * k / steps);
      if (r >= 0 && r < ROWS) onPath.add(c + ',' + r);
    }
  }
  function posAt(d) {
    for (const s of SEG) {
      if (d <= s.start + s.len) { const k = (d - s.start) / s.len; return { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k }; }
    }
    return { x: PATH[PATH.length - 1].x, y: PATH[PATH.length - 1].y };
  }

  // ---------------------------------------------------------------------------
  // Türme & Gegner
  // ---------------------------------------------------------------------------
  const TOWERS = {
    cannon: { name: 'Kanone', icon: '🔫', cost: 50, range: 2.3, rate: 1.4, dmg: 9, color: '#4d8df7', shot: 8 },
    ice: { name: 'Eis', icon: '❄️', cost: 70, range: 1.8, rate: 1.0, dmg: 3, splash: 0.9, slow: 0.45, color: '#7fd4ff', shot: 6 },
    bomb: { name: 'Bombe', icon: '💣', cost: 90, range: 2.2, rate: 0.55, dmg: 26, splash: 1.0, color: '#ff9f43', shot: 5 },
    laser: { name: 'Laser', icon: '⚡', cost: 140, range: 3.3, rate: 0.5, dmg: 85, color: '#ff5fa2', beam: true },
  };
  const MAX_LVL = 4;
  function stats(t) {
    const b = TOWERS[t.type], l = t.lvl - 1;
    return {
      range: b.range + l * 0.25, rate: b.rate * Math.pow(1.12, l), dmg: b.dmg * Math.pow(1.75, l),
      splash: b.splash ? b.splash + l * 0.1 : 0, slow: b.slow ? Math.min(0.7, b.slow + l * 0.07) : 0,
    };
  }
  const upCost = (t) => Math.round(TOWERS[t.type].cost * (0.75 + 0.5 * t.lvl));

  const ENEMIES = {
    normal: { hp: 1, speed: 1.0, gold: 4, r: 0.28, c: '#8ce99a', d: '#2f9246' },
    fast: { hp: 0.55, speed: 1.9, gold: 3, r: 0.22, c: '#ffd93d', d: '#b89317' },
    tank: { hp: 3.6, speed: 0.6, gold: 9, r: 0.36, c: '#b197fc', d: '#6145c4' },
    swarm: { hp: 0.3, speed: 1.35, gold: 1, r: 0.17, c: '#ff8787', d: '#bd3b3b' },
    boss: { hp: 28, speed: 0.45, gold: 70, r: 0.46, c: '#ff5fa2', d: '#b53b70' },
  };
  const baseHp = (w) => 16 * Math.pow(1.17, w - 1) + w * 2;

  function waveList(w) {
    const list = [];
    const n = Math.round(7 + w * 1.4);
    for (let i = 0; i < n; i++) {
      let t = 'normal';
      const r = Math.random();
      if (w >= 3 && r < 0.25) t = 'fast';
      else if (w >= 5 && r < 0.4) t = 'tank';
      list.push({ t, gap: t === 'fast' ? 0.5 : 0.8 });
    }
    if (w >= 4 && w % 3 === 1) for (let i = 0; i < 10 + w; i++) list.push({ t: 'swarm', gap: 0.22 });
    if (w % 10 === 0) list.push({ t: 'boss', gap: 1.5 });
    return list;
  }

  // ---------------------------------------------------------------------------
  // Sound
  // ---------------------------------------------------------------------------
  const S = Kit.sound((S, ctx) => {
    const bpm = 96, st = 60 / bpm / 2;
    const prog = [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -2, 2]];
    let step = 0, next = ctx.currentTime + 0.1;
    setInterval(() => {
      if (ctx.state !== 'running') return;
      while (next < ctx.currentTime + 0.25) {
        const d = next - ctx.currentTime, bar = Math.floor(step / 8) % 4, s = step % 8, ch = prog[bar];
        S.tone(220 * Math.pow(2, ch[s % 3] / 12) * (s >= 4 ? 2 : 1), st * 0.9, 'triangle', 0.04, null, d, S.mus);
        if (s === 0) S.tone(110 * Math.pow(2, ch[0] / 12) / 2, st * 3.5, 'sine', 0.16, null, d, S.mus);
        if (s % 2 === 0) S.hiss(0.03, 0.02, 7000, 'highpass', d, S.mus);
        next += st; step++;
      }
    }, 60);
  });
  const sfx = {
    cannon() { if (S.throttle('c', 60)) { S.tone(rand(500, 600), 0.06, 'square', 0.03, 200); } },
    ice() { if (S.throttle('i', 80)) { S.tone(1600, 0.12, 'sine', 0.04, 2400); S.hiss(0.08, 0.03, 6000, 'highpass'); } },
    bomb() { if (S.throttle('b', 80)) { S.tone(90, 0.3, 'sine', 0.25, 40); S.hiss(0.25, 0.15, 500, 'lowpass'); } },
    laser() { if (S.throttle('l', 80)) S.tone(1200, 0.22, 'sawtooth', 0.04, 300); },
    pop() { if (S.throttle('p', 40)) S.tone(rand(400, 700), 0.07, 'sine', 0.08, 150); },
    build() { S.tone(330, 0.08, 'square', 0.06); S.tone(495, 0.12, 'square', 0.06, null, 0.06); },
    up() { [0, 4, 7, 12].forEach((n, i) => S.tone(440 * Math.pow(2, n / 12), 0.14, 'triangle', 0.12, null, i * 0.05)); },
    sell() { S.tone(880, 0.08, 'sine', 0.1); S.tone(660, 0.12, 'sine', 0.1, null, 0.07); },
    leak() { S.tone(200, 0.3, 'sawtooth', 0.08, 80); },
    wave() { S.tone(196, 0.5, 'sawtooth', 0.07, 220); S.tone(294, 0.5, 'sawtooth', 0.05, 330); },
    clear() { [0, 4, 7, 12].forEach((n, i) => S.tone(523 * Math.pow(2, n / 12), 0.25, 'triangle', 0.12, null, i * 0.08)); },
    no() { S.tone(160, 0.12, 'square', 0.05); },
  };

  // ---------------------------------------------------------------------------
  // Zustand
  // ---------------------------------------------------------------------------
  const canvas = $('game'), ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1, T = 40, ox = 0, oy = 0;
  const G = {
    state: 'menu', gold: 0, lives: 20, wave: 0, kills: 0, inWave: false, queue: [], spawnT: 0,
    towers: [], enemies: [], shots: [], fx: [], floats: [], sel: null, build: null, speed: 1, time: 0,
  };
  const score = () => G.wave * 100 + G.kills * 2 - (G.inWave ? 100 : 0);

  function newGame() {
    Object.assign(G, { state: 'playing', gold: 150, lives: 20, wave: 0, kills: 0, inWave: false, queue: [], spawnT: 0,
      towers: [], enemies: [], shots: [], fx: [], floats: [], sel: null, build: null, speed: 1 });
    $('tdhud').classList.remove('hidden'); $('shop').classList.remove('hidden');
    $('btnSpeed').textContent = '1×';
    ui();
    banner('Bau deine Türme!', 'Dann starte die erste Welle', 2.2);
  }

  function startWave() {
    if (G.state !== 'playing' || G.inWave) return;
    G.wave++; G.inWave = true;
    G.queue = waveList(G.wave); G.spawnT = 0.3;
    banner('WELLE ' + G.wave, G.wave % 10 === 0 ? '⚠️ BOSS!' : '', 1.3);
    sfx.wave(); vibrate(20);
    ui();
  }

  function spawn(t) {
    const e = ENEMIES[t], hp = baseHp(G.wave) * e.hp;
    G.enemies.push({ t, hp, maxHp: hp, speed: e.speed, d: 0, slowT: 0, slowK: 0, r: e.r, wob: rand(0, 6), gold: Math.round(e.gold * (1 + G.wave * 0.025)) });
  }

  function hurt(e, dmg) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    if (e.hp <= 0) {
      G.gold += e.gold; G.kills++;
      const p = posAt(e.d);
      G.floats.push({ x: p.x, y: p.y, t: 0, txt: '+' + e.gold });
      for (let i = 0; i < 8; i++) G.fx.push({ x: p.x, y: p.y, vx: rand(-2, 2), vy: rand(-2.5, 0.5), r: rand(0.04, 0.09), t: 0, life: rand(0.3, 0.6), c: ENEMIES[e.t].c });
      sfx.pop();
    }
  }

  function step(dt) {
    G.time += dt;
    // Gegner erscheinen
    if (G.inWave && G.queue.length) {
      G.spawnT -= dt;
      if (G.spawnT <= 0) { const q = G.queue.shift(); spawn(q.t); G.spawnT = q.gap; }
    }
    // Gegner bewegen
    for (const e of G.enemies) {
      if (e.hp <= 0) continue;
      const k = e.slowT > 0 ? 1 - e.slowK : 1;
      e.slowT = Math.max(0, e.slowT - dt);
      e.d += e.speed * k * dt;
      if (e.d >= PATH_LEN) {
        e.hp = 0; e.leaked = true;
        G.lives -= e.t === 'boss' ? 5 : 1;
        sfx.leak(); vibrate(30);
        if (G.lives <= 0) { G.lives = 0; gameOver(); return; }
      }
    }
    // Türme schießen
    for (const t of G.towers) {
      const s = stats(t);
      t.cd -= dt;
      let target = null;
      for (const e of G.enemies) {
        if (e.hp <= 0) continue;
        const p = posAt(e.d);
        if (Math.hypot(p.x - t.x, p.y - t.y) <= s.range && (!target || e.d > target.d)) target = e;
      }
      if (!target) continue;
      const tp = posAt(target.d);
      t.angle = Math.atan2(tp.y - t.y, tp.x - t.x);
      if (t.cd > 0) continue;
      t.cd = 1 / s.rate;
      const b = TOWERS[t.type];
      if (b.beam) {
        hurt(target, s.dmg);
        G.fx.push({ beam: true, x: t.x, y: t.y, x2: tp.x, y2: tp.y, t: 0, life: 0.15, c: b.color });
        sfx.laser();
      } else {
        G.shots.push({ x: t.x + Math.cos(t.angle) * 0.35, y: t.y + Math.sin(t.angle) * 0.35, target, dmg: s.dmg, splash: s.splash, slow: s.slow, speed: b.shot, c: b.color, type: t.type });
        sfx[t.type]();
      }
    }
    // Geschosse
    for (const sh of G.shots) {
      const tp = sh.target.hp > 0 ? posAt(sh.target.d) : { x: sh.lx, y: sh.ly };
      if (sh.target.hp > 0) { sh.lx = tp.x; sh.ly = tp.y; }
      if (tp.x === undefined) { sh.done = true; continue; }
      const dx = tp.x - sh.x, dy = tp.y - sh.y, d = Math.hypot(dx, dy), mv = sh.speed * dt;
      if (d <= mv) {
        sh.done = true;
        if (sh.splash) {
          for (const e of G.enemies) {
            if (e.hp <= 0) continue;
            const p = posAt(e.d);
            if (Math.hypot(p.x - tp.x, p.y - tp.y) <= sh.splash) {
              hurt(e, sh.dmg);
              if (sh.slow) { e.slowT = 1.6; e.slowK = Math.max(e.slowK * (e.slowT > 0 ? 1 : 0), sh.slow); }
            }
          }
          G.fx.push({ ring: true, x: tp.x, y: tp.y, r: sh.splash, t: 0, life: 0.3, c: sh.c });
          if (sh.type === 'bomb') G.shake = Math.max(G.shake || 0, 3);
        } else hurt(sh.target, sh.dmg);
      } else { sh.x += dx / d * mv; sh.y += dy / d * mv; }
    }
    G.shots = G.shots.filter((s) => !s.done);
    G.enemies = G.enemies.filter((e) => e.hp > 0);
    // Welle vorbei?
    if (G.inWave && !G.queue.length && !G.enemies.length) {
      G.inWave = false;
      const bonus = 20 + G.wave * 6;
      G.gold += bonus;
      banner('Welle ' + G.wave + ' geschafft!', '+' + bonus + ' 💰 Bonus', 1.6);
      sfx.clear();
    }
    for (const f of G.fx) { f.t += dt; if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 6 * dt; } }
    G.fx = G.fx.filter((f) => f.t < f.life);
    for (const f of G.floats) f.t += dt;
    G.floats = G.floats.filter((f) => f.t < 0.9);
  }

  function update(dt) {
    if (G.state === 'playing') {
      const n = G.speed;
      for (let i = 0; i < n; i++) { step(dt); if (G.state !== 'playing') break; }
      ui();
    }
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').classList.add('hidden'); }
    G.shake = (G.shake || 0) * 0.85;
  }

  let bannerT = 0;
  function banner(big, small, t) {
    const el = $('banner'); el.textContent = big;
    if (small) { const s = document.createElement('small'); s.textContent = small; el.appendChild(s); }
    el.classList.remove('hidden'); bannerT = t;
  }

  // ---------------------------------------------------------------------------
  // Bauen & Verbessern
  // ---------------------------------------------------------------------------
  const towerAt = (c, r) => G.towers.find((t) => t.c === c && t.r === r);
  function tap(px, py) {
    const c = Math.floor((px - ox) / T), r = Math.floor((py - oy) / T);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) { G.sel = null; ui(); return; }
    const t = towerAt(c, r);
    if (t) { G.sel = t; G.build = null; S.click(); ui(); return; }
    if (G.build && !onPath.has(c + ',' + r)) {
      const b = TOWERS[G.build];
      if (G.gold < b.cost) { sfx.no(); hint('Nicht genug Gold'); return; }
      G.gold -= b.cost;
      G.towers.push({ type: G.build, c, r, x: c + 0.5, y: r + 0.5, lvl: 1, cd: 0, angle: -Math.PI / 2, spent: b.cost, born: G.time });
      sfx.build(); vibrate(10);
      if (G.gold < b.cost) G.build = null;
      ui(); return;
    }
    G.sel = null; ui();
  }
  function upgrade() {
    const t = G.sel; if (!t || t.lvl >= MAX_LVL) return;
    const c = upCost(t);
    if (G.gold < c) { sfx.no(); return; }
    G.gold -= c; t.spent += c; t.lvl++; t.born = G.time;
    sfx.up(); vibrate(15); ui();
  }
  function sell() {
    const t = G.sel; if (!t) return;
    G.gold += Math.round(t.spent * 0.7);
    G.towers = G.towers.filter((x) => x !== t); G.sel = null;
    sfx.sell(); ui();
  }

  let hintT = 0;
  function hint(txt) { $('tdhint').textContent = txt; $('tdhint').classList.remove('hidden'); clearTimeout(hintT); hintT = setTimeout(() => $('tdhint').classList.add('hidden'), 1400); }

  // ---------------------------------------------------------------------------
  // Oberfläche
  // ---------------------------------------------------------------------------
  function ui() {
    $('hLives').textContent = G.lives;
    $('hGold').textContent = fmt(G.gold);
    $('hWave').textContent = G.wave;
    const wb = $('btnWave');
    if (wb) {
      wb.disabled = G.inWave;
      wb.textContent = G.inWave ? '⏳ läuft' : '▶ Welle ' + (G.wave + 1);
      wb.classList.toggle('pulse', !G.inWave && G.towers.length > 0);
    }
    for (const b of document.querySelectorAll('.shopbtn')) {
      b.classList.toggle('sel', G.build === b.dataset.t);
      b.classList.toggle('poor', G.gold < TOWERS[b.dataset.t].cost);
    }
    const t = G.sel;
    $('tpanel').classList.toggle('hidden', !t);
    if (t) {
      const s = stats(t), b = TOWERS[t.type];
      $('tpName').textContent = b.icon + ' ' + b.name;
      $('tpLvl').textContent = 'Stufe ' + t.lvl + (t.lvl >= MAX_LVL ? ' (max)' : '');
      $('tpInfo').textContent = 'Schaden ' + fmt(s.dmg) + ' · Reichweite ' + s.range.toFixed(1) + ' · ' + s.rate.toFixed(1) + '/s' + (s.slow ? ' · bremst ' + Math.round(s.slow * 100) + '%' : '');
      const c = upCost(t);
      $('tpUp').disabled = t.lvl >= MAX_LVL || G.gold < c;
      $('tpUp').textContent = t.lvl >= MAX_LVL ? 'Maximal' : '⬆ ' + c + ' 💰';
      $('tpSell').textContent = '💰 +' + Math.round(t.spent * 0.7);
    }
  }

  // Wellen-Button in die HUD-Leiste
  (() => {
    const b = document.createElement('button');
    b.id = 'btnWave'; b.textContent = '▶ Welle 1';
    $('tdhud').insertBefore(b, $('btnSpeed'));
    b.onclick = () => { S.init(); startWave(); };
  })();
  for (const b of document.querySelectorAll('.shopbtn')) {
    b.onclick = () => {
      S.init();
      const t = b.dataset.t;
      G.build = G.build === t ? null : t; G.sel = null;
      S.click();
      if (G.build) hint('Tippe auf ein freies Grasfeld');
      ui();
    };
  }
  $('btnSpeed').onclick = () => { G.speed = G.speed >= 3 ? 1 : G.speed + 1; $('btnSpeed').textContent = G.speed + '×'; S.click(); };
  $('tpUp').onclick = upgrade;
  $('tpSell').onclick = sell;
  canvas.addEventListener('pointerdown', (e) => { S.init(); if (G.state === 'playing') { e.preventDefault(); tap(e.clientX, e.clientY); } });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // Zeichnen
  // ---------------------------------------------------------------------------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const top = 64, bot = 96;
    T = Math.floor(Math.min((cw - 12) / COLS, (ch - top - bot) / ROWS));
    ox = Math.round((cw - T * COLS) / 2);
    oy = Math.round(top + (ch - top - bot - T * ROWS) / 2);
  }

  function blob(x, y, r, c, d, t, hpK) {
    const sq = Math.sin(t) * 0.06;
    ctx.save(); ctx.translate(x, y); ctx.scale(1 + sq, 1 - sq);
    ctx.fillStyle = c; ctx.strokeStyle = d; ctx.lineWidth = Math.max(1.5, r * 0.15);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.35, r * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.05, r * 0.2, 0, Math.PI * 2); ctx.arc(r * 0.3, -r * 0.05, r * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#231942';
    ctx.beginPath(); ctx.arc(-r * 0.27, 0, r * 0.1, 0, Math.PI * 2); ctx.arc(r * 0.33, 0, r * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (hpK < 1) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - r, y - r - 7, r * 2, 4);
      ctx.fillStyle = hpK > 0.5 ? '#51cf66' : hpK > 0.25 ? '#ffd43b' : '#ff6b6b'; ctx.fillRect(x - r, y - r - 7, r * 2 * hpK, 4);
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1640'; ctx.fillRect(0, 0, cw, ch);
    const sh = G.shake || 0;
    ctx.save(); ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    // Gras
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = ox + c * T, y = oy + r * T;
      if (onPath.has(c + ',' + r)) continue;
      ctx.fillStyle = (c + r) % 2 ? '#2f8f5b' : '#36a065';
      ctx.fillRect(x, y, T, T);
    }
    // Weg
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#b08850'; ctx.lineWidth = T * 0.92;
    ctx.beginPath(); PATH.forEach((p, i) => { const x = ox + p.x * T, y = oy + p.y * T; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    ctx.strokeStyle = '#d9b77c'; ctx.lineWidth = T * 0.72;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2; ctx.setLineDash([T * 0.2, T * 0.3]);
    ctx.lineDashOffset = -G.time * T * 0.8; ctx.stroke(); ctx.setLineDash([]);
    // Ziel
    const end = PATH[PATH.length - 1];
    ctx.font = Math.round(T * 0.6) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏰', ox + end.x * T, oy + (ROWS - 0.5) * T);

    // Reichweite
    const showR = G.sel;
    if (showR) {
      const s = stats(showR);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox + showR.x * T, oy + showR.y * T, s.range * T, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // Bau-Raster
    if (G.build) {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (onPath.has(c + ',' + r) || towerAt(c, r)) continue;
        ctx.strokeRect(ox + c * T + 3, oy + r * T + 3, T - 6, T - 6);
      }
    }
    // Türme
    for (const t of G.towers) {
      const x = ox + t.x * T, y = oy + t.y * T, b = TOWERS[t.type];
      const pop = Math.max(0, 1 - (G.time - t.born) * 4) * 0.25;
      ctx.save(); ctx.translate(x, y); ctx.scale(1 + pop, 1 + pop);
      ctx.fillStyle = '#4a4560'; ctx.strokeStyle = '#2b2838'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-T * 0.42, -T * 0.42, T * 0.84, T * 0.84, T * 0.18) : ctx.rect(-T * 0.42, -T * 0.42, T * 0.84, T * 0.84); ctx.fill(); ctx.stroke();
      ctx.rotate(t.angle);
      ctx.fillStyle = b.color; ctx.fillRect(0, -T * 0.08, T * 0.42, T * 0.16);
      ctx.beginPath(); ctx.arc(0, 0, T * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.font = Math.round(T * 0.32) + 'px sans-serif';
      ctx.fillText(b.icon, x, y + 1);
      // Stufe
      for (let i = 0; i < t.lvl; i++) { ctx.fillStyle = '#ffd93d'; ctx.beginPath(); ctx.arc(x - T * 0.3 + i * T * 0.2, y + T * 0.36, T * 0.05, 0, Math.PI * 2); ctx.fill(); }
    }
    // Gegner
    for (const e of G.enemies) {
      const p = posAt(e.d), E = ENEMIES[e.t];
      blob(ox + p.x * T, oy + p.y * T, e.r * T, e.slowT > 0 ? '#a5d8ff' : E.c, E.d, G.time * 8 + e.wob, e.hp / e.maxHp);
    }
    // Geschosse & Effekte
    for (const s of G.shots) { ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(ox + s.x * T, oy + s.y * T, T * (s.type === 'bomb' ? 0.11 : 0.07), 0, Math.PI * 2); ctx.fill(); }
    for (const f of G.fx) {
      const k = 1 - f.t / f.life;
      ctx.globalAlpha = Math.max(0, k);
      if (f.beam) { ctx.strokeStyle = f.c; ctx.lineWidth = T * 0.1 * k + 1; ctx.beginPath(); ctx.moveTo(ox + f.x * T, oy + f.y * T); ctx.lineTo(ox + f.x2 * T, oy + f.y2 * T); ctx.stroke(); }
      else if (f.ring) { ctx.strokeStyle = f.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ox + f.x * T, oy + f.y * T, f.r * T * (1.2 - k * 0.5), 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(ox + f.x * T, oy + f.y * T, f.r * T, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    ctx.font = '700 ' + Math.round(T * 0.36) + 'px Fredoka, sans-serif';
    for (const f of G.floats) {
      ctx.globalAlpha = 1 - f.t / 0.9;
      ctx.fillStyle = '#ffd93d'; ctx.fillText(f.txt, ox + f.x * T, oy + (f.y - f.t * 0.8) * T);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  const B = Kit.board('td', 'td_scores');
  const screens = Kit.screens({
    S, B,
    start: newGame,
    onPause: () => { if (G.state !== 'playing') return false; G.state = 'paused'; return true; },
    onResume: () => { if (G.state === 'paused') G.state = 'playing'; },
    onMenu: () => { G.state = 'menu'; G.enemies = []; G.towers = []; $('tdhud').classList.add('hidden'); $('shop').classList.add('hidden'); $('tpanel').classList.add('hidden'); },
  });
  function gameOver() {
    G.state = 'over'; G.sel = null; G.build = null; ui();
    screens.finish(Math.max(0, score()), 'Welle ' + G.wave + ' erreicht', 'td_best');
  }

  window.addEventListener('resize', resize);
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt); render();
    requestAnimationFrame(loop);
  }
  resize(); ui();
  requestAnimationFrame(loop);
  window.__td = { G, step, startWave, TOWERS, onPath, stats, upCost, COLS, ROWS, posAt, PATH_LEN };
})();
