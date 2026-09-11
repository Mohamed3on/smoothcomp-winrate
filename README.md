# Smoothcomp Win Rate

A Chrome extension that recomputes Smoothcomp's competition numbers from the event's
own match list, and adds the views the site doesn't have.

Smoothcomp's published win rate counts walkovers as wins, so an athlete who advanced
on two no-shows reads the same as one who submitted two opponents. This extension
refetches the event's match list, recounts every record under the win types you choose,
and shows the result on three pages.

## What it adds

**Results page** — a sortable competition leaderboard above the official results: athletes,
academies, and a brackets view pairing each division's gold medallist with whoever actually
won the most matches there. Rows carry the photo, flag, belt and age the registration list
publishes and the results page drops. A minimum-age filter uses those registration ages across
division names while gi and no-gi stay combined, and a belt filter narrows every table to the
grades you keep switched on — one chip per grade the event published, with the spellings of a
colour folded together. Search reaches countries as well as names, academies and divisions. Every athlete in the official list below gets their record inline.

**Team rankings (toplist)** — a Win rate column, with the site's own Wins/Losses columns kept
in step with the win types you're counting. Click any academy to fade out everyone with a
thinner sample than theirs.

**Participants page** — unrolls the infinite scroll and shows every bracket at once, biggest first.

## Install

No build step. Clone, then load it unpacked:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → pick this directory

## Layout

| File | What it is |
| --- | --- |
| `site.js` | Everything that knows what Smoothcomp is: win-type vocabulary, URL shapes, the versioned store, the Vue view-model adapter |
| `matches.js` | Fetches and parses the event's match list; infers which age group a toplist covers |
| `model.js` | Pure joins — matches to published placements, then athlete, academy and bracket leaderboards |
| `results.js` | The results page panel |
| `toplist.js` | The team-rankings Win rate column |
| `participants.js` | The participants page |
| `icons/` | The toolbar icon. `icon.svg` is the source; the PNGs beside it are what Chrome loads |

`site.js` loads first on every page; the rest share globals through page scope in manifest
order. `model.js` is pure — no DOM, no network, no storage — which is what makes it testable.

Chrome will not load an SVG icon, so `icons/icon.svg` is the source and the PNGs are rendered
from it. After editing the SVG:

```sh
for s in 16 32 48 128; do
  uv run --with cairosvg python -c \
    "import cairosvg,sys;s=int(sys.argv[1]);cairosvg.svg2png(url='icons/icon.svg',write_to=f'icons/icon{s}.png',output_width=s,output_height=s)" $s
done
```

## Tests

```sh
npm test
```

No dependencies. `parsePage` needs a DOM and so skips by default; install `linkedom` or
`jsdom` as a dev dependency and it runs.

## Notes

`plans/standalone-import-proof/` records why this has to be a content script: every
unauthenticated request to Smoothcomp returns 403 behind a Cloudflare challenge, so the
data can only be read from a browser session that is already signed in.

## Licence

MIT — see [LICENSE](LICENSE).
