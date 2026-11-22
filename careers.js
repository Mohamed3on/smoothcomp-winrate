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
  let listed = () => []; // the athletes the page lists, in its order, read first
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
  // Once an event is over, a career read before it ended misses it, so it is read again:
  // this page's event for everyone, and for each athlete the last one the shared cache saw them enter.
  let since = 0;
  const over = {};
  const after = user => Math.max(since, over[user] ?? 0);
  const ended = Promise.resolve(SCWRSite.event?.()).then(e => { const end = Date.parse(e?.end); if (end <= Date.now()) since = end; }).catch(() => {});
  const current = (entry, kind, user) => SCWRCache.fresh(entry, kind) && (kind !== 'careers' || entry.hidden || entry.at >= after(user));
  const ready = (async () => {
    await ended;
    for (;;) {
      try {
        merge(await ask({ op: 'read' }));
        await ask({ op: 'import', careers, ranks });
        return;
      } catch { await pause(1000); }
    }
  })();

  // The shared cache answers for the whole event at once, before any profile is read.
  // With it come the records results pages have seen: [wins, losses, events], and when
  // each athlete's last event ended.
  let looked = Promise.resolve();
  const seen = {};
  const lookup = users => looked = Promise.all([looked, ready.then(() => ask({ op: 'shared', users })).then(kept => {
    Object.assign(seen, kept.seen);
    Object.assign(over, kept.ended);
    merge(kept);
    const told = new Set([...Object.keys(kept.seen ?? {}), ...Object.keys(kept.ended ?? {})]);
    if (told.size) changed(told);
  }).catch(() => {})]);

  async function job(kind, user, load, events) {
    for (;;) {
      const claim = await ask({ op: 'claim', kind, user, events, since: kind === 'careers' ? after(user) : 0 });
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

  async function request(resource, user, signed, page) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let result;
      do {
        result = resource === 'profile' ? await turn(user) : await ask({ op: 'fetch', resource, user, signed, page });
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
    await looked;
    while (pending.size) {
      const seen = priority();
      const user = listed().find(u => pending.has(u)) ?? [...pending].find(u => seen.has(u)) ?? pending.values().next().value;
      if (!needed(user)) { pending.delete(user); continue; }
      const { entry } = await ask({ op: 'peek', kind: 'signatures', user });
      if (!entry) {
        const { wait } = await ask({ op: 'available' });
        if (wait) { await pause(Math.min(wait, 1000)); continue; }
      }
      if (pending.delete(user)) return user;
    }
  }

// Every event an athlete entered, five a page: its date, place, wins and medal. The
  // public site shows them all; the career keeps only the count.
  // The first page alone: its count is the events entered, and its rows, the newest,
  // join the athlete's kept event list on the server (profile pages send the rest).
  async function pastEvents(user, signed) {
    const first = await request('events', user, signed, 1).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!first) return null;
    const rows = Array.isArray(first.data) ? first.data : [];
    if (rows.length) ask({ op: 'people', athletes: { [user]: { history: rows.map(e => ({ event: String(e.id), title: e.title, start: e.start_date, city: e.city, wins: e.wins, medals: [e.medals?.gold, e.medals?.silver, e.medals?.bronze] })) } } }).catch(() => {});
    return first;
  }
  // Who the athlete is rides along with their career, for the public site.
  function shareProfile(user, html) {
    try {
      const p = JSON.parse(html.match(/data-profile="([^"]*)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
      const photo = /placeholder|default/i.test(p.profile_image_url ?? '') ? null : p.profile_image_url;
      ask({ op: 'people', athletes: { [user]: { name: p.name, country: p.country_code?.toLowerCase(), countryName: p.nationality, age: p.age, photo } } }).catch(() => {});
    } catch {}
  }
  // AJP's athlete routes answer unsigned and unthrottled; only its profile pages sit
  // behind Cloudflare's limit, so AJP never reads them.
  const ajp = location.hostname === 'ajptour.com';
  function signature(user) {
    if (ajp) return Promise.resolve({ at: Date.now(), unsigned: true });
    if (!signatures.has(user)) {
      const pending = job('signatures', user, async () => {
        const response = await request('profile', user);
        if (!response.ok) throw new Error('Profile unavailable');
        const html = await response.text();
        if (/<h[1-6][^>]*>\s*This profile is not public\.\s*<\/h[1-6]>/i.test(html)) return { at: Date.now(), hidden: true };
        shareProfile(user, html);
        const encoded = html.match(/data-data-signature="([^"]*)"/)?.[1];
        if (encoded) {
          const signed = JSON.parse(encoded.replaceAll('&quot;', '"'));
          return { at: Date.now(), signature: signed.signature, expires: signed.expires };
        }
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
    if (current(entries[user], kind, user) &&!(events && !entries[user].hidden && entries[user].events == null)) return Promise.resolve(entries[user]);
    const key = `${kind}:${user}`;
    if (!reading.has(key)) {
      reading.set(key, ready.then(() => looked).then(() => job(kind, user, async () => {
        const signed = await signature(user);
        if (signed.hidden) return { at: signed.at, hidden: true };
        // The events an athlete entered ride on the same signature, beside the
        // career; without them the career still counts.
        const [response, past] = await Promise.all([request(kind === 'careers' ? 'career' : 'skills', user, signed),
          kind === 'careers' && pastEvents(user, signed)]);
        // Without a profile page to say so, AJP's refusal is the hidden profile.
        if (ajp && response.status === 403) return { at: Date.now(), hidden: true };
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
  return { careers, ranks, ready, save, signature, query, next, lookup, seen,
    fresh: user => current(careers[user], 'careers', String(user)),
    isReading: user => reading.has(`careers:${user}`), paused: () => paused,
    readCareer: (user, events) => read('careers', user, events), readRank: user => read('ranks', user),
    configure(options) { priority = options.priority; listed = options.listed ?? listed; changed = options.changed; halted = options.halted ?? halted; },
  };
})();
