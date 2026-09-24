#!/usr/bin/env bash
# Wait for the host's deploy to finish for a pushed commit, reading the commit
# status on GitHub (config "deploy.status" names the context, default "Vercel").
# The live site is often unreachable from an agent sandbox; api.github.com is not.
#
# Usage: wait-deploy.sh [sha]        (defaults to HEAD; run from the host repo root)
# Exit:  0 deployed · 1 failed or blocked · 2 still pending after ~6 minutes
# Prints the final state, the provider's description, and the deployment's log URL.

set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SHA=$(git rev-parse "${1:-HEAD}")
CONTEXT=$(node "$HERE/config.mjs" deploy.status 2>/dev/null || echo Vercel)
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)
[ -n "$REPO" ] || REPO=$(git remote get-url origin | sed -E 's#^(https://github.com/|git@github.com:)##; s#\.git$##')
[ -n "$REPO" ] || { echo "wait-deploy: cannot tell which GitHub repo this is"; exit 1; }

for i in $(seq 1 36); do
  line=$(gh api "repos/$REPO/commits/$SHA/status" \
    --jq "[.statuses[] | select(.context==\"$CONTEXT\")][0] | [.state, .description, .target_url] | @tsv" 2>/dev/null)
  state=$(printf '%s' "$line" | cut -f1)
  case "$state" in
    success) echo "deployed  ${SHA:0:7}  $(printf '%s' "$line" | cut -f2-)"; exit 0 ;;
    failure|error) echo "FAILED  ${SHA:0:7}  $(printf '%s' "$line" | cut -f2-)"; exit 1 ;;
  esac
  sleep 10
done
echo "still pending after 6 minutes  ${SHA:0:7}  ${line:-no $CONTEXT status yet}"
exit 2
