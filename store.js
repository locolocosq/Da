// Kostenlose Online-Speicher ohne Konto. Eine Rangliste wird als "anbieter:id" angegeben.
window.BlobboStore = (() => {
  const J = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const ok = async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; };
  const P = {
    ec: {
      name: 'extendsclass.com',
      async create(data) {
        const r = await ok(await fetch('https://json.extendsclass.com/bin', { method: 'POST', headers: J, body: JSON.stringify(data) }));
        const j = await r.json(); if (!j.id) throw new Error('keine id'); return j.id;
      },
      async read(id) { return (await ok(await fetch('https://json.extendsclass.com/bin/' + id, { headers: { Accept: 'application/json' }, cache: 'no-store' }))).json(); },
      async write(id, data) { await ok(await fetch('https://json.extendsclass.com/bin/' + id, { method: 'PUT', headers: J, body: JSON.stringify(data) })); },
    },
    ra: {
      name: 'restful-api.dev',
      async create(data) {
        const r = await ok(await fetch('https://api.restful-api.dev/objects', { method: 'POST', headers: J, body: JSON.stringify({ name: 'blobbo', data }) }));
        const j = await r.json(); if (!j.id) throw new Error('keine id'); return j.id;
      },
      async read(id) { const j = await (await ok(await fetch('https://api.restful-api.dev/objects/' + id, { cache: 'no-store' }))).json(); return j.data; },
      async write(id, data) { await ok(await fetch('https://api.restful-api.dev/objects/' + id, { method: 'PUT', headers: J, body: JSON.stringify({ name: 'blobbo', data }) })); },
    },
    jb: {
      name: 'jsonblob.com',
      async create(data) {
        const r = await ok(await fetch('https://jsonblob.com/api/jsonBlob', { method: 'POST', headers: J, body: JSON.stringify(data) }));
        const id = r.headers.get('X-jsonblob') || (r.headers.get('Location') || '').split('/').pop();
        if (!id) throw new Error('keine id'); return id;
      },
      async read(id) { return (await ok(await fetch('https://jsonblob.com/api/jsonBlob/' + id, { headers: { Accept: 'application/json' }, cache: 'no-store' }))).json(); },
      async write(id, data) { await ok(await fetch('https://jsonblob.com/api/jsonBlob/' + id, { method: 'PUT', headers: J, body: JSON.stringify(data) })); },
    },
  };
  function parse(key) {
    const m = /^([a-z]{2}):([A-Za-z0-9_-]{1,80})$/.exec(String(key || '').trim());
    return m && P[m[1]] ? { p: P[m[1]], id: m[2] } : null;
  }
  return {
    providers: P,
    parse,
    async read(key) { const k = parse(key); return k.p.read(k.id); },
    async write(key, data) { const k = parse(key); return k.p.write(k.id, data); },
  };
})();
