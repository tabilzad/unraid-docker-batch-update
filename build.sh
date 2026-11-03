#!/bin/bash
# Build the Slackware package into archive/ and stamp version + MD5 into the .plg.
# Usage: ./build.sh [version]   (default: today's date, YYYY.MM.DD)
set -euo pipefail
cd "$(dirname "$0")"

NAME=docker.batch.update
VERSION=${1:-$(date +%Y.%m.%d)}
PKG="$NAME-$VERSION-noarch-1.txz"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

cp -a src/. "$STAGE/"
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +

# The webGUI reads .page headers line by line: a CR at the end of a line hides
# the tab (release 2026.11.02 shipped like that from a Windows checkout).
# .gitattributes pins the checkout to LF; this is the belt to those braces.
find "$STAGE" -type f ! -name '*.png' -exec sed -i 's/\r$//' {} +
if grep -rlI $'\r' "$STAGE" --include='*.page' --include='*.php' --include='*.js' --include='*.css' --include='*.md' >/dev/null 2>&1; then
  echo "error: CR line endings survived normalisation" >&2
  exit 1
fi

mkdir -p archive
rm -f "archive/$PKG"
if command -v makepkg >/dev/null; then
  (cd "$STAGE" && makepkg -l y -c y "$OLDPWD/archive/$PKG" >/dev/null)
else
  # Fallback for building off-box: a plain tar.xz is what installpkg expects.
  tar --owner=0 --group=0 -C "$STAGE" -cJf "archive/$PKG" .
fi

MD5=$(md5sum "archive/$PKG" | cut -d' ' -f1)
sed -i -E \
  -e "s|(<!ENTITY version +\")[^\"]*|\1$VERSION|" \
  -e "s|(<!ENTITY md5 +\")[^\"]*|\1$MD5|" \
  "plugin/$NAME.plg"

echo "Built archive/$PKG"
echo "MD5 $MD5"
