'use strict';
// Gemeinsame Bausteine für alle Spiele im Katalog: Speicher, Zahlen, Sound, Rangliste, Menüs.
window.Kit = (() => {
  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* egal */ } },
  };
  const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* egal */ } };
  const cleanName = (s) => String(s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  function fmt(n) {
    n = Math.floor(n);
    if (!isFinite(n)) return '∞';
    if (n < 1000) return String(n);
    const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
    if (n >= 1e21) return n.toExponential(1).replace('+', '');
    let i = -1;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return (n < 10 ? n.toFixed(1) : Math.floor(n)) + u[i];
  }

  // Sound: synthetisiert, keine Dateien. music(S, ctx) plant die Hintergrundmusik.
  function sound(music) {
    const S = {
      ctx: null, sfxOn: store.get('blobbo_sfx', true), musOn: store.get('blobbo_music', true), last: {},
      init() {
        if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = S.ctx = new AC();
        const comp = ctx.createDynamicsCompressor(); comp.connect(ctx.destination);
        S.master = ctx.createGain(); S.master.gain.value = 0.9; S.master.connect(comp);
        S.sfx = ctx.createGain(); S.sfx.gain.value = S.sfxOn ? 1 : 0; S.sfx.connect(S.master);
        S.mus = ctx.createGain(); S.mus.gain.value = S.musOn ? 0.5 : 0; S.mus.connect(S.master);
        S.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = S.noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        if (music) music(S, ctx);
      },
      setSfx(on) { S.sfxOn = on; store.set('blobbo_sfx', on); if (S.sfx) S.sfx.gain.value = on ? 1 : 0; },
      setMusic(on) { S.musOn = on; store.set('blobbo_music', on); if (S.mus) S.mus.gain.setTargetAtTime(on ? 0.5 : 0, S.ctx.currentTime, 0.1); },
      throttle(k, ms) { const t = performance.now(); if (t - (S.last[k] || 0) < ms) return false; S.last[k] = t; return true; },
      tone(f, dur, type, vol, slide, delay = 0, dest) {
        if (!S.ctx) return;
        const t = S.ctx.currentTime + delay, o = S.ctx.createOscillator(), g = S.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(dest || S.sfx); o.start(t); o.stop(t + dur + 0.05);
      },
      hiss(dur, vol, f, type = 'bandpass', delay = 0, dest) {
        if (!S.ctx) return;
        const t = S.ctx.currentTime + delay, s = S.ctx.createBufferSource(), fl = S.ctx.createBiquadFilter(), g = S.ctx.createGain();
        s.buffer = S.noise; fl.type = type; fl.frequency.value = f;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(fl); fl.connect(g); g.connect(dest || S.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
      },
      click() { S.tone(660, 0.06, 'sine', 0.12, 880); },
      over() { [7, 4, 0, -5].forEach((n, i) => S.tone(330 * Math.pow(2, n / 12), 0.35, 'triangle', 0.18, null, i * 0.16)); },
    };
    return S;
  }

  // Rangliste: lokal pro Gerät + weltweit (eigenes Feld im gemeinsamen Online-Speicher)
  function board(field, localKey) {
    const CFG = window.BLOBBO_CONFIG || {};
    const KEY = window.BlobboStore && window.BlobboStore.parse(CFG.leaderboard) ? CFG.leaderboard : '';
    const B = {
      online: !!KEY,
      local() { return store.get(localKey, []); },
      addLocal(name, score) {
        const list = B.local(), entry = { name, score, ts: Date.now() };
        list.push(entry); list.sort((a, b) => b.score - a.score);
        const top = list.slice(0, 50); store.set(localKey, top);
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
      async fetchOnline() { const d = await BlobboStore.read(KEY); return B.clean((d && d[field]) || []); },
      async submit(name, score) {
        if (!KEY || score <= 0) return;
        const d = (await BlobboStore.read(KEY)) || {};
        const list = B.clean(d[field] || []);
        list.push({ name, score, ts: Date.now() });
        await BlobboStore.write(KEY, Object.assign({}, d, { [field]: B.clean(list) }));
      },
    };
    return B;
  }

  // Standard-Menüs (menu, pause, over, board) verdrahten
  function screens(opts) {
    const { S, B, start, onPause, onResume, onMenu } = opts;
    let username = store.get('blobbo_name', '');
    const ids = ['menu', 'pause', 'over', 'board'];
    const show = (id) => { for (const s of ids) $(s).classList.toggle('hidden', s !== id); };
    const labels = () => {
      $('btnMusic').textContent = '🎵 Musik: ' + (S.musOn ? 'an' : 'aus');
      $('btnSfx').textContent = '🔊 Effekte: ' + (S.sfxOn ? 'an' : 'aus');
      if ($('btnSound')) $('btnSound').textContent = S.sfxOn || S.musOn ? '🔊' : '🔇';
    };
    let tab = B.online ? 'online' : 'local', back = 'menu';
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
      back = from; show('board');
      $('tabOnline').classList.toggle('active', tab === 'online');
      $('tabLocal').classList.toggle('active', tab === 'local');
      if (tab === 'local') { renderList(B.local()); return; }
      if (!B.online) { renderList([], 'Die weltweite Rangliste ist noch nicht eingerichtet.'); return; }
      renderList([], 'Lade…');
      try { renderList(await B.fetchOnline()); } catch (e) { renderList([], 'Keine Verbindung zur Rangliste 😕'); }
    }
    function play() {
      const name = cleanName($('nameInput').value);
      if (!name) { $('nameInput').focus(); $('nameInput').style.borderColor = '#ff6b81'; return; }
      username = name; store.set('blobbo_name', name);
      $('nameInput').blur(); S.init(); S.click();
      show(null); start();
    }
    async function finish(score, extra, bestKey) {
      S.over(); vibrate([60, 50, 120]);
      const best = store.get(bestKey, 0), isBest = score > best;
      if (isBest) store.set(bestKey, score);
      const rank = B.addLocal(username, score);
      $('finalScore').textContent = score.toLocaleString('de-DE');
      let info = (isBest ? '🎉 Neuer Rekord!' : 'Rekord: ' + best.toLocaleString('de-DE')) + (extra ? ' · ' + extra : '');
      if (rank >= 0 && rank < 10) info += ' · Platz ' + (rank + 1) + ' auf diesem Gerät';
      $('overInfo').textContent = info;
      setTimeout(() => show('over'), 900);
      if (B.online && score > 0) {
        try {
          await B.submit(username, score);
          const pos = (await B.fetchOnline()).findIndex((e) => e.name === username);
          if (pos >= 0) $('overInfo').textContent = info + ' · Weltweit Platz ' + (pos + 1) + ' (dein Bestwert)';
        } catch (e) { /* offline */ }
      }
    }
    $('nameInput').value = username;
    $('nameInput').addEventListener('input', (e) => { e.target.style.borderColor = ''; });
    $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
    $('btnPlay').onclick = play;
    $('btnBoardMenu').onclick = () => { S.init(); S.click(); openBoard('menu'); };
    $('btnBoardOver').onclick = () => { S.click(); openBoard('over'); };
    $('btnBoardBack').onclick = () => { S.click(); show(back); };
    $('tabOnline').onclick = () => { tab = 'online'; openBoard(back); };
    $('tabLocal').onclick = () => { tab = 'local'; openBoard(back); };
    $('btnAgain').onclick = () => { S.click(); show(null); start(); };
    $('btnOverMenu').onclick = () => { S.click(); onMenu(); show('menu'); };
    $('btnResume').onclick = () => { if (S.ctx) S.ctx.resume(); show(null); onResume(); };
    $('btnRestart').onclick = () => { if (S.ctx) S.ctx.resume(); show(null); start(); };
    $('btnToMenu').onclick = () => { if (S.ctx) S.ctx.resume(); onMenu(); show('menu'); };
    $('btnMusic').onclick = () => { S.init(); S.setMusic(!S.musOn); labels(); };
    $('btnSfx').onclick = () => { S.init(); S.setSfx(!S.sfxOn); labels(); S.click(); };
    if ($('btnSound')) $('btnSound').onclick = () => { S.init(); const on = !(S.sfxOn || S.musOn); S.setSfx(on); S.setMusic(on); labels(); };
    if ($('btnPause')) $('btnPause').onclick = () => { S.click(); if (onPause()) { show('pause'); if (S.ctx) S.ctx.suspend(); } };
    document.addEventListener('visibilitychange', () => { if (document.hidden && onPause()) { show('pause'); if (S.ctx) S.ctx.suspend(); } });
    labels();
    return { show, finish, get username() { return username; } };
  }

  return { $, rand, clamp, store, vibrate, cleanName, fmt, sound, board, screens };
})();
