// Everything that knows what Smoothcomp is: the vocabulary its results use, the
// shape of its URLs, the Vue app it renders with, and how long its numbers stay
// worth keeping. Loaded first on every page, so the rest can stay about grappling.
const SCWRSite = (() => {
  // Canonical order, most decisive finish first. Other sports bring their own
  // (ippon, tko, ...) and sort after these.
  const WIN_TYPES = ['submission', 'points', 'decision', 'disqualification', 'walkover'];
  const isYouth = (name) => /^(Gi|No Gi)\s+(Kids|Teens)/i.test(name);

  // The manifest matches every locale segment, so follow the page rather than
  // forcing /en/ and bouncing the reader into English.
  const locale = () => location.pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] ?? 'en';
  const id = (kind, href) => String(href ?? location.pathname).match(`/${kind}/(\\d+)`)?.[1] ?? null;

  const url = {
    event: (event, ...rest) => [`/${locale()}/event/${event}`, ...rest].join('/'),
    bracket: (event, bracket) => `/${locale()}/event/${event}/bracket/${bracket}`,
    profile: (user) => `/${locale()}/profile/${user}`,
    club: (club) => `/${locale()}/club/${club}`,
  };

  // One version stamp, one expiry rule, one place that survives a full disk.
  // Preferences use get/set and never expire; match data uses read/write and does.
  const VERSION = 3;
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

  return { WIN_TYPES, isYouth, locale, url, store, vm, eventId: () => id('event'), bracketId: (href) => id('bracket', href), profileId: (href) => id('profile', href), clubId: (href) => id('club', href) };
})();
