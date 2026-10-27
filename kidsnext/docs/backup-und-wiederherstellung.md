# Backup und Wiederherstellung

Die MuPiBox sichert ihre Daten verschlüsselt auf das NAS. Geht die SD-Karte kaputt, bringt eine neue Karte mit frischem DietPi und dem Installer die Box wieder in den alten Zustand.

> **Das Wichtigste:** Beim Einrichten des Backups zeigt die Box einmalig den **Wiederherstellungsschlüssel** an (6 Blöcke à 5 Zeichen, z. B. `K7QM2-XH4PA-…`).
> **Schreib ihn auf** oder speichere ihn im Passwortmanager. Ohne ihn lässt sich das Backup nicht öffnen. Er liegt sonst nur auf der Box selbst, und die kann kaputtgehen.

## Was gesichert wird

| Immer | Nur wenn „Medien mitsichern“ an ist |
|---|---|
| Alle Einstellungen der MuPiBox, Elternpasswort | Lokale Hörspiele und Musik |
| Medienliste, Favoriten, Hörspielpositionen | Offline-Podcasts |
| Cover, eigenes Design, eigene Startbilder | |
| Spotify-Anmeldung | |
| WLAN-Netze | |
| Bluetooth-Kopplungen | |
| NetBird-Zugang | |
| HTTPS-Zertifikat der Box (Handys vertrauen ihm weiter) | |

Programme werden nicht gesichert; die installiert der Installer neu.

## Backup einrichten

Voraussetzungen:
- Auf dem NAS gibt es eine Freigabe für Backups.
- Bei **Unraid mit NFS**: Freigabe → *NFS* → *Export: Yes*, *Security: Private*, Regel z. B. `192.168.178.0/24(sec=sys,rw,no_root_squash)`. Bei NFS gibt es keine Anmeldung. Wer im Heimnetz ist, kann die Dateien lesen; sie sind aber verschlüsselt.
- **Unraid-Tipp:** Den Backup-Share **ohne Cache** bzw. mit *Primary storage: Array* anlegen. Verschiebt der Mover Dateien, während die Box sichert, meldet NFS sonst gelegentlich „stale file handle“.
- Bei **SMB**: einen eigenen Benutzer mit Schreibrecht auf die Freigabe anlegen.

Einrichten auf der Box (per SSH):

```
sudo mupi-kn-backup setup
```

Der Assistent fragt nacheinander:
1. NFS oder SMB
2. Adresse, Freigabe (und bei SMB Benutzer und Passwort)
3. Ordner und Name der Box
4. Medien ja/nein
5. Uhrzeit und Häufigkeit

Danach **den angezeigten Schlüssel aufschreiben.**

Die Einrichtung in der Eltern-App folgt in einer späteren Phase.

Nützliche Befehle:

| Befehl | Was er tut |
|---|---|
| `sudo mupi-kn-backup run` | Backup jetzt |
| `sudo mupi-kn-backup status` | Einstellungen, letztes Backup, nächster Termin, Fehler |
| `sudo mupi-kn-backup list` | alle Backups mit Datum und Version |
| `sudo mupi-kn-backup check --full` | alle Daten auf dem NAS vollständig prüfen (dauert) |
| `sudo mupi-kn-backup show-key` | Schlüssel noch einmal anzeigen (solange die Box läuft) |

Wann ein Backup als erfolgreich gilt: Es muss vollständig auf dem NAS liegen, und die Box muss es dort geprüft haben. Geprüft wird:
- ob das Backup in der Liste steht
- die Struktur
- jeden Tag ein Siebtel aller Daten (also alles innerhalb einer Woche)
- eine Probe-Wiederherstellung der Einstellungen mit Prüfsummen

Ist das NAS nicht erreichbar, schlägt nur das Backup fehl; die Box spielt normal weiter. Der Fehler steht in `status`. Läuft gerade etwas, wartet das automatische Backup bis zu 2 Stunden.

Aufbewahrung (Standard): die letzten 7 täglichen, 4 wöchentlichen und 6 monatlichen Backups. Ältere löscht die Box selbst.

---

## Die SD-Karte ist kaputt – Schritt für Schritt

Du brauchst:
- eine neue microSD-Karte (mindestens 16 GB)
- einen PC mit Kartenleser
- ein Netzwerkkabel **oder** dein WLAN-Passwort
- den **Wiederherstellungsschlüssel**
- die NAS-Daten: Adresse, Freigabe, bei SMB Benutzer und Passwort

### 1. Neue microSD-Karte vorbereiten
1. **DietPi** herunterladen: <https://dietpi.com/#download> → *Raspberry Pi* → *ARMv8 (64-bit)* für Pi 3B+, 4, 5 und Zero 2 W.
2. **Raspberry Pi Imager** oder **balenaEtcher** auf dem PC öffnen, *Eigenes Image* wählen, die heruntergeladene Datei und die Karte auswählen und schreiben.
3. **Nur bei WLAN statt Kabel:** Die Karte am PC erneut öffnen (Laufwerk „boot“). Dort in `dietpi.txt` setzen:
   ```
   AUTO_SETUP_NET_WIFI_ENABLED=1
   ```
   und in `dietpi-wifi.txt`:
   ```
   aWIFI_SSID[0]='Name deines WLANs'
   aWIFI_KEY[0]='WLAN-Passwort'
   ```
   Speichern und die Karte sicher auswerfen.

### 2. Offizielles DietPi starten
1. Die Karte in die MuPiBox stecken und den Strom einschalten.
2. Etwa 5 Minuten warten. DietPi richtet sich beim ersten Start selbst ein.
3. Die IP-Adresse der Box findest du im Router (z. B. FRITZ!Box → *Heimnetz* → *Netzwerk*, Gerät „DietPi“).

### 3. Mit der Box verbinden
Am PC ein Terminal öffnen (Windows: *PowerShell*) und eingeben:
```
ssh root@<IP-Adresse>
```
- Das Passwort beim ersten Start ist `dietpi`.
- DietPi stellt beim ersten Login ein paar Fragen. Dabei ein **neues Passwort** vergeben und die Fragen mit den Vorschlägen bestätigen.
- Software musst du in DietPi nichts auswählen: *Install* bestätigen, fertig.

### 4. Installer starten
```
curl -fsSL https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/install.sh | sudo bash
```

### 5. „Wiederherstellung aus NAS-Backup“ wählen
Im Menü den zweiten Punkt wählen und mit Enter bestätigen.

### 6. NAS verbinden
Der Installer fragt nacheinander:
- NFS oder SMB
- Adresse des NAS (z. B. `192.168.178.20`)
- Freigabe:
  - NFS: der Pfad, bei Unraid z. B. `/mnt/user/backups`
  - SMB: der Name, z. B. `backups`
- bei SMB Benutzer und Passwort
- den Ordner der Backups (Standard `mupibox-backups`)

### 7. Backup auswählen
1. **Box wählen**, z. B. `mupibox-jakob`.
2. Den **Wiederherstellungsschlüssel** eingeben. Groß-/Kleinschreibung und Bindestriche sind egal; du hast 3 Versuche.
3. **Backup wählen**: Das neueste steht oben, mit Datum, Version und „mit/ohne Medien“.
4. Die Box **prüft das Backup** auf dem NAS (einige Minuten). Ist es beschädigt, bricht sie hier ab, **bevor** etwas installiert wird. Dann einfach ein älteres Backup wählen.

### 8. Backup wiederherstellen
1. Jetzt installiert sich die MuPiBox. Auf einem Pi 3B+ dauert das 20–40 Minuten.
2. Danach spielt der Installer die Daten zurück. Mit Medien kann das je nach Menge deutlich länger dauern.
3. **NetBird-Frage:**
   - **Ja** nur, wenn die alte SD-Karte nicht mehr benutzt wird.
   - Sonst **Nein** und NetBird später mit einem neuen Setup-Key verbinden.

### 9. Neu starten
Die Frage „Jetzt neu starten?“ mit **Ja** beantworten. Nach dem Neustart erscheint die gewohnte Kinderoberfläche.

### 10. Prüfen, ob alles wieder da ist
```
ssh root@<IP-Adresse>
sudo mupibox-kn-selftest
```
Alle Zeilen sollten ✔ zeigen. Dann kurz selbst nachsehen:
- Spielt ein Hörspiel ab der gespeicherten Stelle weiter?
- Sind die Spotify-Alben da und spielen sie?
- Verbindet sich die Box nach einem Neustart mit dem WLAN?

**Was eventuell neu gemacht werden muss** (der Installer sagt es am Ende an):

| Meldung | Warum | Was tun |
|---|---|---|
| „Bluetooth-Kopfhörer bitte neu koppeln“ | Ein anderer Pi hat eine andere Bluetooth-Adresse; die Kopfhörer kennen nur die alte | Kopfhörer in den Kopplungsmodus bringen und in der Eltern-App unter *Bluetooth* koppeln |
| „NetBird … mit neuem Setup-Key verbinden“ | NetBird-Zugang nicht übernommen | Im NetBird-Dashboard (`netbird.daschmidt.at`) einen Setup-Key erzeugen und in der Eltern-App eintragen |

Auch das automatische Backup läuft nach der Wiederherstellung weiter, in denselben Ordner auf dem NAS und mit demselben Schlüssel.

### Wenn etwas schiefgeht
- **„Keine Internetverbindung“:** Kabel prüfen, oder das WLAN in `dietpi.txt`/`dietpi-wifi.txt` prüfen (Schritt 1.3).
- **„NAS verweigert den Zugriff“:**
  - NFS: Ist die IP der Box in der Export-Regel erlaubt?
  - SMB: Benutzer und Passwort prüfen.
- **„Schlüssel passt nicht“:** Auf Verwechslungen achten. Im Schlüssel kommen 0, O, 1, I und L **nicht** vor.
- **Das Protokoll** liegt auf der Box unter `/var/log/mupibox-kn/` und als Kopie auf der Karte selbst: `mupibox-kn-install.log` im Boot-Laufwerk, am PC lesbar.
- Den Installer kannst du einfach **noch einmal starten**. Bereits Installiertes bleibt erhalten.
