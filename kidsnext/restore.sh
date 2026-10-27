#!/bin/bash
#
# MuPiBox Kids Next – Wiederherstellung auf einer laufenden Box (z. B. ein älteres Backup zurückholen).
# Nach einem Defekt der SD-Karte stattdessen install.sh starten und „Wiederherstellung“ wählen.
#
#   sudo bash /opt/mupibox-kn/app/restore.sh

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten." >&2; exit 1; }
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
RESTORE="${DIR}/backup/mupi-kn-restore"
export KB_VERSION_FILE="${DIR}/VERSION"

"${RESTORE}" select || exit 1
"${RESTORE}" apply || { echo "Die Wiederherstellung war nicht vollständig – siehe Meldungen oben." >&2; exit 1; }
echo
read -r -p "Wiederherstellung fertig. Jetzt neu starten? [J/n] " answer
[[ "${answer}" =~ ^[nN] ]] || reboot
