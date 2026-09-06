// Smoothcomp already ships every bracket of an event in the participants
// payload, then renders four at a time behind infinite scroll. Show them all at
// once, biggest bracket first.

const approved = (group) => group.registrations.filter((r) => r.approved === 1).length;

// The list is fetched after mount, so wait for it to land — a large entry list on
// a slow connection takes a while, but not forever.
SCWRSite.vm.find('#registrations', (c) => c.proxy?.all?.length, { timeout: 60000 }).then((vm) => {
  if (!vm) return;
  // Every filter path — search, country, quick filter — funnels through here,
  // and each one rebuilds `visible` from the first chunk alone.
  SCWRSite.vm.after(vm, 'updateResults', () => {
    vm.visible = vm.chunks.slice();
    vm.nextChunk = vm.chunks.length; // leaves the scroll handler nothing to do
  });
  // `participants` maps `all` in order, so sorting the source sorts the filtered
  // views too. The array is frozen; sort a copy.
  vm.all = Object.freeze([...vm.all].sort((a, b) => approved(b) - approved(a)));
  vm.updateResults();
});
