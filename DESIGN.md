---
name: Smoothcomp Winrate
description: The visual system for a browser extension that recomputes Smoothcomp's competition numbers inside Smoothcomp's own pages.
colors:
  ink: "#14161a"
  secondary-ink: "#5b616b"
  muted-ink: "#696f79"
  line: "rgba(0, 0, 0, 0.09)"
  line-strong: "rgba(0, 0, 0, 0.16)"
  surface: "#fbfbfc"
  raised: "#f1f3f5"
  hover: "rgba(0, 0, 0, 0.035)"
  accent: "#1565c0"
  accent-soft: "rgba(21, 101, 192, 0.09)"
  gold: "#8a6100"
  silver: "#5f646c"
  bronze: "#8a4f1e"
  win-submission: "#08477f"
  win-points: "#1d6fc4"
  win-decision: "#4f9ae0"
  win-disqualification: "#7fb2e0"
  win-walkover: "#b9bec6"
typography:
  display:
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontSize: "13px"
    lineHeight: 1.45
  small:
    fontSize: "11.5px"
    lineHeight: 1.4
  label:
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.06em"
rounded:
  segment: "1px"
  belt: "2px"
  bar: "3px"
  sm: "4px"
  md: "6px"
  lg: "10px"
  pill: "999px"
spacing:
  s-0: "2px"
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "20px"
  s-6: "24px"
  s-7: "32px"
components:
  tab:
    textColor: "{colors.secondary-ink}"
    typography: "{typography.body}"
    padding: "0 2px 8px"
  tab-selected:
    textColor: "{colors.ink}"
  button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "32px"
  chip-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
  chip-toggle-pressed:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  winner-pill:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  age-chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
---

# Design System: Smoothcomp Winrate

## Overview

**Creative North Star: "The Incumbent Competition Ledger"**

This extension has no page of its own. It appears inside Smoothcomp — on a results page, on a rankings page — and its entire visual argument is that it belongs there. It recomputes an event's numbers from the published match list rather than trusting the site's own counters, and the credibility of that recount depends on looking like a native part of the page that produced it, not like a widget bolted on top.

That produces a system with two registers, chosen by how much of the page the code owns. Where it owns a container — the Competition Leaders panel on a results page — it brings a complete token set scoped to `.scwr-results`, reads the host's real backdrop at runtime, and stamps `data-scwr-theme` so a light Smoothcomp and a dark Smoothcomp each get a panel built for them. Where it only injects cells into rows the site already drew — the rankings toplist — it declares almost no colour at all, painting in `currentColor` and translucent greys so it inherits whatever that row happens to be wearing.

Everything else follows from density. This is a statistics panel read by someone scanning for a name or a record, so it is flat, tabular and quiet: 1px rules and tonal layering instead of shadows, one restrained accent, and colour used to encode meaning rather than to decorate. The expressive budget is spent on the two things that carry information — the win-type ramp and the accent — and nowhere else.

**Key Characteristics:**

- A tabbed panel (Athletes, Academies, Brackets, Matchups) that replaces its own body per view, plus inline annotations on the host's official results.
- Runtime theme detection from the host backdrop, never from the OS setting.
- An ordinal win-type colour ramp shared by bars, filter chips, ledger markers and the footer key.
- Tabular numerals everywhere, fixed column budgets, and one-line metadata that truncates rather than reflows.
- Container queries throughout: the panel adapts to the space Smoothcomp gives it, which is not the viewport.

## Colors

A near-neutral greyscale carrying a single blue accent, paired light and dark by semantic role. The runtime theme on `.scwr-results` decides which set is live; the frontmatter records the light values, which are the default an unknown host falls back to.

### Primary

- **Signal Blue** (`#1565c0` light / `#79b3ea` dark): the only accent. It marks the selected tab's underline, active filters, the sorted column, links, focus rings, the leading side of a head-to-head figure, and the `WINNER` and `LEADS` treatments. Nothing decorative is ever painted in it.
- **Signal Blue Soft** (`rgba(21, 101, 192, 0.09)` / `rgba(121, 179, 234, 0.13)`): the selected-state fill. Pressed chips, the open row, the sorted cell, the expanded-row ground, the winner pill and text selection all share it, so "this is the thing you chose, or the thing that won" reads identically everywhere.

### Secondary

The win-type ramp is an ordinal scale, not a palette. Five steps run from the most decisive finish to the least: **submission**, **points**, **decision**, **disqualification**, **walkover**.

- **Submission** (`#08477f` / `#a9cff0`), **Points** (`#1d6fc4` / `#6aa8e2`), **Decision** (`#4f9ae0` / `#3f7fc4`), **Disqualification** (`#7fb2e0` / `#27547f`), **Walkover** (`#b9bec6` / `#4a4f57`).

### Tertiary

- **Gold** (`#8a6100` / `#e3b757`), **Silver** (`#5f646c` / `#c3c9d2`), **Bronze** (`#8a4f1e` / `#d59a68`): podium counts only, in the medal columns and the expanded row's pips. They never appear as UI colour.
- **Belt colours** (white `#f4f5f6` through black `#17191c` with a red `#b53b42` rank bar): borrowed from the sport, not from this palette. They are fixed in both themes, because a purple belt is purple regardless of the page it is drawn on.

### Neutral

- **Ink** (`#14161a` / `#f0f2f4`): headings, athlete names, primary figures, the selected tab.
- **Secondary Ink** (`#5b616b` / `#a3a9b3`): explanatory copy, unselected tabs, the trailing side of a head-to-head figure.
- **Muted Ink** (`#696f79` / `#868d97`): rank numbers, metadata, legends and every uppercase micro-label.
- **Surface** (`#fbfbfc` / `#17191c`) and **Raised** (`#f1f3f5` / `#1e2126`): the panel body, and the bands that sit on it — the toolbar, the table header, the head-to-head comparison band, the official-results footer.
- **Line** (`rgba(0,0,0,0.09)` / `rgba(255,255,255,0.10)`) and **Line Strong** (`rgba(0,0,0,0.16)` / `rgba(255,255,255,0.2)`): row rules and control borders respectively.
- **Hover** (`rgba(0,0,0,0.035)` / `rgba(255,255,255,0.05)`): row and button hover, and the ground behind a missing avatar.

### Named Rules

**The Host's Clothes Rule.** The panel samples the real backdrop it was injected into and stamps `data-scwr-theme` itself. It never reads `prefers-color-scheme`: the page's theme is the only theme that matters, and light is the fallback so an unrecognised host still renders correctly.

**The Contrast Ramp Rule.** Decisiveness is encoded as contrast against the surface, so the win-type ramp inverts between themes — darkest-is-most-decisive on light, lightest-is-most-decisive on dark. Never port one theme's hex values to the other.

**The Borrowed Ink Rule.** Code injected into markup Smoothcomp drew paints in `currentColor` and `rgba(128,128,128,α)`, never in panel tokens. A cell added to somebody else's row inherits that row's ink, or it announces itself as foreign.

**The Encoded Colour Rule.** Colour carries meaning or it is not applied. Accent means chosen, leading or focused; the ramp means finish type; medal colours mean podium. There is no decorative colour in this system.

## Typography

**Font:** inherited from Smoothcomp through the panel. This system sets no family, and must not: size, weight, tracking and case are the only typographic instruments it uses.

**Character:** compact and data-first. Numerals are tabular panel-wide so columns align down the page, negative tracking tightens the larger sizes, and the smallest text is uppercase with open tracking so it reads as chrome rather than as content.

### Hierarchy

Six steps, and no seventh. Weight is the only other typographic axis, and it runs 400 / 600 / 700 — nothing is 500, and nothing is 800.

- **Display** (700, 28px, 1.0, -0.03em): the head-to-head record. One instance per surface.
- **Headline** (700, 19px, 1.2, -0.015em): the panel's own title.
- **Title** (700, 15px, 1.25, -0.01em): a heading that owns a surface inside the panel — the Matchups heading, the empty state — and the medal glyphs in the column headers.
- **Body** (13px, 1.45): the panel default. Table cells, tabs, copy, athlete and academy names, and every figure. Names and figures take 600; nothing takes a different size.
- **Small** (11.5px, 1.4): everything that supports a figure — explanatory copy, metadata, rank numbers, form controls, legends, the footer key and the whole head-to-head ledger.
- **Label** (700, 10px, 0.06em, uppercase): the panel's chrome — field labels, sortable column headers, the age pill, avatar monograms, and the `WINNER` and `LEADS` markers that make a colour redundant.

### Named Rules

**The One Line Rule.** Metadata never wraps. A four-fact meta line that reflows makes every table row a different height, so it truncates with an ellipsis and carries the full text in a `title` instead.

**The One Block Rule.** Every `font-size` in the panel is declared in the Type block at the top of `results.css` and nowhere else. Component rules carry colour, layout and truncation; a component that wants a different size joins a step's selector list rather than declaring its own. Smoothcomp's Bootstrap sizes bare headings and `<small>`, so each step names its elements explicitly instead of trusting inheritance from the panel root.

**The Borrowed Type Rule.** The inline notes drawn onto Smoothcomp's own results sit outside `.scwr-results`, so no panel token resolves for them and the scale does not apply. They size themselves in `em` against whatever they were dropped into — the Borrowed Ink Rule extended to type.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set on the panel root and re-asserted on every figure that escapes it. A number that shifts as it updates is a number nobody can compare.

## Layout

The panel is a rounded 10px card with 20px padding, and it establishes `container: scwr / inline-size`. **Every breakpoint queries that container, not the viewport** — Smoothcomp decides how much room the panel gets, and on a wide screen inside a narrow column the viewport is a lie. Three steps: 1080px puts the table into a horizontal scroller and unsticks its header; 860px drops the conceded and depth columns; 620px reduces the gutter to 12px, stacks the toolbar into two columns, drops two more columns, and raises interactive targets in the Matchups surface to 44px.

Tables use `table-layout: fixed` with a per-view set of column-width custom properties that sum to 100%. Extra width is therefore distributed proportionally across every column rather than handed to whichever cell holds the longest string, and a hidden column's share redistributes the same way.

The head-to-head band is a three-column composition — academy one, a fixed 118px centre, academy two — laid on a raised ground that bleeds to the panel's edges. Each ledger row repeats that alignment, with the two athletes at the edges and the division, finish and score in the middle. The rankings toplist has no layout of its own: it inserts cells into Smoothcomp's existing flex rows, and only adjusts the site's gutters when they would truncate a name.

### Named Rules

**The Container Rule.** No `@media (max-width)` describes this panel's layout. If a rule reacts to width, it asks `@container scwr`.

**The One Gutter Rule.** Sections do not repeat the 20px gutter, they read `--pad`. The narrow container redefines that one custom property on `.scwr-results` instead of overriding the padding of the header, tabs, toolbar, status, footer, table and Matchups surface one rule at a time. All other spacing steps a 4px rhythm (`--s-1` … `--s-7`) with a 2px half-step for stacked text; dimensions that are derived rather than rhythmic — the detail row's indent, the head-to-head centre column, control widths — stay literal at the rule that needs them.

**The Fixed Budget Rule.** Column widths are authoritative percentages declared per view, not hints. Adding a column means rebalancing the set to 100%.

## Elevation & Depth

The system is flat, and deliberately so. **There is not one outer shadow in it.** Depth comes from three sources: tonal separation between `surface` and `raised`, 1px rules in `line`, and `accent-soft` fills for state. The only `box-shadow` anywhere is a 1px inset hairline that keeps a circular avatar from bleeding into the row behind it.

The single stacking decision is the table header, which sticks to the top of the scroll container at `z-index: 2` above 1080px and goes static below it.

### Named Rules

**The Flat Rule.** No drop shadows, no nested cards, no elevation scale. A surface that needs to separate gets a rule or a tone; if it needs more than that, the layout is wrong.

## Shapes

Corners step with scale: the panel shell is gently rounded (10px), controls and buttons are crisper (6px), and the focus ring and winner pill are tighter still (4px); only the win-type filters and the age chip are true pills (999px). Bars are thin clipped tracks (3px, with 1px segments inside them), belts are near-square (2px), avatars are circles, and focus rings round at 4px regardless of what they surround.

Two shapes are drawn rather than typed: the sort caret is a `clip-path` triangle in `currentColor`, and the belt swatch is a coloured rectangle with a rank bar as an `::after`. The tab's selected state is a 2px underline that scales in from its left edge.

### Named Rules

**The Drawn Glyph Rule.** Indicators are drawn in CSS or SVG, never borrowed from the font. A caret is a clip-path, a flag is an emoji or an inline SVG with a country name attached, a belt is a box — because a glyph the host font lacks is an indicator that silently disappears.

## Components

### Navigation

- **Tabs** (13px/600) sit in a row over a 1px bottom rule; the selected one takes `ink` and reveals a 2px accent underline that scales from its left edge. Roving-tab keyboard behaviour with arrow keys; the panel body swaps per view.

### Buttons

- **Shape:** 6px corners, 32px tall, 12px horizontal padding, 1px `line-strong` border on a transparent ground.
- **Hover:** border shifts to `muted-ink` and the ground to `hover` — only on devices that actually hover.
- **Disabled:** 45% opacity with a `progress` cursor, since the only disabled state here is "working".

### Fields

- **Selects, search and number inputs:** 32px tall, 6px corners, 1px `line-strong`, `surface` ground, Small text, with the caret coloured accent.
- **Focus:** a 2px accent outline inset by 2px, so it never shifts layout.
- **Minimum age:** a 74px bordered box that switches its border to accent and its ground to `accent-soft` when a value is set. The label above it says "Minimum age"; nothing inside the control repeats that.

### Chips

- **Win-type toggles:** pill-shaped, 32px tall, each carrying a dot in that finish type's ramp colour at 35% opacity. Pressed takes an accent border, an `accent-soft` ground, `ink` text and a full-opacity dot. The set never permits an empty allowlist.

### Table

- **Header:** `raised` ground, sticky, each sortable heading a full-width button in Label type. The active sort turns accent and shows its caret; hovering reveals the caret at 45%.
- **Rows:** 8px padding, a 1px `line` rule, the whole row clickable to expand. Hover takes `hover`; open takes `accent-soft` and drops its bottom rule into the detail row beneath it.
- **Expanded detail:** an `accent-soft` panel indented to the name column, listing bracket placements as pip-plus-text rows.
- **Rank:** muted Small, promoted to bold `ink` for the top three.
- **Empty and loading:** an empty state centres a Title over a ≤46ch explanation; loading rows are `hover`-coloured shimmer bars that pulse.

### Identity

The recurring athlete signature, used identically in the tables and in the head-to-head ledger: a 26px circular avatar (or a monogram on `hover` ground), the name at Body/600, an emoji or drawn flag carrying its country as an accessible label, a 22×8px belt swatch with a rank bar, and an age as an accent pill. Names link only when Smoothcomp published a public profile id.

### Win-type Bar

A 6px clipped track whose segments are flex-grown by count in the fixed ramp order, with a one-line legend beneath it. The same colours in the same order appear in the filter chips, the ledger's finish markers and the footer key, so the vocabulary is learned once.

### Academy Head-to-Head

- **Comparison band:** three columns on a `raised` ground bled to the panel edges. Each side carries its academy name, win count and finish mix; the leader's name takes a `LEADS` marker and its count takes accent.
- **The record** (28px) is the centre and the verdict: its leading digit is accent, its trailing digit steps back to `secondary-ink`, and the en dash between them is muted. Under it sit the match count and a `POINTS` line built by the same rule — so when wins and points disagree, the accent flips between the two lines and the split is visible without reading either number.
- **Ledger rows:** athlete, then the division link over a finish marker and the score, then athlete. The winner's name takes the `accent-soft` pill and an uppercase `WINNER`. Scores are read in the row's own left-to-right direction, never in Smoothcomp's bracket-seeding order.

### Rankings Toplist

Cells injected into Smoothcomp's own ranking rows: a centred figure with an uppercase label, a 3px `currentColor` bar on a translucent grey track, and a win/loss mix in green and red. A pill toolbar above the list carries the win-type filters. Nothing here uses a panel token, and an adjusted win rate is marked with an asterisk on its label rather than with a colour.

### Named Rules

**The Second Reading Rule.** Every state that colour communicates also exists in text or shape. The winner has a `WINNER` label, the leader has `LEADS`, the sorted column has a caret, the adjusted rate has an asterisk. Remove all colour and the panel still reports correctly.

## Do's and Don'ts

### Do:

- **Do** read the host backdrop at runtime and stamp `data-scwr-theme`; light is the fallback for an unknown host.
- **Do** keep the win-type vocabulary — order, colour and label — identical in bars, chips, ledger markers and the footer key.
- **Do** ask `@container scwr` for every width-dependent rule.
- **Do** keep numerals tabular, and metadata on one line with the full text in a `title`.
- **Do** pair every colour-carried state with a text or shape reading of the same fact.
- **Do** derive the head-to-head aggregate and its complete ledger from one filtered match set, and show every counted match.
- **Do** read a finished event's match scores from local storage; they never change, so only the matches missing from the cache are fetched.

### Don't:

- **Don't** introduce a font family, an outer shadow, an elevation scale or a second accent.
- **Don't** declare a `font-size` outside the Type block, or a seventh step inside it. A component that needs different type joins the step it belongs to.
- **Don't** paint injected cells on Smoothcomp's own rows with panel tokens; they borrow `currentColor`.
- **Don't** copy one theme's win-type hexes into the other — the ramp inverts.
- **Don't** draw a comparison as a full-width rail with a marker on it. A track with a handle reads as a control, and these are results.
- **Don't** repeat a figure that is already stated nearby; the record carries the wins result, so nothing else needs to.
- **Don't** hide direct matches behind pagination, disclosure or a summary-only view.
- **Don't** link hidden or unresolved athletes to guessed profiles.
- **Don't** treat the narrow-container rules as a mobile product; this is a desktop surface defending itself against a cramped host.
