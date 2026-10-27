#!/bin/bash
#
# MuPiBox Kids Next – Installation auf einem frischen DietPi (und erneut auf einer bestehenden Box, ohne Datenverlust).
#
#   curl -fsSL https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/install.sh | sudo bash
#   sudo bash kidsnext/install.sh [--new|--restore] [--yes] [--no-reboot] [--ref <branch|tag>]
#
# Without a checkout next to it (the curl line) the script fetches the sources of --ref first and starts again from them.

set -o pipefail

KN_REPO="${KN_REPO:-daschmidt1994/mupibox-kids-next}"
KN_REF="${KN_REF:-kids-next}"
KN_MODE=""
KN_YES="${KN_YES:-0}"
KN_NO_REBOOT_ARG=0

usage() {
	cat <<EOF
MuPiBox Kids Next – Installer

  sudo bash install.sh [Optionen]

  --new          Neuinstallation (bzw. Reparatur einer bestehenden Box, Daten bleiben erhalten)
  --restore      Wiederherstellung aus einem NAS-Backup
  --yes          keine Rückfragen (für automatische Läufe)
  --no-reboot    am Ende nicht neu starten
  --ref <name>   Branch oder Tag von ${KN_REPO} (Standard: ${KN_REF})
  --help         diese Hilfe
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--new) KN_MODE=new ;;
		--restore) KN_MODE=restore ;;
		--yes|-y) KN_YES=1 ;;
		--no-reboot) KN_NO_REBOOT_ARG=1 ;;
		--ref) KN_REF="$2"; shift ;;
		--help|-h) usage; exit 0 ;;
		*) echo "Unbekannte Option: $1" >&2; usage >&2; exit 2 ;;
	esac
	shift
done

if [ "$(id -u)" != "0" ]; then
	echo "Bitte mit sudo starten: sudo bash $0" >&2
	exit 1
fi

# The checkout this script belongs to: kidsnext/install.sh -> its parent folder
KN_SELF="${BASH_SOURCE[0]}"
KN_ROOT=""
if [ -f "${KN_SELF}" ]; then
	KN_ROOT="$(cd "$(dirname "${KN_SELF}")/.." && pwd)"
fi

# ---------------------------------------------------------------------------------------------------------------------
# Bootstrap: started by curl (no checkout) - fetch the sources and start again from them
if [ -z "${KN_ROOT}" ] || [ ! -f "${KN_ROOT}/kidsnext/installer/lib.sh" ] || [ ! -f "${KN_ROOT}/autosetup/autosetup.sh" ]; then
	if ! [[ "${KN_REF}" =~ ^[A-Za-z0-9._/-]+$ ]] || ! [[ "${KN_REPO}" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
		echo "Ungültiger Branch/Tag oder Repository." >&2
		exit 2
	fi
	SRC_BASE=/opt/mupibox-kn/src
	echo "==> Lade MuPiBox Kids Next (${KN_REPO}, ${KN_REF}) ..."
	mkdir -p "${SRC_BASE}"
	TMP_DIR=$(mktemp -d "${SRC_BASE}/.download.XXXXXX") || exit 1
	# the commit the branch or tag stands at now: it is downloaded exactly, and the app compares it for updates
	KN_COMMIT=$(curl -fsS -m 20 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/${KN_REPO}/commits/${KN_REF}" 2>/dev/null)
	[[ "${KN_COMMIT}" =~ ^[0-9a-f]{40}$ ]] || KN_COMMIT=""
	export KN_COMMIT
	if ! curl -fsSL --retry 3 --retry-delay 3 -m 600 "https://codeload.github.com/${KN_REPO}/tar.gz/${KN_COMMIT:-${KN_REF}}" | tar -xz -C "${TMP_DIR}"; then
		rm -rf "${TMP_DIR}"
		echo "  ✘ Download fehlgeschlagen. Ist die Box mit dem Internet verbunden?" >&2
		exit 1
	fi
	UNPACKED=$(find "${TMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)
	[ -f "${UNPACKED}/kidsnext/install.sh" ] || { rm -rf "${TMP_DIR}"; echo "  ✘ Im Download fehlt kidsnext/install.sh." >&2; exit 1; }
	rm -rf "${SRC_BASE}/current"
	mv "${UNPACKED}" "${SRC_BASE}/current"
	rm -rf "${TMP_DIR}"
	ARGS=(--ref "${KN_REF}")
	[ -n "${KN_MODE}" ] && ARGS+=("--${KN_MODE}")
	[ "${KN_YES}" = 1 ] && ARGS+=(--yes)
	[ "${KN_NO_REBOOT_ARG}" = 1 ] && ARGS+=(--no-reboot)
	# (stdin back from the terminal: under "curl | bash" it is the pipe, and the questions below need the keyboard)
	# (only when there is a terminal: under systemd /dev/tty exists but cannot be opened, and the exec would fail)
	if (exec < /dev/tty) 2>/dev/null; then
		exec bash "${SRC_BASE}/current/kidsnext/install.sh" "${ARGS[@]}" < /dev/tty
	fi
	exec bash "${SRC_BASE}/current/kidsnext/install.sh" "${ARGS[@]}"
fi

# ---------------------------------------------------------------------------------------------------------------------
KN_VERSION="$(tr -d '[:space:]' < "${KN_ROOT}/kidsnext/VERSION")"
# (a git checkout: its commit; the download above set it already)
[ -z "${KN_COMMIT}" ] && [ -d "${KN_ROOT}/.git" ] && KN_COMMIT=$(git -C "${KN_ROOT}" rev-parse HEAD 2>/dev/null)
KN_INSTALLER="${KN_ROOT}/kidsnext/installer"
# shellcheck source=installer/lib.sh
. "${KN_INSTALLER}/lib.sh"
# shellcheck source=installer/detect-system.sh
. "${KN_INSTALLER}/detect-system.sh"

mkdir -p "${KN_LOG_DIR}" "${KN_STATE_DIR}"
KN_LOG="${KN_LOG_DIR}/install-$(date +%Y%m%d-%H%M%S).log"
: > "${KN_LOG}"
chmod 600 "${KN_LOG}"

# One installer at a time (a second SSH session, or the update from the app)
exec 8> /run/mupibox-kn-install.lock
flock -n 8 || kn_die "Es läuft bereits eine Installation oder ein Update." "Warten, bis sie fertig ist."

kn_copy_log_to_boot() {
	# (DietPi keeps /var/log in RAM: the copy on the boot partition can be read on a PC when the box does not start)
	[ -n "${KN_BOOT_DIR}" ] && [ -d "${KN_BOOT_DIR}" ] && cp -f "${KN_LOG}" "${KN_BOOT_DIR}/mupibox-kn-install.log" 2>/dev/null
}
trap kn_copy_log_to_boot EXIT

echo
echo "${KN_C_BOLD}MuPiBox Kids Next ${KN_VERSION}${KN_C_OFF}"
echo

# ---------------------------------------------------------------------------------------------------------------------
kn_info "System prüfen"
kn_detect_system
kn_print_system | tee -a "${KN_LOG}"
kn_check_system || kn_die "Dieses System wird nicht unterstützt." "Offizielles DietPi-Image (64 Bit empfohlen) auf die SD-Karte schreiben und erneut starten."
kn_ok "System unterstützt"

kn_info "Voraussetzungen prüfen"
ROOT_FREE_MB=$(df -Pm / | awk 'NR == 2 { print $4 }')
[ "${ROOT_FREE_MB:-0}" -ge 2048 ] || kn_die "Zu wenig freier Speicher auf der SD-Karte (${ROOT_FREE_MB} MB, nötig sind 2048 MB)." "Größere SD-Karte verwenden (mindestens 16 GB)."
kn_ok "Freier Speicher: ${ROOT_FREE_MB} MB"
if ! curl -fsS -o /dev/null -m 15 https://github.com; then
	kn_die "Keine Internetverbindung." "Netzwerkkabel anschließen oder WLAN mit 'dietpi-config' > Network Options einrichten, dann erneut starten."
fi
kn_ok "Internetverbindung vorhanden"
if kn_have timedatectl && [ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" != "yes" ]; then
	# (a clock far off breaks TLS downloads and apt; DietPi syncs it at the start, but not always before the first login)
	kn_warn "Die Uhrzeit ist noch nicht synchronisiert – warte bis zu 60 s."
	for _ in $(seq 1 30); do
		[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" = "yes" ] && break
		sleep 2
	done
fi

# ---------------------------------------------------------------------------------------------------------------------
KN_EXISTING=0
[ -f /home/dietpi/.mupi.install ] && KN_EXISTING=1

if [ -z "${KN_MODE}" ]; then
	if [ "${KN_YES}" = 1 ]; then
		KN_MODE=new
	elif kn_have whiptail; then
		if [ "${KN_EXISTING}" = 1 ]; then
			NEW_TEXT="Installation reparieren / aktualisieren (Daten bleiben)"
		else
			NEW_TEXT="Neuinstallation"
		fi
		KN_MODE=$(whiptail --title "MuPiBox Kids Next ${KN_VERSION}" --menu "Was soll gemacht werden?" 14 72 3 \
			new "${NEW_TEXT}" \
			restore "Wiederherstellung aus NAS-Backup (neue SD-Karte)" \
			3>&1 1>&2 2>&3) || { echo "Abgebrochen."; exit 0; }
	else
		KN_MODE=new
	fi
fi
kn_log "mode=${KN_MODE} existing=${KN_EXISTING} version=${KN_VERSION}"

KN_RESTORE_HELPER="${KN_ROOT}/kidsnext/backup/mupi-kn-restore"
# (the version the restore compares a backup with: this one, which is about to be installed)
export KB_VERSION_FILE="${KN_ROOT}/kidsnext/VERSION"
if [ "${KN_MODE}" = "restore" ]; then
	# The backup is chosen and checked before anything is installed: a wrong key or an unreachable NAS stops here,
	# with the SD card still untouched
	[ -x "${KN_RESTORE_HELPER}" ] || kn_die "Die Wiederherstellung ist in dieser Version (${KN_VERSION}) noch nicht enthalten." "Neueste Version mit --ref verwenden."
	kn_info "Backup auswählen"
	"${KN_RESTORE_HELPER}" select --state "${KN_STATE_DIR}/restore-selection" || kn_die "Kein Backup ausgewählt."
	kn_ok "Backup ausgewählt und geprüft"
fi

# ---------------------------------------------------------------------------------------------------------------------
kn_info "MuPiBox installieren (dauert je nach Pi und Internet etwa 20–40 Minuten, die Schritte erscheinen hier)"
kn_log "autosetup.sh from ${KN_ROOT}"
# autosetup shows its own progress bar (whiptail) and writes /tmp/autosetup.log; its exit code says whether
# Node.js, mpv, Chromium and the server are there
if ! KN_SRC="${KN_ROOT}" KN_NO_REBOOT=1 bash "${KN_ROOT}/autosetup/autosetup.sh"; then
	cat /tmp/autosetup.log >> "${KN_LOG}" 2>/dev/null
	kn_die "Die MuPiBox-Grundinstallation ist nicht vollständig (fehlt:$(cat /tmp/autosetup.missing 2>/dev/null))." \
		"Internetverbindung prüfen und den Installer erneut starten – bereits Installiertes bleibt erhalten."
fi
cat /tmp/autosetup.log >> "${KN_LOG}" 2>/dev/null
kn_ok "MuPiBox-Grundinstallation fertig"

# Kids Next modules, in this order; each is idempotent and may be run again on its own (kidsnext/installer/<name>.sh)
KN_MODULES=(base hat backup netbird)
for module in "${KN_MODULES[@]}"; do
	file="${KN_INSTALLER}/${module}.sh"
	[ -f "${file}" ] || kn_die "Installer-Modul ${module} fehlt."
	# shellcheck disable=SC1090
	. "${file}"
	"kn_module_${module}" || kn_die "Schritt '${module}' ist fehlgeschlagen." "Installer erneut starten; das Protokoll zeigt die Ursache."
done

if [ "${KN_MODE}" = "restore" ]; then
	kn_info "Daten aus dem Backup zurückspielen"
	"${KN_RESTORE_HELPER}" apply --state "${KN_STATE_DIR}/restore-selection" || kn_die "Die Wiederherstellung ist fehlgeschlagen." "Das Protokoll prüfen; die Installation selbst ist fertig, die Wiederherstellung kann erneut gestartet werden: sudo ${KN_RESTORE_HELPER} apply"
	kn_run "${KN_APP_DIR}/backup/mupi-kn-backup" timer
	kn_ok "Daten wiederhergestellt"
fi

# ---------------------------------------------------------------------------------------------------------------------
kn_info "Installation prüfen"
SELFTEST_FAILED=0
"${KN_INSTALLER}/selftest.sh" --install || SELFTEST_FAILED=1

jq -n --arg v "${KN_VERSION}" --arg m "${KN_MODE}" --arg d "$(date -Iseconds)" --arg ref "${KN_REF}" --arg c "${KN_COMMIT}" \
	'{version: $v, mode: $m, date: $d, ref: $ref, commit: $c}' > "${KN_STATE_DIR}/installed.json"

echo
if [ "${SELFTEST_FAILED}" = 1 ]; then
	kn_warn "Installation abgeschlossen, aber nicht alle Prüfungen waren erfolgreich (siehe oben)."
else
	kn_ok "MuPiBox Kids Next ${KN_VERSION} ist installiert."
fi
echo "    Protokoll: ${KN_LOG} (Kopie: ${KN_BOOT_DIR}/mupibox-kn-install.log)"

if [ "${KN_NO_REBOOT_ARG}" = 1 ]; then
	echo "    Neustart nötig: sudo reboot"
	exit 0
fi
if kn_confirm "Installation abgeschlossen. Jetzt neu starten?"; then
	kn_copy_log_to_boot
	reboot
fi
