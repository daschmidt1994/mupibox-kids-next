# shellcheck shell=bash
# Backup and restore for real with restic, against a folder as "NAS" (NAS_TYPE=local). Mounting NFS/SMB is not covered
# here (needs the NAS) - see docs/testplan.md.
# restic: from PATH, or KB_RESTIC=/path/to/restic.

(
	RESTIC_BIN="${KB_RESTIC:-$(command -v restic)}"
	if [ -z "${RESTIC_BIN}" ] || [ ! -x "${RESTIC_BIN}" ]; then
		echo "  - restic nicht gefunden (KB_RESTIC=...), Backup-Tests übersprungen"
		echo "PASS=${PASS} FAIL=${FAIL}" > "${TMP}/counts"
		exit 0
	fi
	export KB_RESTIC="${RESTIC_BIN}" KN_TEST=1
	# (no device id unless a test sets one: the machine running the tests has its own)
	export KB_DEVICE_ID=""
	BOX="${TMP}/box" NAS="${TMP}/nas" VER="${TMP}/VERSION"
	export KN_FS="${BOX}" KB_VERSION_FILE="${VER}" KB_CACHE_DIR="${TMP}/cache"
	echo "0.1.0" > "${VER}"
	BK="${KN}/backup/mupi-kn-backup" RS="${KN}/backup/mupi-kn-restore"
	SKC="${BOX}/home/dietpi/.mupibox/Sonos-Kids-Controller-master"

	make_box() {
		mkdir -p "${BOX}/etc/mupibox/tls" "${SKC}/server/config" "${SKC}/www/cover" "${BOX}/home/dietpi/MuPiBox/media/audiobook/Bibi" \
			"${BOX}/home/dietpi/MuPiBox/media/cover" "${BOX}/etc/wpa_supplicant" "${BOX}/var/lib/bluetooth/B8:27:EB:00:00:01/AA:BB:CC:DD:EE:FF" \
			"${BOX}/var/lib/netbird" "${BOX}/etc/mupibox-kn/secrets" "${BOX}/var/lib/mupibox-kn" "${NAS}"
		echo '{"mupibox":{"version":"Kids Next 0.1.0","host":"mupibox-jakob"},"spotify":{"refreshToken":"geheim"}}' > "${BOX}/etc/mupibox/mupiboxconfig.json"
		echo "CA" > "${BOX}/etc/mupibox/tls/ca.crt"
		echo '[{"title":"Bibi Blocksberg"}]' > "${SKC}/server/config/data.json"
		echo '{"Bibi":{"position":1234}}' > "${SKC}/server/config/resume.json"
		echo '{"neu":true}' > "${SKC}/server/config/config.json"
		echo "cover" > "${BOX}/home/dietpi/MuPiBox/media/cover/bibi.jpg"
		head -c 300000 /dev/urandom > "${BOX}/home/dietpi/MuPiBox/media/audiobook/Bibi/folge1.mp3"
		printf 'ctrl_interface=DIR=/run/wpa_supplicant\nnetwork={\n\tssid="Zuhause"\n\tpsk=abc\n}\n' > "${BOX}/etc/wpa_supplicant/wpa_supplicant.conf"
		echo "[LinkKey]" > "${BOX}/var/lib/bluetooth/B8:27:EB:00:00:01/AA:BB:CC:DD:EE:FF/info"
		echo '{"PrivateKey":"x"}' > "${BOX}/var/lib/netbird/config.json"
		echo "speaker=40" > "${BOX}/var/lib/mupibox-kn/audio.json"
	}
	make_box

	# --- setup -------------------------------------------------------------------------------------------------------
	out=$("${BK}" setup --type local --share "${NAS}" --box mupibox-jakob --media 1 --yes < /dev/null 2>&1)
	if [ -f "${NAS}/mupibox-backups/mupibox-jakob/config" ]; then ok "setup legt das Repository an"; else nok "setup legt das Repository an" "${out}"; fi
	KEY=$(cat "${BOX}/etc/mupibox-kn/secrets/backup.key")
	if [[ "${KEY}" =~ ^([A-HJKMNP-Z2-9]{5}-){5}[A-HJKMNP-Z2-9]{5}$ ]]; then ok "Schlüssel im Format XXXXX-…"; else nok "Schlüssel im Format XXXXX-…" "${KEY}"; fi
	if grep -q "WIEDERHERSTELLUNGSSCHLÜSSEL" <<< "${out}" && grep -q "${KEY}" <<< "${out}"; then ok "Schlüssel wird einmal angezeigt"; else nok "Schlüssel wird einmal angezeigt"; fi
	eq "Schlüsseldatei nur für root" "$(stat -c %a "${BOX}/etc/mupibox-kn/secrets/backup.key")" "600"
	out=$("${BK}" setup --type local --share "${NAS}" --box mupibox-jakob --media 1 --yes < /dev/null 2>&1)
	if grep -q "Vorhandenes Backup" <<< "${out}" && [ "$(cat "${BOX}/etc/mupibox-kn/secrets/backup.key")" = "${KEY}" ]; then ok "setup erneut: vorhandenes Repository, Schlüssel bleibt"; else nok "setup erneut: vorhandenes Repository, Schlüssel bleibt" "${out}"; fi

	# --- run ---------------------------------------------------------------------------------------------------------
	out=$("${BK}" run --json 2>&1)
	if jq -e '.ok == true and (.snapshot | length) > 0 and .media == true' <<< "${out}" >/dev/null 2>&1; then ok "Backup gespeichert und geprüft (JSON)"; else nok "Backup gespeichert und geprüft (JSON)" "${out}"; fi
	eq "Verlauf hat einen erfolgreichen Eintrag" "$(jq '[.[] | select(.ok)] | length' "${BOX}/var/lib/mupibox-kn/backup-history.json")" "1"
	if grep -rqa "geheim" "${NAS}"; then nok "Daten auf dem NAS verschlüsselt (kein Klartext-Token)"; else ok "Daten auf dem NAS verschlüsselt (kein Klartext-Token)"; fi
	snaps=$(RESTIC_REPOSITORY="${NAS}/mupibox-backups/mupibox-jakob" RESTIC_PASSWORD_FILE="${BOX}/etc/mupibox-kn/secrets/backup.key" "${RESTIC_BIN}" ls latest 2>/dev/null)
	if grep -q "secrets/backup.key" <<< "${snaps}"; then nok "Schlüssel selbst nicht im Backup"; else ok "Schlüssel selbst nicht im Backup"; fi
	if grep -q "folge1.mp3" <<< "${snaps}"; then ok "Medien im Backup"; else nok "Medien im Backup"; fi

	out=$("${BK}" list --json 2>&1)
	eq "list zeigt das Backup mit Version" "$(jq -r '.[0].version' <<< "${out}" 2>/dev/null)" "0.1.0"
	out=$("${BK}" status --json 2>&1)
	if jq -e '.configured and .lastOk.ok and .failedSinceOk == 0 and .keyOnBox' <<< "${out}" >/dev/null 2>&1; then ok "status (JSON)"; else nok "status (JSON)" "${out}"; fi

	# --- NAS gone: fails cleanly, recorded ----------------------------------------------------------------------------
	mv "${NAS}" "${NAS}.weg"
	if "${BK}" run >/dev/null 2>&1; then nok "NAS weg: Backup schlägt fehl"; else ok "NAS weg: Backup schlägt fehl"; fi
	eq "NAS weg: Fehler im Verlauf" "$("${BK}" status --json | jq -r '.lastRun.ok, .failedSinceOk' | tr '\n' ' ')" "false 1 "
	mv "${NAS}.weg" "${NAS}"

	# --- damaged repository: verification fails ----------------------------------------------------------------------
	cp -a "${NAS}" "${TMP}/nas.heil"
	pack=$(find "${NAS}/mupibox-backups/mupibox-jakob/data" -type f | head -n 1)
	printf 'kaputt' | dd of="${pack}" bs=1 seek=40 conv=notrunc 2>/dev/null
	if "${BK}" check --full >/dev/null 2>&1; then nok "Beschädigtes Backup wird erkannt"; else ok "Beschädigtes Backup wird erkannt"; fi
	rm -rf "${NAS}"
	mv "${TMP}/nas.heil" "${NAS}"

	# --- SD card broken: a new box restores ---------------------------------------------------------------------------
	rm -rf "${BOX}"
	mkdir -p "${BOX}/etc/mupibox" "${SKC}/server/config" "${BOX}/etc/wpa_supplicant" "${BOX}/var/lib/mupibox-kn"
	echo '{"mupibox":{"version":"Kids Next 0.1.0"}}' > "${BOX}/etc/mupibox/mupiboxconfig.json"
	echo '{"neu":"installiert"}' > "${SKC}/server/config/config.json"
	printf 'network={\n\tssid="Handy"\n\tpsk=xyz\n}\n' > "${BOX}/etc/wpa_supplicant/wpa_supplicant.conf"

	if printf 'falsch-falsch\n' | "${RS}" select --type local --share "${NAS}" --box mupibox-jakob --snapshot latest --key-stdin >/dev/null 2>&1; then
		nok "Falscher Schlüssel wird abgelehnt"
	else
		ok "Falscher Schlüssel wird abgelehnt"
	fi
	out=$(printf '%s\n' "$(tr '[:upper:]' '[:lower:]' <<< "${KEY}" | tr -d '-')" | "${RS}" select --type local --share "${NAS}" --box mupibox-jakob --snapshot latest --key-stdin 2>&1)
	if [ -f "${BOX}/var/lib/mupibox-kn/restore-selection" ]; then ok "select: Schlüssel klein und ohne Bindestriche akzeptiert"; else nok "select: Schlüssel klein und ohne Bindestriche akzeptiert" "${out}"; fi

	echo "0.0.9" > "${VER}"
	if printf '%s\n' "${KEY}" | "${RS}" select --type local --share "${NAS}" --box mupibox-jakob --snapshot latest --key-stdin --state "${TMP}/sel-old" >/dev/null 2>&1; then
		nok "Backup einer neueren Version wird abgelehnt"
	else
		ok "Backup einer neueren Version wird abgelehnt"
	fi
	echo "0.1.0" > "${VER}"

	out=$(KR_BT_CONTROLLER="B8:27:EB:00:00:01" "${RS}" apply --netbird no 2>&1)
	if [ $? -eq 0 ]; then ok "apply läuft durch"; else nok "apply läuft durch" "${out}"; fi
	eq "Medienliste zurück" "$(jq -r '.[0].title' "${SKC}/server/config/data.json")" "Bibi Blocksberg"
	eq "Hörspielposition zurück" "$(jq -r '.Bibi.position' "${SKC}/server/config/resume.json")" "1234"
	eq "config.json der Installation bleibt" "$(jq -r '.neu' "${SKC}/server/config/config.json")" "installiert"
	eq "Spotify-Login zurück" "$(jq -r '.spotify.refreshToken' "${BOX}/etc/mupibox/mupiboxconfig.json")" "geheim"
	eq "Lokales Hörspiel zurück" "$(stat -c %s "${BOX}/home/dietpi/MuPiBox/media/audiobook/Bibi/folge1.mp3" 2>/dev/null)" "300000"
	eq "Cover zurück" "$(cat "${BOX}/home/dietpi/MuPiBox/media/cover/bibi.jpg" 2>/dev/null)" "cover"
	if grep -q 'ssid="Zuhause"' "${BOX}/etc/wpa_supplicant/wpa_supplicant.conf" && grep -q 'ssid="Handy"' "${BOX}/etc/wpa_supplicant/wpa_supplicant.conf"; then
		ok "WLAN: Netze aus Backup + aktuelles Netz"; else nok "WLAN: Netze aus Backup + aktuelles Netz" "$(cat "${BOX}/etc/wpa_supplicant/wpa_supplicant.conf")"; fi
	if [ -f "${BOX}/var/lib/bluetooth/B8:27:EB:00:00:01/AA:BB:CC:DD:EE:FF/info" ]; then ok "Bluetooth-Kopplung zurück (gleicher Pi)"; else nok "Bluetooth-Kopplung zurück (gleicher Pi)"; fi
	if [ ! -e "${BOX}/var/lib/netbird/config.json" ]; then ok "NetBird nicht übernommen (--netbird no)"; else nok "NetBird nicht übernommen (--netbird no)"; fi
	eq "Bericht: NetBird braucht Setup-Key" "$(jq -r '.needs | join(",")' "${BOX}/var/lib/mupibox-kn/restore-report.json")" "netbird-setup-key"
	eq "Kids-Next-Status zurück" "$(cat "${BOX}/var/lib/mupibox-kn/audio.json")" "speaker=40"
	eq "Backup läuft danach weiter in dasselbe Repository" "$(grep '^BOX_NAME=' "${BOX}/etc/mupibox-kn/backup.conf")" "BOX_NAME=mupibox-jakob"

	# --- what the app uses: browse (nothing changed on the box), select --no-check + apply --check ---------------------
	conf_before=$(cat "${BOX}/etc/mupibox-kn/backup.conf")
	key_before=$(cat "${BOX}/etc/mupibox-kn/secrets/backup.key")
	out=$("${RS}" browse --type local --share "${NAS}" 2>&1)
	eq "browse: Boxen auf dem NAS" "$(jq -r '.boxes | join(",")' <<< "${out}" 2>/dev/null)" "mupibox-jakob"
	out=$(printf '%s\n' "${KEY}" | "${RS}" browse --type local --share "${NAS}" --box mupibox-jakob --key-stdin 2>&1)
	if jq -e '.ok and (.snapshots | length) >= 1 and .snapshots[0].compatible and .snapshots[0].media' <<< "${out}" >/dev/null 2>&1; then
		ok "browse: Backups der Box (Version, Medien, kompatibel)"; else nok "browse: Backups der Box" "${out}"; fi
	out=$(printf 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF\n' | "${RS}" browse --type local --share "${NAS}" --box mupibox-jakob --key-stdin 2>&1)
	eq "browse: falscher Schlüssel als JSON (kind=key)" "$(jq -r '.ok, .kind' <<< "${out}" 2>/dev/null | tr '\n' ' ')" "false key "
	if [ "$(cat "${BOX}/etc/mupibox-kn/backup.conf")" = "${conf_before}" ] && [ "$(cat "${BOX}/etc/mupibox-kn/secrets/backup.key")" = "${key_before}" ]; then
		ok "browse verändert Einstellungen und Schlüssel der Box nicht"; else nok "browse verändert Einstellungen und Schlüssel der Box nicht"; fi
	rm -f "${SKC}/server/config/resume.json"
	out=$( { printf '%s\n' "${KEY}" | "${RS}" select --type local --share "${NAS}" --box mupibox-jakob --snapshot latest --key-stdin --no-check && \
		KR_BT_CONTROLLER="B8:27:EB:00:00:01" "${RS}" apply --check --netbird no --yes; } 2>&1)
	if grep -q "Backup geprüft" <<< "${out}" && [ -f "${SKC}/server/config/resume.json" ]; then ok "select --no-check + apply --check (Weg der App)"; else nok "select --no-check + apply --check (Weg der App)" "${out}"; fi

	# another Pi: Bluetooth needs pairing again
	rm -rf "${BOX}/var/lib/bluetooth"
	printf '%s\n' "${KEY}" | "${RS}" select --type local --share "${NAS}" --box mupibox-jakob --snapshot latest --key-stdin >/dev/null 2>&1
	KR_BT_CONTROLLER="DC:A6:32:00:00:02" "${RS}" apply --netbird yes >/dev/null 2>&1
	if [ ! -d "${BOX}/var/lib/bluetooth/B8:27:EB:00:00:01" ] && jq -e '.needs | index("bluetooth-pairing")' "${BOX}/var/lib/mupibox-kn/restore-report.json" >/dev/null; then
		ok "Anderer Pi: Bluetooth nicht übernommen, Kopplung gemeldet"; else nok "Anderer Pi: Bluetooth nicht übernommen, Kopplung gemeldet"; fi
	if [ -f "${BOX}/var/lib/netbird/config.json" ]; then ok "NetBird übernommen (--netbird yes)"; else nok "NetBird übernommen (--netbird yes)"; fi
	if jq -e '.needs | index("backup-paused")' "${BOX}/var/lib/mupibox-kn/restore-report.json" >/dev/null && grep -q '^ENABLED=0$' "${BOX}/etc/mupibox-kn/backup.conf"; then
		ok "Anderer Pi (Bluetooth-Adresse): automatisches Backup pausiert"; else nok "Anderer Pi (Bluetooth-Adresse): automatisches Backup pausiert" "$(cat "${BOX}/etc/mupibox-kn/backup.conf")"; fi

	# the device's serial number in the backup: another one pauses the backup, the same one (a new SD card) does not
	KB_DEVICE_ID="pi-aaaa" "${BK}" run >/dev/null 2>&1
	eq "Backup merkt sich das Gerät" "$(cat "${BOX}/var/lib/mupibox-kn/device-id" 2>/dev/null)" "pi-aaaa"
	printf '%s\n' "${KEY}" | "${RS}" select --type local --share "${NAS}" --box mupibox-jakob --snapshot latest --key-stdin >/dev/null 2>&1
	KB_DEVICE_ID="pi-aaaa" KR_BT_CONTROLLER="DC:A6:32:00:00:02" "${RS}" apply --netbird no >/dev/null 2>&1
	if ! jq -e '.needs | index("backup-paused")' "${BOX}/var/lib/mupibox-kn/restore-report.json" >/dev/null && grep -q '^ENABLED=1$' "${BOX}/etc/mupibox-kn/backup.conf"; then
		ok "Gleiches Gerät (neue SD-Karte): Backup läuft weiter"; else nok "Gleiches Gerät (neue SD-Karte): Backup läuft weiter" "$(cat "${BOX}/etc/mupibox-kn/backup.conf")"; fi
	printf '%s\n' "${KEY}" | "${RS}" select --type local --share "${NAS}" --box mupibox-jakob --snapshot latest --key-stdin >/dev/null 2>&1
	KB_DEVICE_ID="pi-bbbb" KR_BT_CONTROLLER="B8:27:EB:00:00:01" "${RS}" apply --netbird no >/dev/null 2>&1
	if jq -e '.needs | index("backup-paused")' "${BOX}/var/lib/mupibox-kn/restore-report.json" >/dev/null && grep -q '^ENABLED=0$' "${BOX}/etc/mupibox-kn/backup.conf"; then
		ok "Anderes Gerät (Seriennummer): Backup pausiert"; else nok "Anderes Gerät (Seriennummer): Backup pausiert" "$(cat "${BOX}/etc/mupibox-kn/backup.conf")"; fi

	echo "PASS=${PASS} FAIL=${FAIL}" > "${TMP}/counts"
)
# shellcheck disable=SC1091
. "${TMP}/counts"
