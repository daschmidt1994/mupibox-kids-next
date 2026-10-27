# shellcheck shell=bash
#
# NAS backup: restic, the service the timer starts, the commands. The NAS itself is set up by the parents (app or
# "sudo mupi-kn-backup setup"); the NFS/SMB programs come with that setup, for the kind of NAS chosen.

kn_module_backup() {
	kn_info "NAS-Backup einrichten"
	kn_pkgs restic jq || return 1

	kn_install_content /etc/systemd/system/mupi-kn-backup.service 644 < "${KN_APP_DIR}/systemd/mupi-kn-backup.service" && kn_run systemctl daemon-reload
	ln -sfn "${KN_APP_DIR}/backup/mupi-kn-backup" /usr/local/sbin/mupi-kn-backup
	ln -sfn "${KN_APP_DIR}/backup/mupi-kn-restore" /usr/local/sbin/mupi-kn-restore
	# what the parents type after a new SD card: the whole restore (choose, check, restore, restart)
	ln -sfn "${KN_APP_DIR}/restore.sh" /usr/local/sbin/mupibox-restore
	install -d -m 755 /var/cache/mupibox-kn

	if [ -f "${KN_ETC_DIR}/backup.conf" ]; then
		# (set up before: the timer written again for this version, as the settings say)
		kn_run "${KN_APP_DIR}/backup/mupi-kn-backup" timer
		kn_ok "NAS-Backup bereits eingerichtet"
	else
		kn_ok "NAS-Backup installiert – einrichten in der Eltern-App oder mit: sudo mupi-kn-backup setup"
	fi
}
