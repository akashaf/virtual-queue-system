#!/bin/sh
# Waits for Netlify to finish the production deploy of a commit, then prints
# `wait-deploy: ready <sha>` (exit 0) or `wait-deploy: <state> <sha> <Netlify's message>`
# (exit 1). Every session that pushed used to hand-write this loop, and the `until` form
# of it is easy to invert (gotchas.md, Shell). Needs the global `netlify` CLI, logged in.
#
#   scripts/wait-deploy.sh [sha]   defaults to HEAD
set -eu

tries=60
interval=20

sha=$(git rev-parse --short=7 "${1:-HEAD}")
site=$(netlify status --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["siteData"]["site-id"])')

i=0
while [ $i -lt $tries ]; do
  # Only production deploys count: an old branch deploy of the same commit is in the list
  # too. A failed request prints nothing and is retried on the next round.
  line=$(netlify api listSiteDeploys --data "{\"site_id\":\"$site\",\"per_page\":10}" 2>/dev/null | python3 -c '
import json, sys
sha = sys.argv[1]
try:
    deploys = json.load(sys.stdin)
except ValueError:
    sys.exit()
for deploy in deploys if isinstance(deploys, list) else []:
    if deploy.get("context") == "production" and (deploy.get("commit_ref") or "").startswith(sha):
        print(" ".join(filter(None, [deploy["state"], sha, deploy.get("error_message")])))
        break
' "$sha") || line=""
  case $line in
    ready*) echo "wait-deploy: $line"; exit 0 ;;
    error* | rejected* | skipped* | cancelled*) echo "wait-deploy: $line"; exit 1 ;;
  esac
  i=$((i + 1))
  sleep $interval
done
echo "wait-deploy: timeout $sha, no finished deploy after $((tries * interval / 60)) minutes" >&2
exit 1
