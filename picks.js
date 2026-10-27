// Which of an event's brackets the signed-in athlete could enter, and which of
// those they would top-seed. Pure — no DOM, no network, no storage — so the tests
// can hold it to the labels organisers really write.
const SCWRPicks = (() => {
  const BELTS = ['white', 'grey', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black'];
  const kg = (unit) => (/lb/i.test(unit) ? 0.45359237 : 1);

  // What one category value asks of an athlete, read off the organiser's label:
  // nothing for gender, which the registrants themselves show; a weight class in
  // kg; the belts it admits; an age range; or null for a label that names none of
  // these, like ADCC's "Beginner", which goes by years on the mat.
  function demand({ category_name: category, name, datatype, datatype_weight_unit: unit, weight_minimum: min, weight_maximum: max }) {
    const label = name.trim();
    if (/gender|sex/i.test(category)) return {};
    const weight = label.match(/(\d+(?:[.,]\d+)?)\s*(kg|lbs?)\b/i);
    if (datatype === 'weight' || weight || /weight/i.test(category)) {
      // The organiser's own bounds when set; otherwise "-185 lbs" is a ceiling,
      // and "+100 kg" and "Over 230 lbs" are floors.
      if (+min || +max) return { weight: [+min * kg(unit), (+max || Infinity) * kg(unit)] };
      if (!weight) return /open|absolute/i.test(label) ? { weight: [0, Infinity] } : null;
      const limit = parseFloat(weight[1].replace(',', '.')) * kg(weight[2]);
      return { weight: /^\+|over/i.test(label) ? [limit, Infinity] : [0, limit] };
    }
    const belts = BELTS.filter((belt) => new RegExp(`\\b${belt}`, 'i').test(label.replace(/gray/i, 'grey')));
    if (belts.length || /belt|level|rank|skill|grade/i.test(category)) {
      return /all levels/i.test(label) ? { belts: BELTS } : belts.length ? { belts } : null;
    }
    if (/age|division/i.test(category)) {
      const range = label.match(/(\d+)\s*-\s*(\d+)/);
      const floor = label.match(/(\d+)\s*\+|\+\s*(\d+)/);
      const master = label.match(/masters?\s*(\d)/i);
      if (range) return { age: [+range[1], +range[2]] };
      if (floor) return { age: [+(floor[1] ?? floor[2]), Infinity] };
      // Master 1 is 30 and up, and each level after it five years more.
      if (master) return { age: [25 + 5 * master[1], Infinity] };
      if (/kid|infant|junior|teen|youth|juvenile|boy|girl/i.test(label)) return { age: [0, 17] };
      if (/master/i.test(label)) return { age: [30, Infinity] };
      if (/senior/i.test(label)) return { age: [40, Infinity] };
      if (/adult|amateur|professional/i.test(label)) return { age: [18, Infinity] };
    }
    return null;
  }

  // The brackets `me` could enter. Every registration in a bracket carries its
  // category values, so the first speaks for it, and its registrants say whose it
  // is. A value whose label can't be read counts only if `me` entered under it
  // here. Weight is `me`'s own class: of brackets alike in all but weight, the
  // lightest whose limit `me` makes. Open weight is anyone's.
  function eligible(groups, values, me) {
    const entered = new Set(groups.flatMap((g) => g.registrations).filter((r) => String(r.user_id) === me.id)
      .flatMap((r) => r.categories.map((c) => c.category_value_id)));
    const open = [];
    const lightest = new Map();
    for (const group of groups) {
      const sexed = group.registrations.filter((r) => r.gender);
      if (sexed.filter((r) => r.gender === me.gender).length * 2 < sexed.length) continue;
      let weight = [0, Infinity];
      let fits = true;
      const alike = [group.entry_id];
      for (const { category_value_id: id } of group.registrations[0].categories) {
        const asks = values.has(id) ? demand(values.get(id)) : null;
        if (asks?.weight) {
          weight = asks.weight;
          continue;
        }
        alike.push(id);
        fits &&= asks
          ? (!asks.belts || asks.belts.includes(me.belt)) && (!asks.age || (me.age >= asks.age[0] && me.age <= asks.age[1]))
          : entered.has(id);
      }
      if (!fits || me.weight <= weight[0] || me.weight > weight[1]) continue;
      if (!weight[0] && weight[1] === Infinity) open.push(group);
      else if (!(lightest.get(alike.join())?.[1] <= weight[1])) lightest.set(alike.join(), [group, weight[1]]);
    }
    return [...open, ...[...lightest.values()].map(([group]) => group)];
  }

  // How `me` would stand in each bracket against its strongest other athlete, by
  // the page's own order: wins, then submissions, then points, then the younger.
  // A career `tally` can't read ranks last there too. Every bracket
  // `me` would top, biggest first, or, with none, the one `me` falls the fewest wins short of.
  function picks(groups, me, tally) {
    const key = (t, age) => [...(t ?? [-1, -1, -1]), -(age ?? Infinity)];
    const ahead = (a, b) => a.reduce((order, x, i) => order || x - b[i], 0) > 0;
    const mine = key(me.tally, me.age);
    const standings = groups.map((group) => {
      const others = group.registrations.filter((r) => String(r.user_id) !== me.id);
      const keys = others.map((r) => key(r.user_id && tally(String(r.user_id)), r.age));
      const rival = keys.reduce((best, k) => (!best || ahead(k, best) ? k : best), null);
      return {
        group,
        size: group.registrations.length,
        entered: others.length < group.registrations.length,
        hidden: keys.filter((k) => k[0] < 0).length,
        rival: rival?.[0] >= 0 ? rival[0] : null,
        top: !rival || ahead(mine, rival),
      };
    });
    const top = standings.filter((s) => s.top).sort((a, b) => b.size - a.size);
    const closest = top.length ? null : standings.sort((a, b) => a.rival - b.rival || b.size - a.size)[0] ?? null;
    return { top, closest };
  }

  return { demand, eligible, picks };
})();
