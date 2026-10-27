#!/bin/bash
#
# Kids Next self-test: is everything there and running? Prints one line per check, in German for the parents.
#   mupibox-kn-selftest            on a running box (after the restart)
#   mupibox-kn-selftest --install  right after the installation, before the restart (no checks of running services)
#   mupibox-kn-selftest --json     the result as JSON (for the app's dashboard)
# Exit code: 0 all fine, 1 at least one error (warnings do not count).

MODE=running
JSON=0
for arg in "$@"; do
	case "${arg}" in
		--install) MODE=install ;;
		--json) JSON=1 ;;
	esac
done

RESULTS=()
FAILED=0

result() {
	# result <ok|warn|fail> <id> <text>
	RESULTS+=("$1|$2|$3")
	[ "$1" = "fail" ] && FAILED=1
	[ "${JSON}" = 1 ] && return
	case "$1" in
		ok) printf '  \e[32m✔\e[0m %s\n' "$3" ;;
		warn) printf '  \e[33m!\e[0m %s\n' "$3" ;;
		fail) printf '  \e[31m✘\e[0m %s\n' "$3" ;;
	esac
}

check() {
	# check <id> <text> <command...>: ok when the command succeeds, fail otherwise
	local id="$1" text="$2"
	shift 2
	if "$@" >/dev/null 2>&1; then result ok "${id}" "${text}"; else result fail "${id}" "${text}"; fi
}

soft_check() {
	local id="$1" text="$2"
	shift 2
	if "$@" >/dev/null 2>&1; then result ok "${id}" "${text}"; else result warn "${id}" "${text}"; fi
}

SKC=/home/dietpi/.mupibox/Sonos-Kids-Controller-master
CONFIG=/etc/mupibox/mupiboxconfig.json

check node "Node.js vorhanden" command -v node
check mpv "Player mpv vorhanden" command -v mpv
check chromium "Browser für das Display vorhanden" sh -c 'command -v chromium || command -v chromium-browser'
check server_files "MuPiBox-Server installiert" test -s "${SKC}/server.js"
check config "Einstellungen lesbar" jq -e . "${CONFIG}"
if [ -f "${SKC}/server/config/data.json" ]; then
	check library "Medienliste lesbar" jq -e . "${SKC}/server/config/data.json"
fi
check no_web_root "Webserver ohne Root-Rechte" test ! -e /etc/sudoers.d/www-data
check secrets_dir "Ordner für Zugangsdaten geschützt" sh -c '[ "$(stat -c %a /etc/mupibox-kn/secrets)" = 700 ]'
soft_check soundcard "Soundkarte erkannt" sh -c 'aplay -l 2>/dev/null | grep -q "^card"'
soft_check netbird "NetBird installiert" command -v netbird
if [ -f /var/lib/mupibox-kn/hat.json ]; then
	case "$(jq -r .result /var/lib/mupibox-kn/hat.json 2>/dev/null)" in
		present) soft_check mupihat "MuPiHAT erkannt und eingeschaltet" sh -c '[ "$(jq -r ".mupihat.hat_active // false" /etc/mupibox/mupiboxconfig.json)" = true ]' ;;
		absent) result ok mupihat "Kein MuPiHAT verbaut" ;;
		*) result warn mupihat "MuPiHAT-Erkennung läuft beim nächsten Start" ;;
	esac
fi

if [ "${MODE}" = "running" ]; then
	check pm2 "Dienst pm2-dietpi läuft" systemctl is-active -q pm2-dietpi
	check api "MuPiBox-Server antwortet (Port 8200)" curl -fsS -o /dev/null -m 5 http://127.0.0.1:8200/
	check app "Eltern-App erreichbar" sh -c 'code=$(curl -ks -o /dev/null -w "%{http_code}" -m 5 https://127.0.0.1/app/); [ "${code}" -ge 200 ] && [ "${code}" -lt 500 ]'
	soft_check display "Display-Oberfläche läuft" pgrep -f chromium
	soft_check netbird_service "Dienst netbird aktiv" systemctl is-active -q netbird
	for unit in mupi_startstop mupi_wifi mupi_check_internet; do
		soft_check "unit_${unit}" "Dienst ${unit} aktiv" systemctl is-active -q "${unit}"
	done
	failed_units=$(systemctl --failed --no-legend --plain 2>/dev/null | awk '{print $1}' | grep -E '^(mupi|pm2|kn-|mupibox)' | tr '\n' ' ')
	if [ -n "${failed_units}" ]; then
		result warn failed_units "Fehlgeschlagene Dienste: ${failed_units}"
	else
		result ok failed_units "Keine fehlgeschlagenen MuPiBox-Dienste"
	fi
fi

if [ "${JSON}" = 1 ]; then
	printf '%s\n' "${RESULTS[@]}" | jq -Rn --arg mode "${MODE}" --arg date "$(date -Iseconds)" '
		[inputs | split("|") | {status: .[0], id: .[1], text: (.[2:] | join("|"))}] as $r
		| {date: $date, mode: $mode, ok: ([$r[] | select(.status == "fail")] | length == 0), checks: $r}'
fi
exit ${FAILED}
