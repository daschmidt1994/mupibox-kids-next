#!/bin/bash
#
# MuPiBox Kids Next – automatische Installation beim ersten Start von DietPi.
#
# In der dietpi.txt der frisch geschriebenen SD-Karte eintragen (siehe docs/installation.md):
#   AUTO_SETUP_CUSTOM_SCRIPT_EXEC=https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/firstboot/dietpi-firstboot.sh
#
# DietPi runs this as root near the end of its own first-run setup. It installs nothing itself - dietpi-software is still
# busy then, and the MuPiBox installer calls dietpi-software too. It only sets up a service that waits until DietPi is
# completely done and then runs kidsnext/install.sh without questions; the progress shows on the display.
#
# Optional on the boot partition (next to dietpi.txt): mupibox-kn.txt with KN_REF=<branch or tag>.

set -e
UNIT=/etc/systemd/system/mupibox-kn-firstboot.service
RUNNER=/opt/mupibox-kn/firstboot-run.sh

mkdir -p /opt/mupibox-kn /var/lib/mupibox-kn

cat > "${RUNNER}" <<'RUNNER_EOF'
#!/bin/bash
# Started by mupibox-kn-firstboot.service until the installation succeeded (at most 3 times, one per boot)
BOOT_DIR=/boot
[ -f /boot/firmware/dietpi.txt ] && BOOT_DIR=/boot/firmware
LOG="${BOOT_DIR}/mupibox-kn-firstboot.log"
TRIES_FILE=/var/lib/mupibox-kn/firstboot-tries
REPO=daschmidt1994/mupibox-kids-next
KN_REF=kids-next
if [ -f "${BOOT_DIR}/mupibox-kn.txt" ]; then
	ref=$(sed -n 's/^KN_REF=//p' "${BOOT_DIR}/mupibox-kn.txt" | tr -d '\r' | head -n 1)
	[[ "${ref}" =~ ^[A-Za-z0-9._/-]+$ ]] && KN_REF="${ref}"
fi

# what the parents see: on the display (tty1) and in the log on the memory card
show() {
	echo "$*" >> "${LOG}"
	{ echo "$*" > /dev/tty1; } 2>/dev/null
}

# done before (install.sh writes installed.json just before its restart): nothing more to do
if [ -f /var/lib/mupibox-kn/installed.json ]; then
	systemctl disable mupibox-kn-firstboot.service
	exit 0
fi

tries=$(cat "${TRIES_FILE}" 2>/dev/null || echo 0)
if [ "${tries}" -ge 3 ]; then
	show "MuPiBox Kids Next: automatische Installation 3x fehlgeschlagen - bitte per SSH starten (siehe ${LOG})."
	systemctl disable mupibox-kn-firstboot.service
	exit 1
fi
echo $((tries + 1)) > "${TRIES_FILE}"

# DietPi's first-run setup completely done (install stage 2) and no dietpi-software running any more
show "MuPiBox Kids Next: warte, bis DietPi mit der Ersteinrichtung fertig ist ..."
for _ in $(seq 1 720); do
	if [ "$(cat /boot/dietpi/.install_stage 2>/dev/null)" = "2" ] && ! pgrep -f 'dietpi-software|dietpi-update|apt-get|dpkg' >/dev/null; then
		break
	fi
	sleep 10
done
for _ in $(seq 1 60); do
	curl -fsS -o /dev/null -m 10 https://github.com && break
	sleep 10
done

show "MuPiBox Kids Next wird installiert (${KN_REF}). Das dauert 20-40 Minuten, bitte Strom nicht trennen."
# (the installer restarts the box at the end; the service stays on until installed.json is there - a power cut in
# between means another try at the next start)
if curl -fsSL --retry 5 --retry-delay 10 "https://raw.githubusercontent.com/${REPO}/${KN_REF}/kidsnext/install.sh" -o /tmp/kn-install.sh; then
	KN_REF="${KN_REF}" bash /tmp/kn-install.sh --new --yes --ref "${KN_REF}" 2>&1 | while IFS= read -r line; do show "${line}"; done
	rc=${PIPESTATUS[0]}
	if [ "${rc}" -ne 0 ]; then
		show "MuPiBox Kids Next: Installation fehlgeschlagen (Versuch $((tries + 1)) von 3). Neuer Versuch beim nächsten Start; Protokoll: ${LOG}"
	fi
	exit "${rc}"
fi
show "MuPiBox Kids Next: Installer konnte nicht geladen werden (Internet?). Neuer Versuch beim nächsten Start."
exit 1
RUNNER_EOF
chmod 755 "${RUNNER}"

cat > "${UNIT}" <<'UNIT_EOF'
[Unit]
Description=MuPiBox Kids Next: automatische Installation beim ersten Start
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/mupibox-kn/firstboot-run.sh
TimeoutStartSec=4h
StandardOutput=journal

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable mupibox-kn-firstboot.service
# (started now in the background: it waits for DietPi to finish this very setup; after a restart it runs again by itself)
systemctl start --no-block mupibox-kn-firstboot.service
echo "MuPiBox Kids Next: Installation startet automatisch, sobald DietPi fertig ist."
