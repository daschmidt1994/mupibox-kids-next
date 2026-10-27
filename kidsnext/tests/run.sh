#!/bin/bash
#
# Automatic tests of Kids Next that run without a Raspberry Pi (shellcheck + unit tests on recorded system files).
#   bash kidsnext/tests/run.sh
# Hardware functions are NOT covered here – see docs/testplan.md.

cd "$(dirname "$0")/.." || exit 1
KN=$(pwd)
PASS=0
FAIL=0
TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

ok() { PASS=$((PASS + 1)); echo "  ✔ $1"; }
nok() { FAIL=$((FAIL + 1)); echo "  ✘ $1"; [ -n "$2" ] && echo "      $2"; }
eq() { if [ "$2" = "$3" ]; then ok "$1"; else nok "$1" "erwartet '$3', war '$2'"; fi; }

for t in "${KN}"/tests/test_*.sh; do
	echo "== $(basename "${t}")"
	# shellcheck disable=SC1090
	. "${t}"
done

echo "== shellcheck"
mapfile -t SCRIPTS < <(find "${KN}" -name '*.sh' -not -path '*/tests/*'; find "${KN}/backup" "${KN}/netbird" "${KN}/hardware" -type f -name 'mupi-kn-*' 2>/dev/null)
if command -v shellcheck >/dev/null; then
	if out=$(shellcheck -x -S warning "${SCRIPTS[@]}" 2>&1); then ok "shellcheck (${#SCRIPTS[@]} Dateien)"; else nok "shellcheck" "${out}"; fi
else
	echo "  - shellcheck nicht installiert, übersprungen"
fi

echo
echo "Bestanden: ${PASS}, fehlgeschlagen: ${FAIL}"
[ "${FAIL}" = 0 ]
