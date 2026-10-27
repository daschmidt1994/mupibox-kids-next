# Installation – vollautomatisch beim ersten Start

Du stellst alles **vor dem ersten Start** direkt auf der SD-Karte ein: WLAN, Passwort und den Installer. Danach Karte in den Pi, Strom an, warten. Die Box richtet DietPi ein, installiert MuPiBox Kids Next und startet am Ende mit der Kinderoberfläche.

## 1. DietPi auf die SD-Karte schreiben
1. DietPi herunterladen: <https://dietpi.com/#download> → *Raspberry Pi* → **ARMv8 (64-bit)** (Pi 3B+, 4, 5, Zero 2 W).
2. Mit **Raspberry Pi Imager** (*Eigenes Image*) oder **balenaEtcher** auf die Karte schreiben.
3. Die Karte danach **noch einmal am PC öffnen**. Es erscheint das Laufwerk mit `dietpi.txt` und `dietpi-wifi.txt`.

## 2. `dietpi-wifi.txt` – das WLAN
Diese beiden Zeilen suchen und ausfüllen:
```
aWIFI_SSID[0]='Name deines WLANs'
aWIFI_KEY[0]='WLAN-Passwort'
```
Bei Netzwerkkabel kannst du das auslassen.

## 3. `dietpi.txt` – diese Zeilen ändern
Jede Zeile gibt es in der Datei schon. Suchen (Strg+F), den Wert nach dem `=` ersetzen, speichern:

```
AUTO_SETUP_LOCALE=de_AT.UTF-8
AUTO_SETUP_KEYBOARD_LAYOUT=de
AUTO_SETUP_TIMEZONE=Europe/Vienna
AUTO_SETUP_NET_WIFI_ENABLED=1
AUTO_SETUP_NET_WIFI_COUNTRY_CODE=AT
AUTO_SETUP_NET_HOSTNAME=mupibox-test
AUTO_SETUP_GLOBAL_PASSWORD=HierEinEigenesPasswort
AUTO_SETUP_AUTOMATED=1
SURVEY_OPTED_IN=0
AUTO_SETUP_CUSTOM_SCRIPT_EXEC=https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/firstboot/dietpi-firstboot.sh
```

Hinweise:
- `AUTO_SETUP_NET_WIFI_ENABLED=1` nur bei WLAN. Bei Kabel bleibt `0`.
- `AUTO_SETUP_NET_HOSTNAME` ist der Name der Box im Netz, z. B. `mupibox-jakob`. Er ist auch der Name des Backup-Ordners auf dem NAS.
- `AUTO_SETUP_GLOBAL_PASSWORD` ist das Passwort für `root` und `dietpi` (SSH). Bitte ein eigenes nehmen, **nicht** `mupibox` oder `dietpi`. DietPi löscht es nach dem ersten Start aus der Datei.
- Optional: Für einen anderen Stand des Installers (Branch oder Tag) die Datei `mupibox-kn.txt` daneben legen, mit einer Zeile `KN_REF=<branch>`.

## 4. Starten
1. Den USB-WLAN-Stick für den ersten Start am besten **noch nicht** einstecken; er wird später eingerichtet. **[auf Hardware prüfen]**
2. Karte in den Pi, Strom an.
3. Auf dem Display laufen zuerst DietPis Meldungen durch, dann:
   „MuPiBox Kids Next wird installiert … Das dauert 20–40 Minuten, bitte Strom nicht trennen.“
4. Am Ende startet die Box neu und zeigt die Kinderoberfläche.

## Wenn etwas nicht klappt
- **Protokolle direkt auf der SD-Karte** (am PC lesbar):
  - `mupibox-kn-firstboot.log`: was der automatische Start gemacht hat
  - `mupibox-kn-install.log`: das ausführliche Installationsprotokoll
- Schlägt die Installation fehl (z. B. Internet weg), versucht die Box es **beim nächsten Start erneut**, bis zu 3-mal. Ein Stromausfall mitten in der Installation führt ebenfalls zu einem neuen Versuch.
- Von Hand geht es immer per SSH:
  ```
  ssh root@mupibox-test
  curl -fsSL https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/install.sh | sudo bash
  ```
- Nach dem Neustart zeigt `sudo mupibox-kn-selftest`, ob alles da ist.

## Updates
Kids Next wird **nur aus diesem Repository** aktualisiert, nie aus der originalen MuPiBox. Deren Versionen sind für ihr eigenes Image mit älterem Debian gebaut und würden Kids Next überschreiben.

- **In der Eltern-App:** Einstellungen › Die Box › Updates.
  - **Stabil:** das neueste Release auf GitHub (Tag, z. B. `v0.2.0`).
  - **Entwicklung:** der aktuelle Stand des Branches `kids-next`. Ein Update wird angezeigt, sobald dort ein neuer Commit liegt.
  - Die Box folgt dem Kanal, mit dem sie installiert wurde. Ein Klick auf den anderen Kanal wechselt ihn.
- **Was dabei passiert:** Dieselbe Installation wie auf einer neuen Box (`install.sh --new --yes`), dauert 20–40 Minuten, danach Neustart.
  - Einstellungen, Bibliothek, Cover, WLAN und Backup-Einrichtung bleiben erhalten.
  - Einstellungen und Bibliothek werden vorher zusätzlich als ZIP in `/home/dietpi/mupibox-backups` gesichert (die neuesten drei bleiben).
  - Ein Abbruch lässt die Daten unangetastet; das Update kann einfach erneut gestartet werden.
- **Betriebssystem** (apt) getrennt davon über denselben Bildschirm.
- **Von Hand:** `curl -fsSL https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/install.sh | sudo bash -s -- --ref <tag oder kids-next>`
- Die installierte Version samt Commit steht in `/var/lib/mupibox-kn/installed.json`.
- Abgeschaltet: das alte Update-Skript der MuPiBox (`update/start_mupibox_update.sh`) und `autosetup.sh` ohne Kids-Next-Installer. Vorlagen und WLAN-Treiberskripte kommen von der Box selbst (`/opt/mupibox-kn/app/upstream`), die Neuigkeiten aus `kidsnext/news.txt`.

## Wiederherstellung nach SD-Defekt
Genauso installieren (mit demselben Hostnamen wie die alte Box). Danach in der Eltern-App unter Einstellungen › Die Box › Backup › „Vom NAS wiederherstellen“, oder per SSH:
```
sudo mupibox-restore
```
Ausführlich: [backup-und-wiederherstellung.md](backup-und-wiederherstellung.md).
