# Standalone import feasibility: access blocked

Tested on 2026-09-06 from the local workspace host. No cloud hosting environment
was configured or tested. See `results.json` for timestamps and responses.

## Result

All five direct HTTP probes returned HTTP 403 and a Cloudflare challenge page:

| Event | Host | Page |
| --- | --- | --- |
| 19856 | jjlg.smoothcomp.com | Match list |
| 19856 | jjlg.smoothcomp.com | Results |
| 19856 | jjlg.smoothcomp.com | Participants |
| 19856 | smoothcomp.com | Match list |
| 27400 | smoothcomp.com | Match list |

The repeatable probe explicitly disables curl configuration and supplies no
cookies, credentials, browser state, or authorization headers. It stores only
sanitized response metadata, not HTML challenge tokens or cookies.

A separate fresh headless Chromium session also displayed Cloudflare's
"Performing security verification" screen. Clicking the verification checkbox
did not provide access; the subsequent snapshot still showed the challenge.
That session was closed after testing.

## Reproduce

From the workspace root:

```sh
rtk proxy python3 plans/standalone-import-proof/probe.py
```

Exit 1 means at least one access check failed. Exit 0 would only confirm that
expected page markers are accessible, not that a complete event was imported.
Results and participant page markers can identify an application shell without
proving that the underlying JSON data is available.

## What remains unproven

- Cookie-free access to the underlying results and participant JSON endpoints.
- Import from a deployed server.
- Complete match pagination and deduplication.
- Athlete and bracket identity joins, actual field sizes, and medal counts.
- Reconciliation of calculated statistics with the official event results.

No full event dataset or leaderboard was produced. These results establish that
simple unauthenticated page fetching fails in this environment; they do not
establish that every permitted integration route is impossible. The next useful
investigation is to observe the underlying JSON requests in an accessible
browser, then test those exact endpoints without its cookies. An agreed data
feed or organizer-provided export is another possible source, not tested here.
