#!/bin/bash
#
# MuPiBox Kids Next – Wiederherstellung aus dem NAS-Backup auf einer installierten Box: nach einem Defekt der SD-Karte
# (neue Karte automatisch installiert, siehe docs/installation.md) oder um ein älteres Backup zurückzuholen.
#
#   sudo mupibox-restore

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten." >&2; exit 1; }
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
RESTORE="${DIR}/backup/mupi-kn-restore"
export KB_VERSION_FILE="${DIR}/VERSION"

"${RESTORE}" select || exit 1
"${RESTORE}" apply || { echo "Die Wiederherstellung war nicht vollständig – siehe Meldungen oben." >&2; exit 1; }
# the automatic backup goes on into the same place on the NAS
"${DIR}/backup/mupi-kn-backup" timer
echo
read -r -p "Wiederherstellung fertig. Jetzt neu starten? [J/n] " answer
[[ "${answer}" =~ ^[nN] ]] || reboot
