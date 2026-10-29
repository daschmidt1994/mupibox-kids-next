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

**Am einfachsten in der Eltern-App:** *Einstellungen › System › Backup › NAS-Backup einrichten*. Dort gibt es auch „Jetzt sichern“, den Verlauf, „Schlüssel anzeigen“ und „Vom NAS wiederherstellen“.

Alternativ auf der Box per SSH:

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

Der Weg ist derselbe wie bei einer Neuinstallation. Erst installiert sich die Box automatisch, danach holst du die Daten mit einem Befehl zurück.

### 1. Neue microSD-Karte vorbereiten
Genau wie in [installation.md](installation.md), Schritte 1–3:
1. DietPi auf die Karte schreiben.
2. In `dietpi-wifi.txt` das WLAN eintragen.
3. In `dietpi.txt` die Zeilen ändern.

**Wichtig:** Bei `AUTO_SETUP_NET_HOSTNAME` denselben Namen wie bei der alten Box eintragen, z. B. `mupibox-jakob`.

### 2. Box starten und automatisch installieren lassen
1. Karte in den Pi, Strom an.
2. Warten, bis nach etwa 30–45 Minuten die (noch leere) Kinderoberfläche erscheint.

### 3. Wiederherstellen in der Eltern-App (einfachster Weg)
Im Browser die Box öffnen (`https://mupibox-jakob/app`, oder die IP-Adresse). Fragt die App beim ersten Öffnen nach einem Passwort, ein vorläufiges festlegen. Dann *Einstellungen › System › Backup › Backup vom NAS wiederherstellen*. Die App führt durch dieselben Schritte wie unten (NAS, Box, Schlüssel, Backup) und startet die Box danach neu. **Anmelden danach mit dem Passwort aus dem Backup.**

Ohne App geht es per SSH weiter mit Schritt 3a.

### 3a. Mit der Box verbinden
Am PC ein Terminal öffnen (Windows: *PowerShell*):
```
ssh root@mupibox-jakob
```
Das Passwort ist das aus `AUTO_SETUP_GLOBAL_PASSWORD`. Geht der Name nicht, die IP-Adresse aus dem Router nehmen (FRITZ!Box → *Heimnetz* → *Netzwerk*).

### 4. Wiederherstellung starten
```
sudo mupibox-restore
```

### 5. NAS verbinden
Die Box fragt nacheinander:
- NFS oder SMB
- Adresse des NAS (z. B. `192.168.178.20`)
- Freigabe:
  - NFS: der Pfad, bei Unraid z. B. `/mnt/user/backups`
  - SMB: der Name, z. B. `backups`
- bei SMB Benutzer und Passwort
- den Ordner der Backups (Standard `mupibox-backups`)

### 6. Backup auswählen
1. **Box wählen**, z. B. `mupibox-jakob`.
2. Den **Wiederherstellungsschlüssel** eingeben. Groß-/Kleinschreibung und Bindestriche sind egal; du hast 3 Versuche.
3. **Backup wählen**: Das neueste steht oben, mit Datum, Version und „mit/ohne Medien“.
4. Die Box **prüft das Backup** auf dem NAS (einige Minuten). Ist es beschädigt, bricht sie ab, **bevor** etwas verändert wird. Dann einfach ein älteres Backup wählen.

### 7. Backup wiederherstellen
1. Die Daten werden zurückgespielt. Mit Medien kann das je nach Menge länger dauern.
2. **NetBird-Frage:**
   - **Ja** nur, wenn die Box aus dem Backup **nie wieder eingeschaltet** wird (kaputte SD-Karte).
   - Sonst **Nein**, und NetBird später mit einem neuen Setup-Key verbinden. Das gilt vor allem für einen **Test auf einer zweiten Box**: Mit „Ja“ hat sie denselben NetBird-Zugang wie die echte Box, und beide verlieren die Verbindung, sobald sie gleichzeitig laufen.

> **Restore testen auf einer zweiten Box?** Gut so, aber danach die Karte neu flashen. Die Testbox ist eine Kopie der anderen Box, mit demselben Namen, Spotify-Konto und Elternpasswort. Ihr automatisches Backup pausiert die Box von selbst (siehe unten), damit sie nachts nicht in das Backup der echten Box schreibt.

### 8. Neu starten
Die Frage „Jetzt neu starten?“ mit **J** beantworten. Nach dem Neustart erscheint die gewohnte Kinderoberfläche mit allen Hörspielen.

### 9. (Alternative) Alles in einem Durchgang per SSH
Statt Schritt 2–8: DietPi ohne die Zeile `AUTO_SETUP_CUSTOM_SCRIPT_EXEC` starten und dann aufrufen:
```
curl -fsSL https://raw.githubusercontent.com/daschmidt1994/mupibox-kids-next/kids-next/kidsnext/install.sh | sudo bash
```
Im Menü „Wiederherstellung aus NAS-Backup“ wählen. Dann wird das Backup sogar **vor** der Installation geprüft.

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
| „Automatisches Backup pausiert“ | Die Box läuft auf einem anderen Pi als im Backup (erkannt an der Seriennummer des Pi, bei Backups vor 0.1.33 an der Bluetooth-Adresse) | Ersetzt der neue Pi die alte Box: unter *Backup › Ändern* wieder einschalten. Ist es eine zweite Box: Backup neu einrichten, mit eigenem Namen |

Die Eltern-App zeigt diese Punkte nach der Wiederherstellung zwei Wochen lang oben auf der Seite *Backup* an.

Auf demselben Pi (nur die SD-Karte ist neu) läuft das automatische Backup nach der Wiederherstellung weiter, in denselben Ordner auf dem NAS und mit demselben Schlüssel.

### Wenn etwas schiefgeht
- **„Keine Internetverbindung“:** Kabel prüfen, oder das WLAN in `dietpi.txt`/`dietpi-wifi.txt` prüfen (Schritt 1.3).
- **„NAS verweigert den Zugriff“:**
  - NFS: Ist die IP der Box in der Export-Regel erlaubt?
  - SMB: Benutzer und Passwort prüfen.
- **„Schlüssel passt nicht“:** Auf Verwechslungen achten. Im Schlüssel kommen 0, O, 1, I und L **nicht** vor.
- **Das Protokoll** liegt auf der Box unter `/var/log/mupibox-kn/` und als Kopie auf der Karte selbst: `mupibox-kn-install.log` im Boot-Laufwerk, am PC lesbar.
- Den Installer kannst du einfach **noch einmal starten**. Bereits Installiertes bleibt erhalten.
