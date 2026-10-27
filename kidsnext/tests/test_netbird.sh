# shellcheck shell=bash
# mupi-kn-netbird against a stand-in for the netbird program (records its arguments and the key file's content)

(
	NBT="${TMP}/nb"
	mkdir -p "${NBT}/run"
	cat > "${NBT}/netbird" <<'FAKE'
#!/bin/bash
D=$(dirname "$0")
case "$1" in
	status)
		cat "${D}/status.json"
		;;
	up)
		printf '%s\n' "$@" > "${D}/up-args"
		while [ $# -gt 0 ]; do
			[ "$1" = --setup-key-file ] && { cat "$2" > "${D}/key-seen"; ls -l "$2" | cut -c1-10 > "${D}/key-mode"; }
			shift
		done
		exit "$(cat "${D}/up-rc" 2>/dev/null || echo 0)"
		;;
	down) echo down > "${D}/down" ;;
esac
FAKE
	chmod +x "${NBT}/netbird"
	export KN_NETBIRD_BIN="${NBT}/netbird" KN_NETBIRD_TEST=1 KN_RUN_DIR="${NBT}/run"
	T="${KN}/netbird/mupi-kn-netbird"

	cat > "${NBT}/status.json" <<'J'
{"peers":{"total":5,"connected":3,"details":[]},"cliVersion":"0.59.0","daemonVersion":"0.59.0","daemonStatus":"Connected",
 "management":{"url":"https://netbird.example.com:443","connected":true,"error":""},"netbirdIp":"100.112.5.6/16","fqdn":"mupibox-jakob.netbird.selfhosted"}
J
	out=$(bash "${T}" status --json)
	eq "status: verbunden" "$(jq -r .daemonStatus <<< "${out}")" "Connected"
	eq "status: IP ohne Präfix" "$(jq -r .ip <<< "${out}")" "100.112.5.6"
	eq "status: Peers" "$(jq -r '"\(.peersConnected)/\(.peersTotal)"' <<< "${out}")" "3/5"

	printf 'ABCD1234-1111-2222-3333-444455556666\n' | bash "${T}" up --url https://netbird.example.com --hostname mupibox-jakob --key-stdin --json > "${NBT}/up-out"
	eq "up: Antwort ok" "$(jq -r .ok "${NBT}/up-out")" "true"
	eq "up: Key kommt als Datei an" "$(cat "${NBT}/key-seen")" "ABCD1234-1111-2222-3333-444455556666"
	eq "up: Key-Datei nur für root lesbar" "$(cat "${NBT}/key-mode")" "-rw-------"
	if grep -q ABCD1234 "${NBT}/up-args"; then nok "up: Key nicht in den Argumenten"; else ok "up: Key nicht in den Argumenten"; fi
	eq "up: Key-Datei danach gelöscht" "$(find "${NBT}/run" -name 'nb-key.*' | wc -l)" "0"
	eq "up: Server übergeben" "$(sed -n '/--management-url/{n;p}' "${NBT}/up-args")" "https://netbird.example.com"

	bash "${T}" up --url 'https://x.example.com;reboot' --key-stdin --json <<< "ABCD1234-1111" > "${NBT}/bad" 2>/dev/null
	eq "up: ungültige Adresse abgelehnt (Exit 2)" "$?" "2"
	bash "${T}" up --url https://netbird.example.com --key-stdin --json <<< '$(reboot)' > /dev/null 2>&1
	eq "up: ungültiger Key abgelehnt" "$?" "2"

	sed -i 's/"daemonStatus":"Connected"/"daemonStatus":"NeedsLogin"/' "${NBT}/status.json"
	rm -f "${NBT}/up-args"
	bash "${T}" up --url https://netbird.example.com --json > /dev/null 2>&1
	eq "up ohne Key bei nicht angemeldeter Box abgelehnt" "$?" "3"
	eq "up ohne Key: netbird nicht aufgerufen" "$([ -e "${NBT}/up-args" ] && echo ja || echo nein)" "nein"

	echo 1 > "${NBT}/up-rc"
	out=$(printf 'ABCD1234-1111-2222-3333-444455556666\n' | bash "${T}" up --url https://netbird.example.com --key-stdin --json)
	eq "up: Fehler von netbird gemeldet" "$(jq -r .ok <<< "${out}")" "false"

	KN_NETBIRD_BIN="${NBT}/fehlt" bash "${T}" status --json > "${NBT}/missing"
	eq "status ohne NetBird: nicht installiert" "$(jq -r .installed "${NBT}/missing")" "false"
	echo "PASS=${PASS} FAIL=${FAIL}" > "${TMP}/counts"
)
# shellcheck disable=SC1091
. "${TMP}/counts"
