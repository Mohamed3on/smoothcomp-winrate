"""Probe public Smoothcomp pages without cookies or browser state.

Run: python3 plans/standalone-import-proof/probe.py
Prints sanitized JSON, never response bodies or cookies. Exit 1 means at
least one required page failed. Exit 0 proves page access only, not a full
event import, pagination completeness, identity joins, or correct statistics.
"""

import datetime
import json
import re
import subprocess
import sys
import time


PROBES = [
    ("matches", "https://jjlg.smoothcomp.com/en/event/19856/schedule/matchlist"),
    ("results", "https://jjlg.smoothcomp.com/en/event/19856/results"),
    ("participants", "https://jjlg.smoothcomp.com/en/event/19856/participants"),
    ("matches", "https://smoothcomp.com/en/event/19856/schedule/matchlist"),
    ("matches", "https://smoothcomp.com/en/event/27400/schedule/matchlist"),
]
MARKERS = {
    "matches": 'class="match-row',
    "results": 'id="resultsView"',
    "participants": 'id="registrations"',
}


def probe(kind, url):
    # -q must be first: ignore ~/.curlrc, including any stored cookie config.
    # No cookie jar, browser profile, auth header, or session import is used.
    run = subprocess.run(
        ["curl", "-q", "--silent", "--show-error", "--location",
         "--max-time", "25", "--write-out", "\n%{http_code}", url],
        capture_output=True, text=True, timeout=30,
    )
    body, _, code = run.stdout.rpartition("\n")
    status = int(code) if code.isdigit() else None
    challenge = "challenges.cloudflare.com" in body and (
        "_cf_chl_opt" in body or "Performing security verification" in body
    )
    title = re.search(r"<title>([^<]*)</title>", body, re.IGNORECASE)
    marker_present = MARKERS[kind] in body
    return {
        "kind": kind,
        "url": url,
        "curl_exit": run.returncode,
        "http_status": status,
        "response_bytes": len(body.encode()),
        "page_title": title.group(1)[:160] if title else None,
        "cloudflare_challenge": challenge,
        "expected_page_marker": marker_present,
        "page_access_passed": run.returncode == 0 and status == 200
        and not challenge and marker_present,
    }


def main():
    rows = []
    for index, (kind, url) in enumerate(PROBES):
        if index:
            time.sleep(0.5)
        try:
            rows.append(probe(kind, url))
        except subprocess.TimeoutExpired:
            rows.append({"kind": kind, "url": url, "error": "timeout",
                         "page_access_passed": False})
    passed = all(row["page_access_passed"] for row in rows)
    print(json.dumps({
        "tested_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "environment": "local workspace host; no cloud deployment tested",
        "browser_state_imported": False,
        "curl_config_disabled": True,
        "page_access_passed": passed,
        "full_import_proven": False,
        "probes": rows,
    }, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
