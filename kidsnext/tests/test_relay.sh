# shellcheck shell=bash
# the relay page of the Spotify login (node, as the box's server)

if command -v node >/dev/null; then
	if out=$(node "${KN}/tests/relay-page.test.js" "${KN}/relay/callback/index.html" 2>&1); then
		ok "Spotify-Weiterleitung: $(grep -c '^ok' <<< "${out}") Fälle, CSP-Hash stimmt"
	else
		nok "Spotify-Weiterleitung" "$(grep -v '^ok' <<< "${out}")"
	fi
else
	echo "  - node nicht installiert, übersprungen"
fi
