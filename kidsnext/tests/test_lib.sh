# shellcheck shell=bash

(
	KN_LOG=/dev/null
	# shellcheck source=../installer/lib.sh
	. "${KN}/installer/lib.sh"
	f="${TMP}/lib-file"

	kn_ensure_line "dtparam=i2c_arm=on" "${f}"
	kn_ensure_line "dtparam=i2c_arm=on" "${f}"
	eq "ensure_line schreibt eine Zeile nur einmal" "$(grep -c 'i2c_arm' "${f}")" "1"

	printf 'a\n' | kn_install_content "${TMP}/c" 600 "$(id -un):$(id -gn)"
	eq "install_content: neue Datei gilt als geändert" "$?" "0"
	printf 'a\n' | kn_install_content "${TMP}/c" 600 "$(id -un):$(id -gn)"
	eq "install_content: gleicher Inhalt gilt als unverändert" "$?" "1"
	eq "install_content: Rechte gesetzt" "$(stat -c %a "${TMP}/c")" "600"
	eq "install_content: keine Reste" "$(find "${TMP}" -name 'c.kn.*' | wc -l)" "0"

	if KN_YES=1 kn_confirm "?"; then ok "confirm mit KN_YES=1"; else nok "confirm mit KN_YES=1"; fi
	if KN_YES=0 kn_confirm "?" < /dev/null >/dev/null 2>&1; then nok "confirm ohne Antwort ist nein"; else ok "confirm ohne Antwort ist nein"; fi
	echo "PASS=${PASS} FAIL=${FAIL}" > "${TMP}/counts"
)
# shellcheck disable=SC1091
. "${TMP}/counts"
