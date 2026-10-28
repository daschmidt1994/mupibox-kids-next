# shellcheck shell=bash
#
# Kids Next base: its folders, the copy of its tools that stays on the box, and what all later modules rely on.
# Folders (program and user data apart):
#   /opt/mupibox-kn/app        Kids Next's own programs (replaced by every installation/update)
#   /etc/mupibox-kn            settings that are not secret
#   /etc/mupibox-kn/secrets    keys and passwords (root only, 0700/0600)
#   /var/lib/mupibox-kn        state (backup history, audio settings ...), part of the backup
#   /var/log/mupibox-kn        installer logs (RAM on DietPi, copied to the boot partition)

KN_APP_DIR="${KN_APP_DIR:-/opt/mupibox-kn/app}"

kn_module_base() {
	kn_info "Kids-Next-Grundlagen einrichten"

	install -d -m 755 -o root -g root /opt/mupibox-kn "${KN_ETC_DIR}" "${KN_STATE_DIR}" "${KN_LOG_DIR}"
	install -d -m 700 -o root -g root "${KN_ETC_DIR}/secrets"

	kn_pkgs jq curl ca-certificates whiptail || return 1

	# The tools of this version, without the sources of upstream's parts (those went in with autosetup.sh)
	local tmp="${KN_APP_DIR}.new"
	rm -rf "${tmp}"
	mkdir -p "${tmp}"
	tar -C "${KN_ROOT}/kidsnext" --exclude=docs --exclude=tests -cf - . | tar -C "${tmp}" -xf - || return 1
	# (the whole version, with its running number: the backup and the restore take it from here)
	[ -n "${KN_VERSION}" ] && printf '%s\n' "${KN_VERSION}" > "${tmp}/VERSION"
	# what the app and the scripts took from the original's GitHub before (templates, the Wi-Fi driver scripts): from
	# this version on the box - nothing is loaded from upstream any more
	mkdir -p "${tmp}/upstream"
	cp -a "${KN_ROOT}/config/templates" "${tmp}/upstream/templates" || return 1
	cp -a "${KN_ROOT}/scripts/online" "${tmp}/upstream/online" || return 1
	rm -rf "${KN_APP_DIR}.old"
	[ -d "${KN_APP_DIR}" ] && mv "${KN_APP_DIR}" "${KN_APP_DIR}.old"
	mv "${tmp}" "${KN_APP_DIR}" || return 1
	rm -rf "${KN_APP_DIR}.old"
	chown -R root:root "${KN_APP_DIR}"
	chmod -R go-w "${KN_APP_DIR}"
	ln -sfn "${KN_APP_DIR}/installer/selftest.sh" /usr/local/sbin/mupibox-kn-selftest

	# The upstream web server had full root rights through sudo (only the PHP admin interface used them, which stays off)
	rm -f /etc/sudoers.d/www-data
	if [ -x /usr/local/bin/mupibox/legacy_admin.sh ] && [ "$(/usr/local/bin/mupibox/legacy_admin.sh status 2>/dev/null)" != "off" ]; then
		kn_run /usr/local/bin/mupibox/legacy_admin.sh off
	fi

	kn_ok "Grundlagen eingerichtet (${KN_APP_DIR})"
}
