const SCWRCareers = (() => {
  const careers = {};
  const ranks = {};
  const reading = new Map();
  const signatures = new Map();
  const requests = new Map();
  const line = [];
  let nextId = 0;
  let turning = false;
  let priority = () => new Set();
  let changed = () => {};
  let halted = () => {};
  const pause = (ms) => new Promise(done => setTimeout(done, ms));
  // Smoothcomp kept refusing profile pages, so reading waits a quarter hour per try.
  let paused = false;
  const pausing = (now) => { if (now !== paused) { paused = now; halted(); } };

  document.addEventListener('scwr:response', event => {
    try {
      const result = JSON.parse(event.detail);
      if (typeof result.paused === 'boolean') pausing(result.paused);
      requests.get(result.id)?.(result);
    } catch {}
  });
  function ask(message, started) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { requests.delete(id); reject(new Error('Extension unavailable; reload this page.')); }, message.op === 'fetch' ? 30000 : 15000);
      requests.set(id, result => {
        if (result.started) { started?.(); return; }
        clearTimeout(timer);
        requests.delete(id);
        if (result.error) reject(new Error(result.error)); else resolve(result);
      });
      document.dispatchEvent(new CustomEvent('scwr:request', { detail: JSON.stringify({ ...message, id }) }));
    });
  }

  function merge(kept) {
    const updated = new Set();
    for (const [kind, mine] of [['careers', careers], ['ranks', ranks]]) {
      for (const [user, given] of Object.entries(kept[kind] ?? {})) {
        if (!/^\d{1,12}$/.test(user)) continue;
        if (Number.isFinite(given?.at) && given.at >= (mine[user]?.at ?? 0) && !SCWRCache.fresh(given, kind)) {
          if (mine[user]) { delete mine[user]; updated.add(user); }
          continue;
        }
        const entry = SCWRCache.clean(kind, given);
        if (entry && entry.at > (mine[user]?.at ?? 0)) { mine[user] = entry; updated.add(user); }
      }
    }
    if (updated.size) { saveSoon(); changed(updated); }
  }
  document.addEventListener('scwr:updated', event => { try { merge(JSON.parse(event.detail)); } catch {} });

  let saving;
  function save() {
    clearTimeout(saving);
    for (const [kind, entries] of [['careers', careers], ['ranks', ranks]]) {
      for (const user of Object.keys(entries)) if (!SCWRCache.fresh(entries[user], kind)) delete entries[user];
      SCWRSite.store.set(kind, entries);
    }
  }
  function saveSoon() { clearTimeout(saving); saving = setTimeout(save, 250); }
  merge({ careers: SCWRSite.store.get('careers', {}), ranks: SCWRSite.store.get('ranks', {}) });
  const ready = (async () => {
    for (;;) {
      try {
        merge(await ask({ op: 'read' }));
        await ask({ op: 'import', careers, ranks });
        return;
      } catch { await pause(1000); }
    }
  })();

  async function job(kind, user, load, events) {
    for (;;) {
      const claim = await ask({ op: 'claim', kind, user, events });
      if (claim.entry) return claim.entry;
      if (claim.wait) { await pause(claim.wait); continue; }
      const message = { kind, user, token: claim.token };
      const heartbeat = setInterval(() => { ask({ op: 'renew', ...message }).catch(() => {}); }, 20000);
      let entry;
      try {
        entry = SCWRCache.clean(kind, await load());
      } finally {
        clearInterval(heartbeat);
        await ask({ op: 'complete', ...message, entry });
      }
      return entry;
    }
  }

  async function turns() {
    if (turning) return;
    turning = true;
    try {
      while (line.length) {
        const seen = priority();
        const index = line.findIndex(item => seen.has(item.user));
        const item = line[Math.max(0, index)];
        let release;
        const started = new Promise(resolve => { release = resolve; });
        ask({ op: 'fetch', resource: 'profile', user: item.user }, () => release(0)).then(result => {
          if (result.wait) release(result.wait);
          else { if (result.status === 200) pausing(false); item.resolve(result); release(0); }
        }, error => { item.reject(error); release(0); });
        const wait = await started;
        if (wait) await pause(Math.min(wait, 1000));
        else line.splice(line.indexOf(item), 1);
      }
    } catch (error) {
      for (const item of line.splice(0)) item.reject(error);
    } finally { turning = false; }
  }
  const turn = user => new Promise((resolve, reject) => { line.push({ user, resolve, reject }); turns(); });

  async function request(resource, user, signed) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let result;
      do {
        result = resource === 'profile' ? await turn(user) : await ask({ op: 'fetch', resource, user, signed });
        if (result.wait) await pause(Math.min(result.wait, 1000));
      } while (result.wait);
      if (!result.temporary) return new Response(result.body, { status: result.status, headers: result.headers });
    }
    throw new Error('Smoothcomp is temporarily unavailable');
  }

  // Choose a bulk-read athlete only when a profile request can start. Merely
  // checking availability never spends a slot, including cache-only work.
  async function next(pending, needed) {
    await ready;
    while (pending.size) {
      const seen = priority();
      const user = [...pending].find(u => seen.has(u)) ?? pending.values().next().value;
      if (!needed(user)) { pending.delete(user); continue; }
      const { entry } = await ask({ op: 'peek', kind: 'signatures', user });
      if (!entry) {
        const { wait } = await ask({ op: 'available' });
        if (wait) { await pause(Math.min(wait, 1000)); continue; }
      }
      if (pending.delete(user)) return user;
    }
  }

  function signature(user) {
    if (!signatures.has(user)) {
      const pending = job('signatures', user, async () => {
        const response = await request('profile', user);
        if (!response.ok) throw new Error('Profile unavailable');
        const html = await response.text();
        if (/<h[1-6][^>]*>\s*This profile is not public\.\s*<\/h[1-6]>/i.test(html)) return { at: Date.now(), hidden: true };
        const encoded = html.match(/data-data-signature="([^"]*)"/)?.[1];
        if (encoded) {
          const signed = JSON.parse(encoded.replaceAll('&quot;', '"'));
          return { at: Date.now(), signature: signed.signature, expires: signed.expires };
        }
        // AJP may serve profiles without signing, but a missing signature on
        // Smoothcomp is an unexpected page, not evidence of privacy.
        if (location.hostname === 'ajptour.com' && /data-profile=/.test(html)) return { at: Date.now(), unsigned: true };
        throw new Error('Unreadable profile');
      }).finally(() => signatures.delete(user));
      signatures.set(user, pending);
    }
    return signatures.get(user);
  }
  const query = signed => signed.signature ? `?signature=${signed.signature}&expires=${signed.expires}` : '';

  // A career kept from before event counts were read is read again when `events` asks for one.
  function read(kind, user, events = false) {
    user = String(user);
    const entries = kind === 'careers' ? careers : ranks;
    if (SCWRCache.fresh(entries[user], kind) && !(events && !entries[user].hidden && entries[user].events == null)) return Promise.resolve(entries[user]);
    const key = `${kind}:${user}`;
    if (!reading.has(key)) {
      reading.set(key, ready.then(() => job(kind, user, async () => {
        const signed = await signature(user);
        if (signed.hidden) return { at: signed.at, hidden: true };
        // The events an athlete entered ride on the same signature, beside the
        // career; without them the career still counts.
        const [response, past] = await Promise.all([request(kind === 'careers' ? 'career' : 'skills', user, signed),
          kind === 'careers' && request('events', user, signed).then(r => r.ok ? r.json() : null).catch(() => null)]);
        if (!response.ok) throw new Error('Athlete data unavailable');
        const data = (await response.json()).data;
        if (kind === 'careers') {
          if (!Array.isArray(data?.win_method_breakdown) || !data.medals) throw new Error('Unreadable career');
          return { at: Date.now(), wins: Object.fromEntries(data.win_method_breakdown.map(t => [t.won_by, t.count])), medals: [data.medals.gold, data.medals.silver, data.medals.bronze], events: past?.meta?.total };
        }
        if (!Array.isArray(data)) throw new Error('Unreadable belts');
        const latest = data.filter(skill => /jiu|bjj/i.test(skill.name)).sort((a, b) => b.sort_order - a.sort_order)[0];
        return { at: Date.now(), belt: SCWRCache.oneBelt(latest?.belt ?? '') };
      }, events)).then(entry => {
        if (entry) merge({ [kind]: { [user]: entry } });
        return entry;
      }).catch(() => {}).finally(() => { reading.delete(key); changed(); }));
    }
    return reading.get(key);
  }
  return { careers, ranks, ready, save, signature, query, next,
    fresh: user => SCWRCache.fresh(careers[user]),
    isReading: user => reading.has(`careers:${user}`), paused: () => paused,
    readCareer: (user, events) => read('careers', user, events), readRank: user => read('ranks', user),
    configure(options) { priority = options.priority; changed = options.changed; halted = options.halted ?? halted; },
  };
})();
