const SCWRCache = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const KEPT = 21 * DAY;
  const PRIVATE = 30 * DAY;
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const oneBelt = (text) => {
    const named = BELTS.filter(b => new RegExp(`\\b${b}`, 'i').test(text.replace(/gray/i, 'grey')));
    return named.length === 1 ? named[0] : null;
  };
  const whole = (n) => Number.isSafeInteger(n) && n >= 0;
  const fresh = (entry, kind = 'careers') => {
    if (!Number.isFinite(entry?.at) || entry.at > Date.now() + 60000) return false;
    if (entry.hidden) return Date.now() - entry.at < PRIVATE;
    if (kind === 'signatures') return entry.signature ? entry.expires * 1000 - 60000 > Date.now() : entry.unsigned && Date.now() - entry.at < 60000;
    return Date.now() - entry.at < KEPT && (kind === 'ranks' || !!entry.wins);
  };
  function clean(kind, entry) {
    if (!fresh(entry, kind)) return null;
    if (entry.hidden === true) return { at: entry.at, hidden: true };
    if (kind === 'careers' && entry.wins && typeof entry.wins === 'object' && !Array.isArray(entry.wins) && Array.isArray(entry.medals)) {
      return { at: entry.at,
        wins: Object.fromEntries(Object.entries(entry.wins).filter(([type, n]) => /^[\w -]{1,40}$/.test(type) && whole(n))),
        medals: [0, 1, 2].map(i => whole(entry.medals[i]) ? entry.medals[i] : 0),
        ...(whole(entry.events) && { events: entry.events }) };
    }
    if (kind === 'ranks' && (entry.belt == null || BELTS.includes(entry.belt))) return { at: entry.at, belt: entry.belt ?? null };
    if (kind === 'signatures') {
      if (entry.unsigned === true) return { at: entry.at, unsigned: true };
      if (typeof entry.signature === 'string' && /^[\w-]{1,256}$/.test(entry.signature) && whole(entry.expires) && entry.expires * 1000 < Date.now() + 20 * 60 * 1000) {
        return { at: entry.at, signature: entry.signature, expires: entry.expires };
      }
    }
    return null;
  }
  return { DAY, KEPT, PRIVATE, BELTS, oneBelt, fresh, clean };
})();
