# shellcheck shell=bash
#
# NetBird: the program from netbird.io's apt repository (updated with the operating system), its service, the command
# mupi-kn-netbird. The box is connected by the parents (app: Einstellungen › Netzwerk › NetBird, or
# "sudo mupi-kn-netbird up --url … --key-stdin"), or at the installation when the boot partition has
# mupibox-kn-netbird.txt (KN_NETBIRD_URL=…, KN_NETBIRD_SETUP_KEY=…; the file is deleted after it was read).

kn_module_netbird() {
	kn_info "NetBird (Fernzugriff) einrichten"
	ln -sfn "${KN_APP_DIR}/netbird/mupi-kn-netbird" /usr/local/sbin/mupi-kn-netbird
	if ! kn_run "${KN_APP_DIR}/netbird/mupi-kn-netbird" install; then
		# (no NetBird is no reason to stop the installation: the app offers it again)
		kn_warn "NetBird ließ sich nicht installieren – später in der Eltern-App erneut versuchen."
		return 0
	fi

	local file="${KN_BOOT_DIR}/mupibox-kn-netbird.txt" url key
	if [ -n "${KN_BOOT_DIR}" ] && [ -f "${file}" ]; then
		url=$(sed -n 's/^KN_NETBIRD_URL=//p' "${file}" | tr -d '\r' | head -n 1)
		key=$(sed -n 's/^KN_NETBIRD_SETUP_KEY=//p' "${file}" | tr -d '\r' | head -n 1)
		# (the key leaves the SD card's FAT partition, readable on any PC, whatever happens next)
		shred -u "${file}" 2>/dev/null || rm -f "${file}"
		if [ -n "${url}" ] && [ -n "${key}" ]; then
			if printf '%s\n' "${key}" | "${KN_APP_DIR}/netbird/mupi-kn-netbird" up --url "${url}" --hostname "$(hostname)" --key-stdin >> "${KN_LOG}" 2>&1; then
				kn_ok "NetBird verbunden ($(${KN_APP_DIR}/netbird/mupi-kn-netbird status --json | jq -r .ip))"
				return 0
			fi
			kn_warn "NetBird ließ sich mit mupibox-kn-netbird.txt nicht verbinden – in der Eltern-App erneut versuchen."
			return 0
		fi
	fi
	kn_ok "NetBird installiert – verbinden in der Eltern-App (Einstellungen › Netzwerk › NetBird)"
}
