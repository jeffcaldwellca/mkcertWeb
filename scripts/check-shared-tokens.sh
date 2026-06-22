#!/usr/bin/env bash
# Verify the SHARED DESIGN LANGUAGE :root block is byte-identical in both stylesheets.
set -euo pipefail
extract() {
  awk '/SHARED DESIGN LANGUAGE/{f=1} f{print} /END SHARED DESIGN LANGUAGE/{f=0}' "$1"
}
a=$(extract docs/assets/styles.css)
b=$(extract public/styles.css)
if [ -z "$a" ]; then echo "FAIL: shared block missing in docs/assets/styles.css"; exit 1; fi
if [ "$a" = "$b" ]; then
  echo "OK: shared design-language block is identical in both stylesheets"
else
  echo "FAIL: shared block differs between docs/assets/styles.css and public/styles.css"
  diff <(printf '%s' "$a") <(printf '%s' "$b") || true
  exit 1
fi
