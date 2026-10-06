#!/bin/bash
# Copy the plugin straight into the running web UI for quick testing.
# RAM only: gone after a reboot. Undo with: ./dev-deploy.sh --remove
set -euo pipefail
cd "$(dirname "$0")"
DEST=/usr/local/emhttp/plugins/docker.batch.update
# A real (Plugins page) install is tracked by Unraid; touching its files by hand
# leaves Unraid believing the plugin is installed when it isn't, or vice versa.
if [ -e /var/log/plugins/docker.batch.update.plg ]; then
  echo "docker.batch.update is installed as a plugin. Remove it first with:"
  echo "  plugin remove docker.batch.update.plg   (or Plugins page > Remove)"
  exit 1
fi
if [ "${1:-}" = "--remove" ]; then
  rm -rf "$DEST" && echo "Removed $DEST"
  exit 0
fi
mkdir -p "$DEST"
rsync -a --delete src/usr/local/emhttp/plugins/docker.batch.update/ "$DEST/"
echo "Deployed to $DEST - open Docker > Batch Update"
