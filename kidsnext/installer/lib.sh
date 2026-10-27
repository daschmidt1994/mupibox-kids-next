# shellcheck shell=bash
#
# Shared helpers of the Kids Next installer: logging, German messages for the parents, and idempotent file changes.
# Sourced by install.sh and the modules; it changes nothing by itself.

KN_LOG_DIR="${KN_LOG_DIR:-/var/log/mupibox-kn}"
KN_STATE_DIR="${KN_STATE_DIR:-/var/lib/mupibox-kn}"
KN_ETC_DIR="${KN_ETC_DIR:-/etc/mupibox-kn}"
KN_LOG="${KN_LOG:-/dev/null}"

if [ -t 1 ]; then
	KN_C_OK=$'\e[32m' KN_C_WARN=$'\e[33m' KN_C_ERR=$'\e[31m' KN_C_BOLD=$'\e[1m' KN_C_OFF=$'\e[0m'
else
	KN_C_OK='' KN_C_WARN='' KN_C_ERR='' KN_C_BOLD='' KN_C_OFF=''
fi

kn_ts() { date '+%F %T'; }

# Everything goes to the log; the screen gets only the lines meant for the parents
kn_log() { echo "$(kn_ts) $*" >> "${KN_LOG}"; }
kn_info() { echo "${KN_C_BOLD}==>${KN_C_OFF} $*"; kn_log "INFO  $*"; }
kn_ok() { echo "${KN_C_OK}  ✔${KN_C_OFF} $*"; kn_log "OK    $*"; }
kn_warn() { echo "${KN_C_WARN}  ! $*${KN_C_OFF}" >&2; kn_log "WARN  $*"; }
kn_error() { echo "${KN_C_ERR}  ✘ $*${KN_C_OFF}" >&2; kn_log "ERROR $*"; }

# Stops the installation with a message the parents can act on, and where the details are
kn_die() {
	kn_error "$1"
	[ -n "$2" ] && echo "    Was tun: $2" >&2
	[ "${KN_LOG}" != "/dev/null" ] && echo "    Protokoll: ${KN_LOG}" >&2
	exit 1
}

# Runs a command with its output in the log only; returns its exit code
kn_run() {
	kn_log "RUN   $*"
	"$@" >> "${KN_LOG}" 2>&1
}

kn_have() { command -v "$1" >/dev/null 2>&1; }

# A line in a file once (exactly that line); the file is created when missing
kn_ensure_line() {
	local line="$1" file="$2"
	[ -e "${file}" ] || : > "${file}"
	grep -qxF -- "${line}" "${file}" || printf '%s\n' "${line}" >> "${file}"
}

# Writes stdin to a file only when the content differs, atomically and with the given mode/owner.
# Returns 0 when the file changed, 1 when it was already like that (so callers restart a service only when needed).
kn_install_content() {
	local file="$1" mode="${2:-644}" owner="${3:-root:root}" tmp
	tmp=$(mktemp "${file}.kn.XXXXXX") || return 2
	cat > "${tmp}"
	if [ -f "${file}" ] && cmp -s "${tmp}" "${file}"; then
		rm -f "${tmp}"
		return 1
	fi
	chmod "${mode}" "${tmp}" && chown "${owner}" "${tmp}" && mv -f "${tmp}" "${file}"
}

# apt with patience for DietPi's own updates and without questions (as upstream's autosetup does it)
kn_apt() {
	DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 \
		-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

kn_pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }

# Installs the packages that are missing; returns non-zero when one could not be installed
kn_pkgs() {
	local missing=() p
	for p in "$@"; do kn_pkg_installed "${p}" || missing+=("${p}"); done
	[ ${#missing[@]} -eq 0 ] && return 0
	kn_run kn_apt install -y --no-install-recommends "${missing[@]}"
}

# Asks yes/no; KN_YES=1 answers yes without asking (unattended runs)
kn_confirm() {
	local question="$1" answer
	[ "${KN_YES}" = "1" ] && return 0
	if kn_have whiptail && [ -t 0 ]; then
		whiptail --title "MuPiBox Kids Next" --yesno "${question}" 12 70
		return
	fi
	read -r -p "${question} [j/N] " answer
	[[ "${answer}" =~ ^[jJyY] ]]
}
