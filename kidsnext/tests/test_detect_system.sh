# shellcheck shell=bash
# Recorded files of a Pi 3B+ on DietPi/Trixie with the onboard WiFi and a TP-Link Archer T3U Plus (RTL8822BU, 2357:0138)

make_pi3_rootfs() {
	local r="$1"
	mkdir -p "${r}/sys/firmware/devicetree/base" "${r}/proc" "${r}/etc" "${r}/boot/dietpi" "${r}/boot/firmware" \
		"${r}/sys/devices/platform/soc/3f300000.mmcnr/mmc_host/mmc1/mmc1:0001/mmc1:0001:1/net/wlan0/wireless" \
		"${r}/sys/devices/platform/soc/3f980000.usb/usb1/1-1/1-1.3/1-1.3:1.0/net/wlan1/phy80211" \
		"${r}/sys/bus/sdio/drivers/brcmfmac" "${r}/sys/bus/usb/drivers/rtw88_8822bu" "${r}/sys/class/net"
	printf 'Raspberry Pi 3 Model B Plus Rev 1.3\0' > "${r}/sys/firmware/devicetree/base/model"
	printf 'MemTotal:         929048 kB\n' > "${r}/proc/meminfo"
	printf 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n' > "${r}/etc/os-release"
	printf 'G_DIETPI_VERSION_CORE=10\nG_DIETPI_VERSION_SUB=2\nG_DIETPI_VERSION_RC=1\n' > "${r}/boot/dietpi/.version"
	: > "${r}/boot/firmware/config.txt"
	: > "${r}/boot/firmware/dietpi.txt"
	local sdio="${r}/sys/devices/platform/soc/3f300000.mmcnr/mmc_host/mmc1/mmc1:0001/mmc1:0001:1"
	local usbif="${r}/sys/devices/platform/soc/3f980000.usb/usb1/1-1/1-1.3/1-1.3:1.0"
	ln -s "${sdio}/net/wlan0" "${r}/sys/class/net/wlan0"
	ln -s "${sdio}" "${sdio}/net/wlan0/device"
	ln -s "${r}/sys/bus/sdio/drivers/brcmfmac" "${sdio}/driver"
	ln -s "${usbif}/net/wlan1" "${r}/sys/class/net/wlan1"
	ln -s "${usbif}" "${usbif}/net/wlan1/device"
	ln -s "${r}/sys/bus/usb/drivers/rtw88_8822bu" "${usbif}/driver"
	echo 2357 > "${usbif}/../idVendor"
	echo 0138 > "${usbif}/../idProduct"
}

(
	R="${TMP}/pi3"
	make_pi3_rootfs "${R}"
	KN_ROOTFS="${R}" KN_ARCH=aarch64 KN_KERNEL=6.12.47+rpt-rpi-v8
	export KN_ROOTFS KN_ARCH KN_KERNEL
	KN_LOG=/dev/null
	# shellcheck source=../installer/lib.sh
	. "${KN}/installer/lib.sh"
	# shellcheck source=../installer/detect-system.sh
	. "${KN}/installer/detect-system.sh"
	kn_detect_system
	eq "Modell erkannt" "${KN_PI_MODEL}" "Raspberry Pi 3 Model B Plus Rev 1.3"
	eq "Generation 3" "${KN_PI_GEN}" "3"
	eq "RAM in MB" "${KN_MEM_MB}" "907"
	eq "Debian-Codename" "${KN_DEBIAN_CODENAME}" "trixie"
	eq "DietPi-Version" "${KN_DIETPI_VERSION}" "10.2.1"
	eq "Boot-Ordner /boot/firmware" "${KN_BOOT_DIR}" "${R}/boot/firmware"
	eq "WLAN intern (wlan0, brcmfmac)" "$(grep '^wlan0 ' <<< "${KN_WIFI_IFACES}")" "wlan0 onboard brcmfmac -"
	eq "WLAN USB (wlan1, rtw88_8822bu, 2357:0138)" "$(grep '^wlan1 ' <<< "${KN_WIFI_IFACES}")" "wlan1 usb rtw88_8822bu 2357:0138"
	if kn_check_system >/dev/null 2>&1; then ok "Pi 3B+ / Trixie wird unterstützt"; else nok "Pi 3B+ / Trixie wird unterstützt"; fi

	sed -i 's/trixie/bullseye/' "${R}/etc/os-release"
	kn_detect_system
	if kn_check_system >/dev/null 2>&1; then nok "Bullseye wird abgelehnt"; else ok "Bullseye wird abgelehnt"; fi

	sed -i 's/bullseye/forky/' "${R}/etc/os-release"
	kn_detect_system
	if KN_ALLOW_UNTESTED=1 kn_check_system >/dev/null 2>&1; then ok "Neueres Debian (forky) nach Bestätigung erlaubt"; else nok "Neueres Debian (forky) nach Bestätigung erlaubt"; fi
	if KN_YES=0 kn_check_system >/dev/null 2>&1 < /dev/null; then nok "Neueres Debian ohne Bestätigung abgelehnt"; else ok "Neueres Debian ohne Bestätigung abgelehnt"; fi

	rm "${R}/boot/dietpi/.version"
	sed -i 's/forky/trixie/' "${R}/etc/os-release"
	kn_detect_system
	if kn_check_system >/dev/null 2>&1; then nok "Ohne DietPi abgelehnt"; else ok "Ohne DietPi abgelehnt"; fi
	echo "PASS=${PASS} FAIL=${FAIL}" > "${TMP}/counts"
)
# (the subshell keeps the test's variables away from the others; its counts come back through the file)
# shellcheck disable=SC1091
. "${TMP}/counts"
