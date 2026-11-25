// How many athletes an event's pages count (the badge on the menu's Athletes link), sent for Mat Stats'
// events list from whichever of its pages is open: none (null) while the list is hidden or nobody entered.
const sizeEvent = location.pathname.match(/^\/en\/event\/(\d{1,9})(?:\/|$)/)?.[1];
const sizeLink = sizeEvent && document.querySelector(`a[href$="/event/${sizeEvent}/participants"]`);
if (sizeLink) {
  const n = sizeLink.querySelector('.badge')?.textContent.replace(/\D/g, '');
  chrome.runtime.sendMessage({ channel: 'scwr', op: 'size', event: sizeEvent, registered: n ? Number(n) : null }).catch(() => {});
}
