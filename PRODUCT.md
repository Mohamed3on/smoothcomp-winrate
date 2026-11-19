# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Chrome extension: plain script tags, no build step, no dependencies. Shared server: one Cloudflare Worker (`server/`, `mat-stats.mohamed3on.workers.dev`) over D1. The public stats site is static files served by that same Worker, plus GET routes on it. No framework and no build step.

## Users

Grapplers, coaches and academy owners who compete on Smoothcomp (and AJP Tour, which runs its own Smoothcomp). They are sizing up a bracket, an opponent, their own team, or an event they entered or watched, usually on a desktop.

## Product Purpose

Mat Stats recounts Smoothcomp's competition numbers from the event's own match list, and adds views Smoothcomp doesn't have: walkover-free records, athlete and academy leaderboards, head-to-heads, and brackets ranked by career. Every install shares what it reads through one server cache. The public site makes that shared data browsable outside Smoothcomp: rankings, and pages for each athlete, team and event.

## Positioning

These numbers are recounted, not copied: walkovers are left out unless the reader counts them, and careers come from many installs reading Smoothcomp. Smoothcomp itself shows no cross-event rankings and counts walkovers as wins.

## Operating Context

The extension runs on Smoothcomp results and participants pages and uploads what they show: careers (wins by finish type, medals, events entered), belts, per-event records and placements, athlete identity (name, academy, country, photo unless the profile is hidden), and event details (title, date, city, organiser). The data grows as people browse. Careers expire after 30 days; identity, events and results stay.

## Capabilities and Constraints

- Careers carry wins by finish type and medals, but no losses. Losses are known only from results pages the extension has seen.
- Hidden profiles: no photo, no profile link, no career. Their recorded results still count.
- Quality filters the user asked for: minimum events and wins, walkovers excluded, belt, and site (Smoothcomp or AJP).
- Desktop first. The site is public.

## Brand Commitments

The name is Mat Stats. The voice is plain and factual, and every number says what it counts.

## Evidence on Hand

Live D1 data (`mat-stats-careers`). Nothing about users or usage may be invented.

## Product Principles

- Say what each number counts, and say how much data stands behind it.
- Walkovers are not wins unless the reader asks for them.
- Never link a hidden athlete to a guessed profile.
- Small samples are filtered out, not dressed up as rankings.
