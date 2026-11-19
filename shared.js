// The isolated script performs authenticated reads and reports real failures;
// page events cannot manufacture a cooldown for every organiser tab.
const send = message => chrome.runtime.sendMessage({ ...message, channel: 'scwr' });
const OPS = ['read', 'import', 'shared', 'record', 'claim', 'renew', 'complete', 'peek', 'available', 'delay'];
async function fetchAthlete(request, started) {
  const { resource, user, signed = {} } = request;
  if (!['profile', 'career', 'events', 'skills'].includes(resource) || !/^\d{1,12}$/.test(user)) throw new Error('Invalid athlete request');
  const { wait, paused } = await send({ op: resource === 'profile' ? 'slot' : 'delay' });
  if (wait) return { wait, paused };
  const home = location.hostname === 'ajptour.com' ? 'https://ajptour.com' : 'https://smoothcomp.com';
  const path = resource === 'profile' ? `profile/${user}` : `athlete/${user}/${{ career: 'wins-and-medals', events: 'past-events' }[resource] ?? 'skills'}`;
  const url = new URL(`/en/${path}`, home);
  if (resource !== 'profile' && typeof signed.signature === 'string' && /^[\w-]{1,256}$/.test(signed.signature) && Number.isSafeInteger(signed.expires)) {
    url.searchParams.set('signature', signed.signature);
    url.searchParams.set('expires', signed.expires);
  }
  started();
  let response;
  let body = '';
  try {
    response = await fetch(url.href, { credentials: 'include', signal: AbortSignal.timeout(20000) });
    body = await response.text();
  } catch { response = null; }
  const challenged = response?.headers.get('cf-mitigated') === 'challenge' || /<title>\s*Just a moment|\/cdn-cgi\/challenge-platform\//i.test(body);
  if (!response || challenged || response.status === 429 || response.status >= 500) {
    const retry = response?.headers.get('Retry-After');
    const ms = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
    await send({ op: 'cooldown', ms });
    return { temporary: true };
  }
  if (resource === 'profile' && response.ok) await send({ op: 'healthy' });
  return { status: response.status, body, headers: { 'content-type': response.headers.get('content-type') ?? '' } };
}

document.addEventListener('scwr:request', async event => {
  let id;
  const reply = result => document.dispatchEvent(new CustomEvent('scwr:response', { detail: JSON.stringify({ id, ...result }) }));
  try {
    const request = JSON.parse(event.detail);
    id = request.id;
    if (!Number.isSafeInteger(id)) return;
    if (request.op === 'fetch') reply(await fetchAthlete(request, () => reply({ started: true })));
    else if (OPS.includes(request.op)) reply(await send(request));
    else reply({ error: 'Unsupported page request' });
  } catch {
    reply({ error: 'Extension unavailable; reload this page.' });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const site = location.hostname === 'ajptour.com' ? 'ajptour.com' : 'smoothcomp.com';
  const prefix = `scwr2:${site}:`;
  const kept = { careers: {}, ranks: {} };
  for (const [name, change] of Object.entries(changes)) {
    if (!name.startsWith(prefix) || !change.newValue) continue;
    const [kind, user] = name.slice(prefix.length).split(':');
    if (Object.hasOwn(kept, kind)) kept[kind][user] = change.newValue;
  }
  if (Object.keys(kept.careers).length || Object.keys(kept.ranks).length) {
    document.dispatchEvent(new CustomEvent('scwr:updated', { detail: JSON.stringify(kept) }));
  }
});
