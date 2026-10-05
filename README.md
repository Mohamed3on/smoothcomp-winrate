# Mat Stats for Smoothcomp

A Chrome extension that recomputes Smoothcomp's competition numbers from the event's
own match list, and adds the views the site doesn't have. It works on Smoothcomp events and on
AJP Tour's, which run on their own copy of Smoothcomp at ajptour.com.

Smoothcomp's published win rate counts walkovers as wins, so an athlete who advanced
on two no-shows reads the same as one who submitted two opponents. This extension
reads every match off the event's schedule, live or finished, recounts every record under
the win types you choose, and shows the result on the results page.

## What it adds

**Results page** — a sortable competition leaderboard above the official results: athletes,
academies, and a brackets view pairing each division's gold medallist with whoever actually
won the most matches there. A Matchups tab puts any two academies head to head: the record
between them, the points each scored, and every counted match where they met. A division still waiting on its published results counts from
the schedule, with no placements or medals until they arrive. Rows carry the photo, flag, belt and age the registration list
publishes and the results page drops. An age range, open at either end, uses those registration ages across
division names while gi and no-gi stay combined, and a belt filter narrows every table to the
grades you keep switched on — one chip per grade the event published, with the spellings of a
colour folded together. Search reaches countries as well as names, academies and divisions. Every athlete in the official list below gets their record inline.

**Participants page** — unrolls the infinite scroll and shows every bracket at once, biggest first.
Athletes Smoothcomp hides until their registration is approved show too, faded and marked "Not approved".
As a bracket nears the screen, each athlete's career replaces the registration column, which only
repeated the bracket title: wins, counted under the win types the results page keeps on, over how many
came by submission and on points, then medals. The bracket ranks itself by wins, submissions, points,
then the younger athlete, and otherwise keeps Smoothcomp's order. Careers are read a bracket at a time and kept for a
week; a hidden profile has none.

## Install

No build step. Clone, or unzip the [latest release](https://github.com/Mohamed3on/smoothcomp-winrate/releases/latest), then load it unpacked:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → pick the folder

## Layout

| File | What it is |
| --- | --- |
| `site.js` | Everything that knows what Smoothcomp is: win-type vocabulary, URL shapes, the versioned store, the Vue view-model adapter |
| `matches.js` | Reads every match off the event's schedule, one request per mat |
| `model.js` | Pure joins — scheduled matches to registrations and published placements, then athlete, academy and bracket leaderboards |
| `results.js` | The results page panel |
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

No dependencies. The tests replay two real events through the extension's own loading,
caching and joining code: a finished Grappling Industries event (25901), and ADCC Amateur
Worlds (29650) recorded mid-event. `tests/fixtures/` holds what
Smoothcomp served, trimmed to the fields the extension reads, with every competitor renamed
and renumbered.

## Releases

Never bump the version by hand. Every push to main runs the tests, then semantic-release
reads the commit messages since the last tag: a `feat` cuts a minor version, a `fix` a patch.
A release stamps the version into `manifest.json`, commits it back, and attaches a zip of the
files the manifest loads (`pack.ts`) to a GitHub release.

## Notes

`plans/standalone-import-proof/` records why this has to be a content script: every
unauthenticated request to Smoothcomp returns 403 behind a Cloudflare challenge, so the
data can only be read from a browser session that is already signed in.

## Licence

MIT — see [LICENSE](LICENSE).
