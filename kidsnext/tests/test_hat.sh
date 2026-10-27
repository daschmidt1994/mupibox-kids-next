# shellcheck shell=bash
# mupi-kn-hat with a stand-in for i2cget and for the MuPiHAT scripts

(
	H="${TMP}/hat"
	mkdir -p "${H}/bin"
	export KN_HAT_TEST=1 KN_HAT_STATE="${H}/hat.json" MUPIBOX_CONFIG="${H}/config.json" KN_MUPIBOX_BIN="${H}/bin" \
		KN_I2CGET="${H}/i2cget" KN_SYSTEMCTL="${H}/systemctl" BOOT_CONFIG="${H}/config.txt"
	printf '#!/bin/bash\ncat "%s/reg"\n' "${H}" > "${H}/i2cget"
	printf '#!/bin/bash\necho "$@" >> "%s/systemctl.log"\n' "${H}" > "${H}/systemctl"
	printf '#!/bin/bash\ntouch "%s/enabled"\n' "${H}" > "${H}/bin/enable_mupihat.sh"
	printf '#!/bin/bash\nexit 0\n' > "${H}/bin/setting_update.sh"
	chmod +x "${H}/i2cget" "${H}/systemctl" "${H}/bin/"*.sh
	T="${KN}/hardware/mupi-kn-hat"
	fresh() { rm -f "${H}/hat.json" "${H}/enabled" "${H}/systemctl.log"; echo '{"mupihat":{"hat_active":false},"mupibox":{}}' > "${H}/config.json"; }

	fresh; echo 0x09 > "${H}/reg"
	eq "BQ25792 (REG48=0x09) wird erkannt" "$(bash "${T}" detect)" "present"
	echo 0x00 > "${H}/reg"
	eq "anderer Chip (0x00) ist kein MuPiHAT" "$(bash "${T}" detect)" "absent"
	echo "" > "${H}/reg"
	eq "keine Antwort ist kein MuPiHAT" "$(bash "${T}" detect)" "absent"

	fresh; echo 0x09 > "${H}/reg"
	bash "${T}" auto > /dev/null
	eq "auto: MuPiHAT eingeschaltet" "$([ -e "${H}/enabled" ] && echo ja)" "ja"
	eq "auto: hat_active gesetzt" "$(jq -r .mupihat.hat_active "${H}/config.json")" "true"
	eq "auto: Ergebnis gemerkt" "$(jq -r .result "${H}/hat.json")" "present"

	# switched off in the app afterwards: the detection does not switch it on again
	jq '.mupihat.hat_active = false' "${H}/config.json" > "${H}/c" && mv "${H}/c" "${H}/config.json"
	rm -f "${H}/enabled"
	bash "${T}" auto > /dev/null
	eq "auto zweites Mal: Entscheidung der Eltern bleibt" "$([ -e "${H}/enabled" ] && echo ja || echo nein)" "nein"

	fresh; echo 0x00 > "${H}/reg"
	bash "${T}" auto > /dev/null
	eq "auto ohne MuPiHAT: nichts eingeschaltet" "$([ -e "${H}/enabled" ] && echo ja || echo nein)" "nein"
	eq "auto ohne MuPiHAT: Ergebnis absent" "$(jq -r .result "${H}/hat.json")" "absent"

	fresh; printf 'dtparam=audio=off\n[pi5]\nfoo=1\n' > "${H}/config.txt"
	KN_HAT_NOBUS=1 bash "${T}" auto > /dev/null
	eq "ohne I2C-Bus: I2C für den nächsten Start eingetragen (unter [all])" "$(tail -n 2 "${H}/config.txt" | tr '\n' ' ')" "[all] dtparam=i2c_arm=on "
	eq "ohne I2C-Bus: Erkennung beim Start aktiviert" "$(cat "${H}/systemctl.log")" "enable mupi-kn-hat-detect.service"
	echo 0x09 > "${H}/reg"
	bash "${T}" auto --boot > /dev/null
	eq "beim nächsten Start: erkannt, eingeschaltet, Neustart" "$(tail -n 1 "${H}/systemctl.log")" "reboot"
	echo "PASS=${PASS} FAIL=${FAIL}" > "${TMP}/counts"
)
# shellcheck disable=SC1091
. "${TMP}/counts"
