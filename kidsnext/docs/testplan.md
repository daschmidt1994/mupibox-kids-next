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
| 50–57 | NAS, Backup manuell/automatisch, Integrität, Verschlüsselung, Restore neue SD | | | OFFEN | | |
| 59–63 | Restore WLAN, Spotify, Bluetooth, Positionen, Autostart | | | OFFEN | | |
| 64–70 | Stromausfall, WLAN-/NAS-/BT-/Spotify-Ausfall, Update ohne Datenverlust, Schutz der Eltern-App | | | OFFEN | | |
