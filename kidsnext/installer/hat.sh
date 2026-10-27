# shellcheck shell=bash
#
# MuPiHAT: recognised by its charger chip on the I2C bus and switched on once, as the switch in the app does (driver,
# sound card MAX98357A instead of the setup's hifiberry-dac, services). Decided once per box: what the parents set
# in the app afterwards stays (hardware/mupi-kn-hat).

kn_module_hat() {
	kn_info "MuPiHAT erkennen"
	kn_pkgs i2c-tools jq || return 1
	ln -sfn "${KN_APP_DIR}/hardware/mupi-kn-hat" /usr/local/sbin/mupi-kn-hat
	kn_install_content /etc/systemd/system/mupi-kn-hat-detect.service 644 < "${KN_APP_DIR}/systemd/mupi-kn-hat-detect.service" && kn_run systemctl daemon-reload
	local out
	if out=$("${KN_APP_DIR}/hardware/mupi-kn-hat" auto 2>&1); then
		kn_log "${out}"
		kn_ok "${out}"
	else
		kn_log "${out}"
		# (no reason to stop the installation: the switch in the app does the same)
		kn_warn "${out}"
	fi
	return 0
}
