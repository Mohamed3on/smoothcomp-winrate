// Everything that knows what Smoothcomp is: the vocabulary its results use, the
// shape of its URLs, the Vue app it renders with, and how long its numbers stay
// worth keeping. Loaded first on every page, so the rest can stay about grappling.
const SCWRSite = (() => {
  // Canonical order, most decisive finish first. Other sports bring their own
  // (ippon, tko, ...) and sort after these.
  const WIN_TYPES = ['submission', 'points', 'decision', 'disqualification', 'walkover'];
  const isYouth = (name) => /^(Gi|No Gi)\s+(Kids|Teens)/i.test(name);

  // Smoothcomp uses ISO alpha-2 for countries and its own codes for a handful of
  // regions. Unicode has flag glyphs for only four of those — the three British
  // nations and Kosovo — so the rest are drawn, sized and rounded to sit level
  // with the emoji beside them. Callers get a glyph or markup; both are strings.
  const svg = (...shapes) =>
    `<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true" style="border-radius:2px">${shapes.join('')}</svg>`;
  const band = (y, h, fill) => `<rect y="${y}" width="16" height="${h}" fill="${fill}"/>`;
  const FLAG = {
    'gb-eng': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'gb-sct': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
    'gb-wls': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
    kos: '\u{1F1FD}\u{1F1F0}',
    // Chechnya: a gold ornament band at the hoist over a green/white/red tricolour.
    'ru-cri': svg(band(0, 12, '#0f8f3f'), band(5.2, 1.6, '#fff'), band(6.8, 5.2, '#c8102e'),
      '<rect width="2.6" height="12" fill="#e8a020"/>'),
    'ru-da': svg(band(0, 12, '#0f8f3f'), band(4, 4, '#1e4fa3'), band(8, 4, '#c8102e')),
    krd: svg(band(0, 12, '#e03a3e'), band(4, 4, '#fff'), band(8, 4, '#1a8f4c'),
      '<circle cx="8" cy="6" r="2.1" fill="#f5c518"/>'),
  };
  const flag = (code) => {
    const c = String(code ?? '').toLowerCase();
    if (FLAG[c]) return FLAG[c];
    if (!/^[a-z]{2}$/.test(c)) return null;
    return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 97));
  };

  // The manifest matches every locale segment, so follow the page rather than
  // forcing /en/ and bouncing the reader into English.
  const locale = () => location.pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] ?? 'en';
  const id = (kind, href) => String(href ?? location.pathname).match(`/${kind}/(\\d+)`)?.[1] ?? null;

  const url = {
    // Links follow the reader; anything the extension parses is pinned to
    // English, because every parser here reads English — "Won by Submission",
    // "Finished", "No Gi Kids". A German event serves "Gewonnen nach Punkten",
    // which types no win at all and leaves every leaderboard empty.
    data: (event, ...rest) => [`/en/event/${event}`, ...rest].join('/'),
    bracket: (event, bracket) => `/${locale()}/event/${event}/bracket/${bracket}`,
    match: (match) => `https://smoothcomp.com/${locale()}/getBracketMatchData/${match}`,
    profile: (user) => `/${locale()}/profile/${user}`,
    club: (club) => `/${locale()}/club/${club}`,
  };

  // One version stamp, one expiry rule, one place that survives a full disk.
  // Preferences use get/set and never expire; match data uses read/write and does.
  const VERSION = 4;
  const FINAL_TTL = 12 * 60 * 60 * 1000;
  const LIVE_TTL = 5 * 60 * 1000;
  const store = {
    get(key, fallback = null) {
      try {
        return JSON.parse(localStorage.getItem(`scwr:${key}`)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(`scwr:${key}`, JSON.stringify(value)); } catch {}
    },
    // An event still in progress goes stale in minutes; a finished one does not.
    read(key) {
      const hit = store.get(key);
      return hit?.v === VERSION && Date.now() - hit.at < (hit.final ? FINAL_TTL : LIVE_TTL) ? hit : null;
    },
    write(key, value, final = false) {
      const entry = { ...value, v: VERSION, at: Date.now(), final };
      store.set(key, entry);
      return entry;
    },
  };

  // Smoothcomp renders with Vue and mounts after the first paint, so the only way
  // in is to poll for the component and then follow the method we care about.
  const node = (target) => (typeof target === 'string' ? document.querySelector(target) : target);
  const vm = {
    // Resolves with the view-model's proxy, or null if it never shows up.
    find(target, accept, { timeout = 30000, every = 100 } = {}) {
      return new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          for (let c = node(target)?._vnode?.component; c; c = c.subTree?.component) {
            if (!accept(c)) continue;
            clearInterval(timer);
            return resolve(c.proxy);
          }
          if (Date.now() - started > timeout) { clearInterval(timer); resolve(null); }
        }, every);
      });
    },
    // Run `then` after the site's own method, without replacing what it does.
    after(target, name, then) {
      const original = target[name];
      target[name] = function (...args) {
        const value = original.apply(this, args);
        return value instanceof Promise ? value.then((v) => (then(), v)) : (then(), value);
      };
    },
  };

  return { WIN_TYPES, isYouth, flag, locale, url, store, vm, eventId: () => id('event'), bracketId: (href) => id('bracket', href), profileId: (href) => id('profile', href), clubId: (href) => id('club', href) };
})();
