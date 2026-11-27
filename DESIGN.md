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
  won: "#136338"
  lost: "#ad2620"
  win-submission: "#08477f"
  win-stoppage: "#135ba1"
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

<!-- impeccable:design-map -->
Name: Smoothcomp Winrate
Colors: primary: accent #1565c0; secondary: win-submission #08477f; tertiary: gold #8a6100; neutral: ink #14161a; primary: accent-soft rgba(21, 101, 192, 0.09); secondary: win-points #1d6fc4 (+12 more in the sidecar)
Spacing: s-0 2px, s-1 4px, s-2 8px, s-3 12px, s-4 16px, s-5 20px, s-6 24px, s-7 32px
Radius: segment 1px, belt 2px, bar 3px, sm 4px, md 6px, lg 10px, pill 999px
North Star: "The Incumbent Competition Ledger"
Rules:
- The Host's Clothes Rule. The panel samples the real backdrop it was injected into and stamps `data-scwr-theme` itself.
- The Contrast Ramp Rule. Decisiveness is encoded as contrast against the surface, so the win-type ramp inverts between themes — darkest-is-most-decisive on light, lightest-is-most-decisive on dark.
- The Borrowed Ink Rule. Code injected into markup Smoothcomp drew paints in `currentColor` and `rgba(128,128,128,α)`, never in panel tokens.
- The Encoded Colour Rule. Colour carries meaning or it is not applied.
- The One Line Rule. Metadata never wraps.
- The One Block Rule. Every `font-size` in the panel is declared in the Type block at the top of `results.css` and nowhere else.
- The Borrowed Type Rule. The inline notes drawn onto Smoothcomp's own results sit outside `.scwr-results`, so no panel token resolves for them and the scale does not apply.
- The Tabular Rule. `font-variant-numeric: tabular-nums` is set on the panel root and re-asserted on every figure that escapes it.
- (+6 more)
Don't:
- Don't introduce a font family, an outer shadow, an elevation scale or a second accent.
- Don't declare a `font-size` outside the Type block, or a seventh step inside it.
- Don't paint injected cells on Smoothcomp's own rows with panel tokens; they borrow `currentColor`.
- Don't copy one theme's win-type hexes into the other — the ramp inverts.
- Don't draw a comparison as a full-width rail with a marker on it.
- Don't repeat a figure that is already stated nearby; the record carries the wins result, so nothing else needs to.
- Don't hide direct matches behind pagination, disclosure or a summary-only view.
- Don't link hidden or unresolved athletes to guessed profiles.
- Don't treat the narrow-container rules as a mobile product; this is a desktop surface defending itself against a cramped host.
Map: results.css
Full: .impeccable/design-full.md (read a section when you need its detail)
