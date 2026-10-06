#!/bin/bash
# Copy the plugin straight into the running web UI for quick testing.
# RAM only: gone after a reboot. Undo with: ./dev-deploy.sh --remove
set -euo pipefail
cd "$(dirname "$0")"
DEST=/usr/local/emhttp/plugins/docker.batch.update
if [ "${1:-}" = "--remove" ]; then
  rm -rf "$DEST" && echo "Removed $DEST"
  exit 0
fi
mkdir -p "$DEST"
rsync -a --delete src/usr/local/emhttp/plugins/docker.batch.update/ "$DEST/"
echo "Deployed to $DEST - open Docker > Batch Update"
