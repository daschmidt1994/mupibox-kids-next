# shellcheck shell=bash
#
# What the box is: Raspberry Pi model, DietPi and Debian version, architecture, boot partition, WiFi adapters.
# kn_detect_system sets the KN_* variables below; kn_check_system says whether Kids Next supports it.
# Every source can be pointed elsewhere (KN_ROOTFS) so the tests run on recorded files of real boxes.

KN_ROOTFS="${KN_ROOTFS:-}"

# Debian releases the installer was checked with. A newer one is not refused: the parents are asked (see kn_check_system).
KN_SUPPORTED_DEBIAN="bookworm trixie"
KN_TESTED_DEBIAN="trixie"

kn_detect_system() {
	local f

	KN_PI_MODEL=$(tr -d '\0' < "${KN_ROOTFS}/sys/firmware/devicetree/base/model" 2>/dev/null)
	KN_PI_MODEL="${KN_PI_MODEL:-unbekannt}"
	# The generation from the model text ("Raspberry Pi 3 Model B Plus Rev 1.3" -> 3, "Zero 2 W" -> 02)
	case "${KN_PI_MODEL}" in
		*"Raspberry Pi 5"*) KN_PI_GEN=5 ;;
		*"Raspberry Pi 4"*|*"Compute Module 4"*) KN_PI_GEN=4 ;;
		*"Raspberry Pi 3"*|*"Compute Module 3"*) KN_PI_GEN=3 ;;
		*"Raspberry Pi Zero 2"*) KN_PI_GEN=02 ;;
		*"Raspberry Pi"*) KN_PI_GEN=old ;;
		*) KN_PI_GEN=none ;;
	esac

	KN_MEM_MB=$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' "${KN_ROOTFS}/proc/meminfo" 2>/dev/null)
	KN_ARCH="${KN_ARCH:-$(uname -m)}"
	KN_KERNEL="${KN_KERNEL:-$(uname -r)}"

	KN_DEBIAN_CODENAME=$(sed -n 's/^VERSION_CODENAME=//p' "${KN_ROOTFS}/etc/os-release" 2>/dev/null | tr -d '"')
	KN_DEBIAN_VERSION=$(sed -n 's/^VERSION_ID=//p' "${KN_ROOTFS}/etc/os-release" 2>/dev/null | tr -d '"')

	# DietPi keeps its version as shell variables (G_DIETPI_VERSION_CORE=9, _SUB=14, _RC=2)
	KN_DIETPI_VERSION=""
	f="${KN_ROOTFS}/boot/dietpi/.version"
	if [ -f "${f}" ]; then
		KN_DIETPI_VERSION=$(
			# shellcheck disable=SC1090
			. "${f}" 2>/dev/null
			echo "${G_DIETPI_VERSION_CORE}.${G_DIETPI_VERSION_SUB}.${G_DIETPI_VERSION_RC}"
		)
	fi

	if [ -f "${KN_ROOTFS}/boot/firmware/config.txt" ]; then
		KN_BOOT_DIR="${KN_ROOTFS}/boot/firmware"
	else
		KN_BOOT_DIR="${KN_ROOTFS}/boot"
	fi
	# shellcheck disable=SC2034 # (used by the modules)
	KN_BOOT_CONFIG="${KN_BOOT_DIR}/config.txt"
	KN_DIETPI_TXT="${KN_BOOT_DIR}/dietpi.txt"
	[ -f "${KN_DIETPI_TXT}" ] || KN_DIETPI_TXT="${KN_ROOTFS}/boot/dietpi.txt"

	kn_detect_wifi
}

# WiFi adapters, by what they are and not by their name: wlan0 is not always the onboard one.
# KN_WIFI_IFACES lines: "<iface> <onboard|usb> <driver> <usb-id or ->"
kn_detect_wifi() {
	local net iface dev path bus driver id
	KN_WIFI_IFACES=""
	for net in "${KN_ROOTFS}"/sys/class/net/*; do
		[ -d "${net}/wireless" ] || [ -d "${net}/phy80211" ] || continue
		iface=$(basename "${net}")
		dev=$(readlink -f "${net}/device" 2>/dev/null)
		path="${dev}"
		bus=onboard
		case "${path}" in *usb*) bus=usb ;; esac
		driver=$(basename "$(readlink -f "${net}/device/driver" 2>/dev/null)")
		id="-"
		if [ "${bus}" = "usb" ]; then
			# the USB device is the parent of the interface's device (…/1-1.3/1-1.3:1.0)
			if [ -r "${dev}/../idVendor" ]; then
				id="$(cat "${dev}/../idVendor"):$(cat "${dev}/../idProduct")"
			fi
		fi
		KN_WIFI_IFACES+="${iface} ${bus} ${driver:--} ${id}"$'\n'
	done
	KN_WIFI_IFACES="${KN_WIFI_IFACES%$'\n'}"
}

# Returns 0 when the installation may go on; prints why not otherwise. A Debian newer than the tested ones is allowed
# after a question (KN_ALLOW_UNTESTED=1 answers it), so Kids Next is not tied to one release.
kn_check_system() {
	local ok=0
	if [ "${KN_PI_GEN}" = "none" ]; then
		kn_error "Das ist kein Raspberry Pi (${KN_PI_MODEL})."
		ok=1
	elif [ "${KN_PI_GEN}" = "old" ]; then
		kn_warn "${KN_PI_MODEL}: zu alt für die Touch-Oberfläche (Pi 3, 4, 5 oder Zero 2 W empfohlen)."
	fi
	case "${KN_ARCH}" in
		aarch64|armv7l) ;;
		*) kn_error "Architektur ${KN_ARCH} wird nicht unterstützt (aarch64 oder armv7l)."; ok=1 ;;
	esac
	if [ -z "${KN_DIETPI_VERSION}" ]; then
		kn_error "Kein DietPi gefunden (/boot/dietpi/.version fehlt). Bitte das offizielle DietPi-Image verwenden."
		ok=1
	fi
	if [[ " ${KN_SUPPORTED_DEBIAN} " != *" ${KN_DEBIAN_CODENAME} "* ]]; then
		case "${KN_DEBIAN_CODENAME}" in
			buster|bullseye)
				kn_error "Debian ${KN_DEBIAN_CODENAME} ist zu alt. Bitte ein aktuelles DietPi-Image installieren."
				ok=1
				;;
			*)
				kn_warn "Debian ${KN_DEBIAN_CODENAME:-?} ist neuer als die geprüften Versionen (${KN_SUPPORTED_DEBIAN})."
				if [ "${KN_ALLOW_UNTESTED}" != "1" ] && ! kn_confirm "Debian ${KN_DEBIAN_CODENAME} wurde mit Kids Next noch nicht getestet. Trotzdem installieren?"; then
					ok=1
				fi
				;;
		esac
	elif [[ " ${KN_TESTED_DEBIAN} " != *" ${KN_DEBIAN_CODENAME} "* ]]; then
		kn_warn "Debian ${KN_DEBIAN_CODENAME} wird unterstützt, getestet ist aber vor allem ${KN_TESTED_DEBIAN}."
	fi
	if [ -n "${KN_MEM_MB}" ] && [ "${KN_MEM_MB}" -lt 900 ] 2>/dev/null; then
		kn_warn "Nur ${KN_MEM_MB} MB Arbeitsspeicher: die Oberfläche startet langsamer."
	fi
	return ${ok}
}

kn_print_system() {
	echo "  Raspberry Pi:  ${KN_PI_MODEL} (${KN_MEM_MB:-?} MB RAM)"
	echo "  DietPi:        ${KN_DIETPI_VERSION:-?}"
	echo "  Debian:        ${KN_DEBIAN_VERSION:-?} (${KN_DEBIAN_CODENAME:-?}), ${KN_ARCH}, Kernel ${KN_KERNEL}"
	echo "  Boot-Ordner:   ${KN_BOOT_DIR}"
	if [ -n "${KN_WIFI_IFACES}" ]; then
		local line
		while read -r line; do
			# shellcheck disable=SC2086
			set -- ${line}
			echo "  WLAN:          $1 ($([ "$2" = usb ] && echo "USB" || echo "intern"), Treiber $3$([ "$4" != "-" ] && echo ", USB-ID $4"))"
		done <<< "${KN_WIFI_IFACES}"
	else
		echo "  WLAN:          kein Adapter gefunden"
	fi
}
