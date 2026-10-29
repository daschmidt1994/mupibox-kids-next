# shellcheck shell=bash
# shellcheck disable=SC2034 # (the settings are used by name: ${!key})
#
# Shared parts of mupi-kn-backup and mupi-kn-restore: settings, NAS mount, restic, what a backup holds.
#
# The backup is a restic repository per box on the NAS (<share>/<NAS_DIR>/<BOX_NAME>): encrypted, deduplicated,
# checkable. Its password is the "Wiederherstellungsschlüssel" the parents write down - a restore on a new SD card needs
# only the NAS and that key, nothing from the old card.
#
# KN_FS: a prefix for every path of the box (the tests run on a fake box in a folder); empty on a real box.
# KN_TEST=1: no services, owners, hostname (the tests run without root's system around them).

KN_FS="${KN_FS:-}"
KN_ETC_DIR="${KN_ETC_DIR:-${KN_FS}/etc/mupibox-kn}"
KN_STATE_DIR="${KN_STATE_DIR:-${KN_FS}/var/lib/mupibox-kn}"
KB_CONF="${KN_ETC_DIR}/backup.conf"
KB_SECRETS="${KN_ETC_DIR}/secrets"
KB_KEY_FILE="${KB_SECRETS}/backup.key"
KB_CRED_FILE="${KB_SECRETS}/nas.cred"
KB_HISTORY="${KN_STATE_DIR}/backup-history.json"
KB_MOUNT_DIR="${KB_MOUNT_DIR:-/run/mupibox-kn/nas}"
KB_CACHE_DIR="${KB_CACHE_DIR:-${KN_FS}/var/cache/mupibox-kn/restic}"
KB_RESTIC="${KB_RESTIC:-restic}"
KB_VERSION_FILE="${KB_VERSION_FILE:-/opt/mupibox-kn/app/VERSION}"
KB_MOUNTED_BY_US=0

# ---------------------------------------------------------------------------------------------------------------------
# Settings: /etc/mupibox-kn/backup.conf, KEY=value lines. Read by parsing, never sourced (the app writes it), and every
# value is checked against what it may be.

KB_KEYS="ENABLED NAS_TYPE NAS_HOST NAS_SHARE NAS_DIR BOX_NAME INCLUDE_MEDIA SCHEDULE_TIME SCHEDULE_DAYS KEEP_DAILY KEEP_WEEKLY KEEP_MONTHLY"

kb_defaults() {
	ENABLED=0
	NAS_TYPE=""
	NAS_HOST=""
	NAS_SHARE=""
	NAS_DIR="mupibox-backups"
	BOX_NAME="$(hostname 2>/dev/null | tr -cd 'A-Za-z0-9-')"
	INCLUDE_MEDIA=0
	SCHEDULE_TIME="03:30"
	SCHEDULE_DAYS="daily"
	KEEP_DAILY=7
	KEEP_WEEKLY=4
	KEEP_MONTHLY=6
}

# kb_valid <KEY> <value>: 0 when the value is allowed for the key
kb_valid() {
	local v="$2"
	case "$1" in
		ENABLED|INCLUDE_MEDIA) [[ "${v}" =~ ^[01]$ ]] ;;
		NAS_TYPE) [[ "${v}" =~ ^(nfs|smb|local)$ ]] ;;
		NAS_HOST) [ -z "${v}" ] || [[ "${v}" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})$ ]] ;;
		# nfs: the export path; smb: the share name; local: a folder (tests, USB disk)
		NAS_SHARE) [[ "${v}" =~ ^/?[A-Za-z0-9._\ \$-]+(/[A-Za-z0-9._\ -]+)*/?$ ]] ;;
		NAS_DIR) [[ "${v}" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] && [[ "${v}" != *..* ]] ;;
		BOX_NAME) [[ "${v}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] ;;
		SCHEDULE_TIME) [[ "${v}" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] ;;
		SCHEDULE_DAYS) [[ "${v}" =~ ^(daily|(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(,(Mon|Tue|Wed|Thu|Fri|Sat|Sun))*)$ ]] ;;
		KEEP_DAILY|KEEP_WEEKLY|KEEP_MONTHLY) [[ "${v}" =~ ^[0-9]{1,3}$ ]] ;;
		*) return 1 ;;
	esac
}

kb_load_conf() {
	kb_defaults
	[ -f "${KB_CONF}" ] || return 1
	local key value
	while IFS='=' read -r key value; do
		[[ "${key}" =~ ^[A-Z_]+$ ]] || continue
		[[ " ${KB_KEYS} " == *" ${key} "* ]] || continue
		if kb_valid "${key}" "${value}"; then
			printf -v "${key}" '%s' "${value}"
		else
			echo "backup.conf: ungültiger Wert für ${key} ignoriert" >&2
		fi
	done < "${KB_CONF}"
	return 0
}

kb_save_conf() {
	local key tmp
	install -d -m 755 "${KN_ETC_DIR}"
	tmp=$(mktemp "${KB_CONF}.XXXXXX") || return 1
	{
		echo "# MuPiBox Kids Next – NAS-Backup (wird von der Eltern-App und mupi-kn-backup geschrieben)"
		for key in ${KB_KEYS}; do
			kb_valid "${key}" "${!key}" || { echo "Ungültiger Wert für ${key}: '${!key}'" >&2; rm -f "${tmp}"; return 1; }
			echo "${key}=${!key}"
		done
	} > "${tmp}"
	chmod 644 "${tmp}"
	mv -f "${tmp}" "${KB_CONF}"
}

# The SMB login, in mount.cifs' credentials file (root only). The password comes in on stdin and never as an argument.
kb_save_smb_credentials() {
	local user="$1" password
	[[ "${user}" =~ ^[A-Za-z0-9._@\\-]{1,64}$ ]] || { echo "Ungültiger NAS-Benutzername." >&2; return 1; }
	IFS= read -r password
	install -d -m 700 "${KB_SECRETS}"
	( umask 077; printf 'username=%s\npassword=%s\n' "${user}" "${password}" > "${KB_CRED_FILE}.new" ) && mv -f "${KB_CRED_FILE}.new" "${KB_CRED_FILE}"
}

# ---------------------------------------------------------------------------------------------------------------------
# The recovery key: 30 characters without ones that are easy to mix up (0/O, 1/I/L), in groups of five

kb_generate_key() {
	local raw
	raw=$(LC_ALL=C tr -dc 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' < /dev/urandom | head -c 30)
	kb_format_key "${raw}"
}

kb_format_key() {
	local raw="$1"
	echo "${raw:0:5}-${raw:5:5}-${raw:10:5}-${raw:15:5}-${raw:20:5}-${raw:25:5}"
}

# What the parents type: small letters, spaces, missing dashes are fine. A key of another shape (one added later with
# "restic key add") is taken as typed.
kb_normalize_key() {
	local typed="$1" clean
	clean=$(printf '%s' "${typed}" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9')
	if [ ${#clean} -eq 30 ]; then
		kb_format_key "${clean}"
	else
		printf '%s' "${typed}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
	fi
}

kb_save_key() {
	install -d -m 700 "${KB_SECRETS}"
	( umask 077; printf '%s\n' "$1" > "${KB_KEY_FILE}.new" ) && mv -f "${KB_KEY_FILE}.new" "${KB_KEY_FILE}"
}

# ---------------------------------------------------------------------------------------------------------------------
# NAS: mounted only while a backup or restore runs, with timeouts - an NAS that is off fails the backup, never the box

kb_packages_for_type() {
	case "$1" in
		nfs) echo "restic nfs-common" ;;
		smb) echo "restic cifs-utils" ;;
		*) echo "restic" ;;
	esac
}

# nfs-common brings rpcbind, which listens on port 111 in the whole network. The box mounts with NFSv4 or with
# "nolock", neither needs it.
kb_quiet_rpcbind() {
	[ "${KN_TEST}" = 1 ] && return 0
	systemctl list-unit-files rpcbind.service >/dev/null 2>&1 || return 0
	systemctl disable --now rpcbind.socket rpcbind.service >/dev/null 2>&1
	systemctl mask rpcbind.socket rpcbind.service >/dev/null 2>&1
	return 0
}

kb_mount() {
	KB_ERROR=""
	case "${NAS_TYPE}" in
		local)
			[ -d "${NAS_SHARE}" ] || { KB_ERROR="Ordner ${NAS_SHARE} nicht gefunden"; return 1; }
			KB_NAS_ROOT="${NAS_SHARE%/}"
			return 0
			;;
		nfs|smb) ;;
		*) KB_ERROR="Kein NAS eingerichtet"; return 1 ;;
	esac
	mkdir -p "${KB_MOUNT_DIR}"
	chmod 700 "$(dirname "${KB_MOUNT_DIR}")"
	KB_NAS_ROOT="${KB_MOUNT_DIR}"
	if mountpoint -q "${KB_MOUNT_DIR}"; then
		return 0
	fi
	if ! timeout 5 ping -c 1 -W 3 "${NAS_HOST}" >/dev/null 2>&1; then
		# (only a hint: some NAS do not answer pings - the mount below decides)
		echo "Hinweis: ${NAS_HOST} antwortet nicht auf ping" >&2
	fi
	local out
	if [ "${NAS_TYPE}" = "nfs" ]; then
		out=$(timeout 60 mount -t nfs -o soft,timeo=150,retrans=3,noatime,nolock "${NAS_HOST}:${NAS_SHARE}" "${KB_MOUNT_DIR}" 2>&1)
	else
		[ -f "${KB_CRED_FILE}" ] || { KB_ERROR="SMB-Zugangsdaten fehlen"; return 1; }
		out=$(timeout 60 mount -t cifs "//${NAS_HOST}/${NAS_SHARE#/}" "${KB_MOUNT_DIR}" \
			-o "credentials=${KB_CRED_FILE},uid=0,gid=0,file_mode=0600,dir_mode=0700,noperm,echo_interval=10" 2>&1)
	fi
	# shellcheck disable=SC2181
	if [ $? -ne 0 ]; then
		case "${out}" in
			*"Permission denied"*|*"access denied"*) KB_ERROR="NAS verweigert den Zugriff (Benutzer/Passwort bzw. NFS-Freigabe für diese IP prüfen)" ;;
			*"No such file"*|*"not found"*|*"bad share"*) KB_ERROR="Freigabe ${NAS_SHARE} auf ${NAS_HOST} nicht gefunden" ;;
			"") KB_ERROR="NAS ${NAS_HOST} nicht erreichbar (Zeitüberschreitung)" ;;
			*) KB_ERROR="NAS konnte nicht eingebunden werden: $(echo "${out}" | tail -n 1)" ;;
		esac
		return 1
	fi
	KB_MOUNTED_BY_US=1
}

kb_umount() {
	[ "${KB_MOUNTED_BY_US}" = 1 ] || return 0
	umount "${KB_MOUNT_DIR}" 2>/dev/null || umount -l "${KB_MOUNT_DIR}" 2>/dev/null
	KB_MOUNTED_BY_US=0
}

kb_repo() { echo "${KB_NAS_ROOT}/${NAS_DIR}/${BOX_NAME}"; }

# restic with the box's repository and key; the key goes in by file, never on the command line or into a log
kb_restic() {
	mkdir -p "${KB_CACHE_DIR}"
	RESTIC_REPOSITORY="$(kb_repo)" RESTIC_PASSWORD_FILE="${KB_KEY_FILE}" RESTIC_CACHE_DIR="${KB_CACHE_DIR}" \
		RESTIC_PROGRESS_FPS=0.2 "${KB_RESTIC}" "$@"
}

kb_repo_exists() { [ -f "$(kb_repo)/config" ]; }

# ---------------------------------------------------------------------------------------------------------------------
# What a backup holds. Absolute paths of the box (with KN_FS in the tests); what is not there is left out.

SKC_REL=/home/dietpi/.mupibox/Sonos-Kids-Controller-master

kb_config_paths() {
	local p
	for p in \
		/etc/mupibox \
		/etc/mupibox-kn \
		/var/lib/mupibox-kn \
		"${SKC_REL}/server/config" \
		"${SKC_REL}/www/cover" \
		"${SKC_REL}/www/rss-covers" \
		"${SKC_REL}/www/active_theme.css" \
		"${SKC_REL}/www/theme-data/custom" \
		/home/dietpi/.mupibox/play_log.jsonl \
		/home/dietpi/MuPiBox/themes \
		/home/dietpi/MuPiBox/sysmedia/images/bootscreen-custom \
		/home/dietpi/MuPiBox/tts_files \
		/home/dietpi/MuPiBox/media/cover \
		/etc/wpa_supplicant/wpa_supplicant.conf \
		/var/lib/dietpi/dietpi-wifi.db \
		/etc/network/interfaces.d/mupibox-wifi \
		/etc/NetworkManager/system-connections \
		/var/lib/bluetooth \
		/var/lib/netbird \
		/etc/netbird; do
		[ -e "${KN_FS}${p}" ] || [ -L "${KN_FS}${p}" ] && echo "${KN_FS}${p}"
	done
}

kb_media_paths() {
	local p
	for p in /home/dietpi/MuPiBox/media /home/dietpi/MuPiBox/podcasts; do
		[ -e "${KN_FS}${p}" ] && echo "${KN_FS}${p}"
	done
}

# Never in a backup: the backup's own key (it would be in the backup it opens), the restic cache, restore leftovers
kb_excludes() {
	echo "${KB_KEY_FILE}"
	echo "${KN_STATE_DIR}/restore-*"
	echo "${KN_FS}/home/dietpi/MuPiBox/media/cover/.thumbs"
}

# (the installer's KN_VERSION: the version about to be installed, with its running number - see install.sh)
kb_kn_version() {
	if [ -n "${KN_VERSION}" ]; then echo "${KN_VERSION}"; elif [ -f "${KB_VERSION_FILE}" ]; then tr -d '[:space:]' < "${KB_VERSION_FILE}"; else echo "0.0.0"; fi
}

# The device the box runs on: the Pi's serial number (a new SD card in the same Pi keeps it), else the board's id; empty
# when there is none. Saved with every backup (device-id) - a restore onto another device is told apart by it.
kb_device_id() {
	local id=""
	if [ -n "${KB_DEVICE_ID+x}" ]; then
		id="${KB_DEVICE_ID}"
	elif [ -r /sys/firmware/devicetree/base/serial-number ]; then
		id=$(tr -d '\0' < /sys/firmware/devicetree/base/serial-number)
	elif [ -r /sys/class/dmi/id/product_uuid ]; then
		id=$(cat /sys/class/dmi/id/product_uuid)
	fi
	id=$(printf '%s' "${id}" | tr -cd 'A-Za-z0-9-' | tr 'A-Z' 'a-z')
	# (a serial of zeros only: no real one)
	[[ "${id}" =~ [1-9a-z] ]] && echo "${id}"
}

# ---------------------------------------------------------------------------------------------------------------------
# History: the last 60 runs as JSON for the dashboard (one write per run)

kb_history_add() {
	local entry="$1" tmp
	mkdir -p "${KN_STATE_DIR}"
	[ -s "${KB_HISTORY}" ] && jq -e 'type == "array"' "${KB_HISTORY}" >/dev/null 2>&1 || echo '[]' > "${KB_HISTORY}"
	tmp=$(mktemp "${KB_HISTORY}.XXXXXX") || return 1
	if jq --argjson e "${entry}" '. + [$e] | .[-60:]' "${KB_HISTORY}" > "${tmp}"; then
		mv -f "${tmp}" "${KB_HISTORY}"
	else
		rm -f "${tmp}"
		return 1
	fi
}

# Runs a system command unless in the tests
kb_sys() {
	[ "${KN_TEST}" = 1 ] && return 0
	"$@"
}

kb_human() {
	numfmt --to=iec-i --suffix=B "${1:-0}" 2>/dev/null || echo "${1:-0} B"
}
