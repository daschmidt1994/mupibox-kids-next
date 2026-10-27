# Testplan MuPiBox Kids Next

Status-Werte:
- **AUTO**: automatisch bestanden (`bash kidsnext/tests/run.sh`, ohne Hardware)
- **HW**: auf echter Hardware bestanden (Datum, Gerät)
- **OFFEN**: noch nicht durchgeführt
- **FEHLER**: durchgeführt, nicht bestanden

Hardware-Referenz: Raspberry Pi 3B+, Waveshare 5" DSI, TP-Link Archer T3U Plus, MuPiHAT.

RFID-Tests (Master-Prompt 9–11, 58) entfallen, weil RFID nicht gewünscht ist.

| Nr | Test | Erwartet | Tatsächlich | Status | Fehlermeldung | Mögliche Lösung |
|---|---|---|---|---|---|---|
| A1 | Systemerkennung Pi 3B+/Trixie/USB-WLAN (aufgezeichnete sysfs-Dateien) | Modell, RAM, DietPi, Debian, wlan0 intern/brcmfmac, wlan1 USB/rtw88_8822bu | wie erwartet | AUTO (27.10.2026) | | |
| A2 | Bullseye abgelehnt, neueres Debian nur nach Bestätigung, ohne DietPi abgelehnt | | wie erwartet | AUTO (27.10.2026) | | |
| A3 | Hilfsfunktionen idempotent (ensure_line, install_content) | | wie erwartet | AUTO (27.10.2026) | | |
| A4 | shellcheck ohne Warnungen | | wie erwartet | AUTO (27.10.2026) | | |
| 1 | Installation auf frischem DietPi | Box startet nach Neustart in die Kinderoberfläche | | OFFEN | | |
| 2 | Installer erneut ausführen | Medien, Medienliste, Resume, Cover, Theme, Einstellungen unverändert | | OFFEN | | |
| 3 | Automatischer Start nach Neustart | | | OFFEN | | |
| 4 | Alle Pakete installiert (`mupibox-kn-selftest`) | keine ✘ | | OFFEN | | |
| 5 | systemd-Dienste korrekt | keine fehlgeschlagenen mupi-Dienste | | OFFEN | | |
| 6 | Debian 12 und 13 | beide installieren fehlerfrei | | OFFEN | | |
| B1 | Bootzeit gemessen (Strom an → Kinderoberfläche bedienbar) | Wert wie NG, Messung dokumentiert | | OFFEN | | |
| 7 | Touchscreen-Bedienung (Waveshare 5" DSI) | | | OFFEN | | |
| 8 | Große kindgerechte Schaltflächen | | | OFFEN | | |
| 12 | Pause und Fortsetzen | | | OFFEN | | |
| 13 | Hörspielposition speichern | | | OFFEN | | |
| 14 | Fortsetzen an gespeicherter Position | | | OFFEN | | |
| 15 | Offline-Wiedergabe lokaler Hörspiele | spielt ohne Netz | | OFFEN | | |
| 16–18 | MuPiHAT erkannt, Lautsprecher, Verstärker | | | OFFEN | | |
| 19–24 | Bluetooth koppeln, Autoconnect, Umschalten, Stumm, Rückschalten, nach Neustart | | | OFFEN | | |
| 25 | Maximale Kinderlautstärke | wird nie überschritten, auch nicht beim Umschalten | | OFFEN | | |
| 26–38 | WLAN intern/USB, Treiber, Suche, Profile, Fallback, Hotspot | | | OFFEN | | |
| 39–46 | Spotify verbinden, OAuth, Playlists, Wiedergabe, über BT, zuhause/unterwegs, nach WLAN-Wechsel | | | OFFEN | | |
| 47–49 | NetBird verbinden, nach Netzwechsel, Eltern-App über NetBird | | | OFFEN | | |
| A5 | Backup-Repository anlegen, Schlüssel erzeugen (Format, Rechte 600, einmalige Anzeige), erneutes Einrichten behält den Schlüssel | | wie erwartet | AUTO (27.10.2026, restic 0.18.0, NAS = lokaler Ordner) | | |
| A6 | Backup mit Medien: gespeichert, geprüft (Snapshot, check, Probe-Restore mit Prüfsummen), Verlauf, `list`/`status` JSON | | wie erwartet | AUTO (27.10.2026) | | |
| A7 | Verschlüsselung: Spotify-Token nicht im Klartext auf dem NAS; Schlüssel selbst nicht im Backup | | wie erwartet | AUTO (27.10.2026) | | |
| A8 | NAS nicht erreichbar: Backup schlägt sauber fehl, Fehler im Verlauf | | wie erwartet | AUTO (27.10.2026) | | |
| A9 | Beschädigtes Paket auf dem NAS wird von `check --full` erkannt | | wie erwartet | AUTO (27.10.2026) | | |
| A10 | Restore auf leerer Box: falscher Schlüssel abgelehnt, Schlüssel ohne Bindestriche/klein akzeptiert, neuere Backup-Version abgelehnt | | wie erwartet | AUTO (27.10.2026) | | |
| A11 | Restore: Medienliste, Resume, Spotify-Login, Medien, Cover, Kids-Next-Status zurück; config.json der Installation bleibt; WLAN = Backup + aktuelles Netz; BT nur bei gleicher Adapter-MAC; NetBird nur mit „ja“; Bericht | | wie erwartet | AUTO (27.10.2026) | | |
| A12 | Restore-Befehle für die App: `browse` listet Boxen/Backups ohne Änderungen an der Box, falscher Schlüssel als JSON, `select --no-check` + `apply --check` | | wie erwartet | AUTO (27.10.2026) | | |
| A13 | Eingabeprüfung der App-Routen (`kn-backup.spec.ts`): Passwort nur auf stdin, unzulässige Werte abgelehnt | | wie erwartet | AUTO (27.10.2026) | | |
| A14 | Bestehende Server-Tests (backend-api) | | 50 von 51 bestanden; `server.spec.ts` (RSS-Content-Type) schlägt auch im unveränderten Original fehl | AUTO (27.10.2026) | | |
| G1 | Eltern-App › System › Backup: einrichten, Schlüssel anzeigen, jetzt sichern, Verlauf | | | OFFEN | | |
| G2 | Eltern-App: Wiederherstellen vom NAS (Box, Schlüssel, Backup, Neustart, Anmeldung mit altem Passwort) | | | OFFEN | | |
| 50 | NAS-Verbindung herstellen (Unraid, NFS und SMB) | Freigabe wird eingebunden | | OFFEN | | |
| 51–53 | Backup manuell und per Timer auf das Unraid-NAS | Eintrag im Verlauf, Snapshot auf dem NAS | | OFFEN | | |
| 54–56 | Integrität und Verschlüsselung auf dem echten NAS | | | OFFEN | | |
| 57 | Restore auf neuer SD-Karte über install.sh | Box wie vorher | | OFFEN | | |
| 59–63 | Restore WLAN, Spotify, Bluetooth, Positionen, Autostart | | | OFFEN | | |
| 64–70 | Stromausfall, WLAN-/NAS-/BT-/Spotify-Ausfall, Update ohne Datenverlust, Schutz der Eltern-App | | | OFFEN | | |
