#!/bin/sh
# Reads production errors from Sentry, one short line each, so a session need not rebuild the
# curl, the region and the JSON parsing every time (gotchas.md, Sentry). Read-only: it uses
# $SENTRY_READ_TOKEN, the user's personal token with Read scopes only, and never prints it.
#
#   scripts/sentry.sh issues          unresolved issues of the last 14 days, newest first
#   scripts/sentry.sh since [sha]     issues first seen on that deployed commit (default HEAD)
#   scripts/sentry.sh events <id>     one issue's latest events: release, browser, stack, breadcrumbs
#   scripts/sentry.sh csp             Content-Security-Policy reports of the last 14 days, resolved too
set -eu

api="https://us.sentry.io/api/0/organizations/akashaf"

# A shell started before the token went into ~/.zshrc does not have it; a fresh one does. The
# value is marked, because an interactive zsh on macOS may print "Restored session: …" first,
# and an unset token must read as empty rather than as that line.
token=${SENTRY_READ_TOKEN:-$(zsh -ic 'printf "token=%s\n" "${SENTRY_READ_TOKEN:-}"' 2>/dev/null |
  sed -n 's/^token=//p' | tail -n 1 || true)}
if [ -z "$token" ]; then
  echo "sentry: SENTRY_READ_TOKEN is not set (see docs/agents/gotchas.md, Sentry)" >&2
  exit 1
fi

# Fetched into a variable before parsing, so a failed request stops here rather than
# handing nothing to the parser.
get() {
  body=$(curl -sf -H "Authorization: Bearer $token" "$api/$1") || {
    echo "sentry: request failed: $1" >&2
    exit 1
  }
}

issues() {
  python3 -c '
import json, sys
issues = json.load(sys.stdin)
if not issues:
    print("sentry: no issues")
for x in issues:
    print(x["shortId"], x["id"], "first", x["firstSeen"][:16], "last", x["lastSeen"][:16],
          "x" + str(x["count"]), "|", x["title"][:100], "|", x.get("culprit") or "")
'
}

case ${1:-} in
  issues)
    get "issues/?query=is:unresolved&statsPeriod=14d&sort=date&limit=25"
    printf %s "$body" | issues
    ;;
  since)
    # Each event's release is the full commit sha the deploy was built from.
    sha=$(git rev-parse "${2:-HEAD}")
    get "issues/?query=firstRelease:$sha&statsPeriod=14d&sort=date&limit=25"
    printf %s "$body" | issues
    ;;
  events)
    [ -n "${2:-}" ] || { echo "usage: scripts/sentry.sh events <issue id>" >&2; exit 2; }
    get "issues/$2/events/?full=true&limit=5"
    printf %s "$body" | python3 -c '
import json, sys
events = json.load(sys.stdin)
for e in events:
    tags = {t["key"]: t["value"] for t in e.get("tags", [])}
    print(e["dateCreated"][:19], (tags.get("release") or "")[:7], tags.get("browser"), "|",
          tags.get("os"), "|", tags.get("url"))
if events:
    for entry in events[0]["entries"]:
        if entry["type"] == "exception":
            for value in entry["data"]["values"]:
                print("error:", value["type"], "|", ((value.get("value") or "").splitlines() or [""])[0])
                for frame in ((value.get("stacktrace") or {}).get("frames") or [])[-6:]:
                    print("   at", frame.get("filename"), frame.get("function"), frame.get("lineNo"))
        if entry["type"] == "breadcrumbs":
            for crumb in entry["data"]["values"][-8:]:
                detail = crumb.get("message") or json.dumps(crumb.get("data"))
                print("  ", (crumb.get("timestamp") or "")[11:19], crumb.get("category"), detail[:110])
'
    ;;
  csp)
    # Reports are issues of type csp, not the Feed, and an issue already reviewed is resolved,
    # which `issues` would hide. Each report line: when, browser, what was blocked, by which
    # directive, on which page, and whether it was blocked (enforce) or only reported.
    get "issues/?query=event.type:csp&statsPeriod=14d&sort=date&limit=25"
    ids=$(printf %s "$body" | python3 -c '
import json, sys
issues = json.load(sys.stdin)
if not issues:
    print("sentry: no csp reports")
for x in issues:
    print(x["id"])
')
    for id in $ids; do
      get "issues/$id/events/?full=true&statsPeriod=14d&limit=100"
      printf %s "$body" | python3 -c '
import json, sys
for e in json.load(sys.stdin):
    tags = {t["key"]: t["value"] for t in e.get("tags", [])}
    for entry in e["entries"]:
        if entry["type"] == "csp":
            d = entry["data"]
            print(e["dateCreated"][:16], tags.get("browser"), "|", d.get("blocked_uri"), "|",
                  d.get("effective_directive"), "|", d.get("document_uri"), "|", d.get("disposition"))
'
    done
    ;;
  *)
    sed -n '6,9p' "$0" | sed 's/^# *//'
    exit 2
    ;;
esac
