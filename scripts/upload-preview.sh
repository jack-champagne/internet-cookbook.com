#!/usr/bin/env bash
# Upload the site as a preview version of the Worker under a stable alias
# (pr-<number>, draft) without deploying it to the live site.
#   usage: scripts/upload-preview.sh <alias> <message>
# Writes the preview URL to $GITHUB_OUTPUT as `url` when run in Actions.
set -euo pipefail
alias="$1"
message="$2"

# Previews must never be indexed. Production has no _headers file of its own
# yet, so a temporary one is added for the upload and removed afterwards.
headers=public/_headers
if [ -e "$headers" ]; then
  echo "public/_headers exists; merge the noindex rule into it before using this script" >&2
  exit 1
fi
trap 'rm -f "$headers"' EXIT
printf '/*\n  X-Robots-Tag: noindex\n' > "$headers"

out=$(npx wrangler versions upload --preview-alias "$alias" --message "$message" 2>&1 | tee /dev/stderr)
url=$(printf '%s\n' "$out" | grep -i 'alias' | grep -oE 'https://[^ ]+\.workers\.dev' | tail -1)
if [ -z "$url" ]; then
  echo "Could not find the preview URL in Wrangler's output" >&2
  exit 1
fi
echo "Preview: $url"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "url=$url" >> "$GITHUB_OUTPUT"; fi
