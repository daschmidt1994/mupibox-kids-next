# MuPiBox Kids Next – Phase 1: Bestandsaufnahme und Konzept

Stand: 27.10.2026. Analysiert wurde `splitti/MuPiBox`, Branch `main`, Commit `fc8939c` (Version 5.0.12 dev vom 22.10.2026).

Grundsatzentscheidung (Daniel, 27.10.2026):
- Grundlage ist die normale MuPiBox (Classic).
- MuPiBox NG wird nicht verwendet.
- **RFID/NFC und Spiele entfallen.** Die Abschnitte und Tests zu RFID im Master-Prompt (u. a. Tests 9–11 und 58) sind damit gestrichen.

Kennzeichnung in diesem Dokument:
- **[Code]**: im Quellcode nachgelesen
- **[Doku]**: aus offizieller Dokumentation
- **[Wissen]**: aus meinem Wissensstand, noch nicht gegenprüft
- **[prüfen]**: muss auf echter Hardware geprüft werden

---

## 1. Bestandsaufnahme der vorhandenen Funktionen

### 1.1 Aufbau des Projekts [Code]

| Teil | Technik | Ort im Repo | Laufzeit auf der Box |
|---|---|---|---|
| Kinderoberfläche | Angular 20 + Ionic 8, Swiper; rund 70 Themes | `src/frontend-box` | Chromium im Kiosk-Modus (DietPi-Software 113) |
| API-Server | Node 22, Express 5, esbuild-Bundle, Port 8200 | `src/backend-api` | pm2-Prozess `server` als `dietpi` |
| Eltern-App (neu) | reines JavaScript ohne Build, unter `/app` | `src/backend-api/src/mupi-app`, Routen in `src/eltern/*.ts` | im API-Server |
| Player | Express 4, steuert mpv über JSON-IPC, Port 5005 | `src/backend-player` | pm2-Prozess `spotify-control` |
| Alte Admin-Oberfläche | PHP hinter lighttpd | `AdminInterface/www` | seit 5.0.x standardmäßig aus (`legacy_admin.sh off`) |
| Skripte und Dienste | Bash/Python, systemd-Units | `scripts/*`, `config/services` | `/usr/local/bin/mupibox`, `/etc/systemd/system` |
| Installer | `autosetup/autosetup.sh`, whiptail-Fortschrittsbalken | | `curl …/autosetup.sh \| sudo bash` auf frischem DietPi |
| Update | `update/start_mupibox_update.sh` (1410 Zeilen), `conf_update.sh` | | ZIP vom GitHub-Tag laut `version.json`, Wiederaufnahme per `mupi_update_recover` |

Daten und Konfiguration:
- `/etc/mupibox/mupiboxconfig.json`: zentrale Einstellungen, auch Spotify-Tokens und der Passwort-Hash
- `…/server/config/data.json`: Medienliste
- `/home/dietpi/MuPiBox/media/…`: lokale Medien, Cover, TTS, Themes
- Resume-Daten und ähnliche Dateien liegen im Server-Konfigurationsordner.

Programmcode und Benutzerdaten liegen damit teilweise gemischt unter `/home/dietpi`.

Die Lizenz ist **MIT**. Drittkomponenten stehen in `THIRD_PARTY_NOTICES.md`; für TIDAL wird `tidalapi` (LGPL) nachgeladen, das ist optional. Ein Fork ist ohne Einschränkung erlaubt, solange der Lizenzhinweis erhalten bleibt.

### 1.2 Funktionen

| Bereich | Vorhanden [Code] | Bewertung für Kids Next |
|---|---|---|
| Touch-Kinderoberfläche | Cover-Listen, Kategorien (Hörspiel, Musik, Sonstiges), Player, Themes, Sleep-Timer, Lautstärke-Sperre (`volume-lock.ts`), Nachtdimmung | **übernehmen** |
| Quellen | Lokale Dateien (mpv), Spotify (Alben, Playlists, Künstler, Shows), Radio-Streams, RSS-Podcasts mit Offline-Kopie, WebDAV-NAS als Medienquelle, TIDAL (inoffiziell, standardmäßig aus) | übernehmen; TIDAL bleibt aus |
| Resume | Wiedergabeposition pro Medium (`playback-snapshot.ts`, `episode-state.ts`) | übernehmen, kommt ins Backup |
| Spotify | Wiedergabe über das **Web Playback SDK in Chromium** (`spotify-player.service.ts`, braucht Widevine `libwidevinecdm0`); daneben **librespot** als Connect-Gerät (`dev_0.6_20250806`, auf dev-Installationen aus); Web API über `@spotify/web-api-ts-sdk`; OAuth Authorization Code mit State-Prüfung, PKCE wenn kein Secret gesetzt ist (`eltern/oauth.ts`) | **modernisieren** (Abschnitt 4) |
| Audio | PulseAudio im **System-Modus** (`pulseaudio --system`); `asound.conf` mit Softvol auf Karte 0; Wahl der Ausgabe über `pactl` (`audio-output.ts`), getrennte Lautstärke je Ausgabe durch PulseAudio; Watchdog bindet den Soundkartentreiber neu | **auf PipeWire umbauen**, Logik aus `audio-output.ts` weiterverwenden |
| Bluetooth | `scan_bt.sh`, `pair_bt.sh`, `remove_bt.sh`; `autoconnect_bt.sh` ruft alle 5 s `bluetoothctl connect` in einer Endlosschleife; Akkuanzeige über BlueZ Experimental | **neu**: ereignisgesteuert, bevorzugtes Gerät, automatische Rückschaltung |
| MuPiHAT | `enable_mupihat.sh`: I2C, `dtoverlay=max98357a,sdmode-pin=16`, `i2s-mmap`, DietPi-Soundkarte `MAX98357A bcm2835-i2s-HiFi HiFi-0`; Lade-IC **BQ25792** über `python3-smbus2` (`mupihat_bq25792.py`, `charge_estimate.py`), Flask-Statusseite, Abschalten bei leerem Akku, Dienste `mupi_hat`/`mupi_hat_control` | **übernehmen** (funktioniert, ist Trixie-fest) |
| Weitere Hardware | OnOff SHIM (`gpio-poweroff`), Power-LED (pigpio, HW-PWM), Lüfter, Drehregler, WLED, Ladeanzeige | übernehmen, optional |
| WLAN | ifupdown + wpa_supplicant (DietPi-Standard). WLAN wird über eine JSON-Warteschlange angelegt (`add_wifi.sh`, Schleife alle 2 s). `mupi_wifi_select.sh` bevorzugt den USB-Stick (udev-Regel, „make before break“, Rückfall auf internes WLAN), LAN hat Vorrang. Eigener `wifi_monitor.sh` ersetzt den DietPi-Monitor, `mupi_wpa_guard.sh` | **neu auf NetworkManager**; die Regeln aus `mupi_wifi_select.sh` (USB bevorzugt, LAN zuerst) werden zur Vorgabe |
| USB-WLAN | Bevorzugung per udev, `set_onboard_wifi.sh` (rfkill), DKMS-Installer für rtl88x2bu/rtl8821au (morrownr) auf Knopfdruck | **modernisieren** (Abschnitt 6) |
| Hotspot | **nicht vorhanden** | neu |
| Backup | `backup.php`: ZIP mit Config, `data.json`, Covern, Hintergrund; `fullbackup.php`; Wiederherstellung über `apply_restored_settings.sh`/`conf_update.sh`; `file-backup.ts` hält eine `.bak` und Tageskopien (7 Tage) der JSON-Dateien | **neu**: NAS, verschlüsselt, mit Zeitplan; die Tageskopien bleiben |
| „NAS“ im Original | `nas.php` und `/api/nas`: **WebDAV-Medienquelle** (Ordner auf dem NAS durchsuchen und herunterladen), **kein Backup-Ziel** | bleibt als Medienquelle |
| Updates | Kanäle stable/beta/dev/branch, Abbruchschutz, Konfigurationsmigration per `conf_update.sh` | übernehmen, auf unseren Fork umstellen |
| Fernzugriff | VNC/noVNC, DietPi-Dashboard, Telegram-Bot, MQTT/Home Assistant (alles optional und aus) | NetBird neu; Rest optional |
| Elternschutz | Login für die Eltern-App (Session), CSRF-Schutz, Hostname-Prüfung gegen DNS-Rebinding (`lighttpd_hosts.sh`), eigene kleine CA für HTTPS | übernehmen |
| RFID | **im Original nicht vorhanden** | entfällt (Entscheidung oben) |

---

## 2. Technische Probleme und veraltete Abhängigkeiten

Nach Schwere sortiert. Alle Punkte habe ich im Code nachgelesen [Code], sofern nicht anders markiert.

| # | Problem | Ort | Folge | Lösung in Kids Next |
|---|---|---|---|---|
| P1 | `www-data ALL=(ALL:ALL) NOPASSWD: ALL` | `autosetup.sh:571` | Jede Lücke in lighttpd oder PHP bedeutet sofort Root-Rechte | sudo nur noch für einzelne Helfer-Skripte mit geprüften Argumenten (`/etc/sudoers.d/mupibox-kn`); PHP-Admin wird nicht installiert |
| P2 | **Installer ist nicht wiederholbar.** `rm -Rf /home/dietpi/.mupibox /home/dietpi/MuPiBox` und `mv template → /etc/mupibox/mupiboxconfig.json` | `autosetup.sh:291, 313` | Ein zweiter Lauf **löscht lokale Hörspiele, Cover und alle Einstellungen** | Programmdateien unter `/opt/mupibox-kn/releases/<ver>`, Daten unter `/var/lib/mupibox-kn` bzw. `/home/dietpi/MuPiBox`; Vorlagen nur einspielen, wenn nichts vorhanden ist |
| P3 | Downloads ohne Prüfsumme: `curl \| sudo bash` vom Branch `main`, jq, DietPi-Dashboard, NodeSource-Setup-Skript, noVNC `HEAD`, WLAN-Treiber `HEAD` | autosetup, `install_rtl*.sh` | Lieferkette nicht reproduzierbar | Feste Versionen mit SHA-256 in `installer/versions.env`; apt-Pakete aus Debian, wo möglich |
| P4 | Feste Standard-Passwörter: Samba `dietpi/mupibox`; SSH-Root-Passwort `mupibox` (auf euren Boxen gesehen) | `autosetup.sh:418` | Jeder im WLAN kommt hinein | Installer erzwingt eigenes Passwort; Samba nur auf Wunsch und mit eigenem Passwort |
| P5 | PulseAudio im System-Modus | `pulseaudio.service`, autosetup:530 | Von PulseAudio selbst nicht empfohlen; Bluetooth läuft dort schlecht; jede Umschaltung braucht eigenen Code | PipeWire + WirePlumber als Benutzerdienst von `dietpi` (Abschnitt 5) |
| P6 | Bluetooth-Autoconnect als Endlosschleife, die alle 5 s `bluetoothctl connect` aufruft | `autoconnect_bt.sh` | Kein bevorzugtes Gerät, keine Lautstärkeregel, CPU- und Lograuschen | Ereignisgesteuert über D-Bus/WirePlumber (Abschnitt 5) |
| P7 | WLAN über eine JSON-Datei, die ein Skript alle 2 s abfragt; ifupdown-Zustände müssen von Hand repariert werden (`ifdown --force`) | `add_wifi.sh`, `mupi_wifi_select.sh` | Schwer testbar und fehleranfällig; Prioritäten und Hotspot sind nicht machbar | NetworkManager (Abschnitt 6) |
| P8 | Treiber-Installer installiert `raspberrypi-kernel-headers` | `install_rtl88x2bu.sh:13` | Das Paket gibt es ab Bookworm nicht mehr (heißt `linux-headers-rpi-v8` bzw. `-2712`) [Wissen]; morrownr/88x2bu ist archiviert, rtl8822bu läuft im Kernel als `rtw88_8822bu` (ab Linux 6.2) [Wissen] | In-Kernel-Treiber zuerst; DKMS nur als Ausnahme mit richtigem Header-Paket |
| P9 | Spotify-Wiedergabe hängt am Web Playback SDK in Chromium (Widevine) | `spotify-player.service.ts` | Spielt nur, solange der Kiosk-Browser läuft; Widevine auf ARM ist fragil; Neustart des Browsers bricht die Wiedergabe ab | Soloist als eigener Dienst (Abschnitt 4); SDK bleibt als Rückfall |
| P10 | librespot (inoffiziell), eigene Binärdatei im Repo, auf dev aus | `bin/librespot` | Graubereich bei den Spotify-Nutzungsbedingungen | Fällt weg; Soloist ist offiziell |
| P11 | Logs unter `/home/dietpi` (`mupi_wifi_select.log`) und `/var/log/pulseaudio.log` | | Schreiben unnötig auf die SD-Karte | journald (DietPi: RAM-Log) bzw. ein Log mit Größengrenze |
| P12 | `telepot` per `pip --break-system-packages` | autosetup:184 | Telepot wird seit 2019 nicht gepflegt; die Systempakete werden verändert | Telegram fällt weg oder wird optional |
| P13 | DietPi-Dashboard auf v0.6.2 festgenagelt | autosetup:359 | Alt | Weglassen; Statusanzeige über das eigene Dashboard |
| P14 | Zwei Admin-Oberflächen (PHP + App) | | Doppelte Angriffsfläche | Nur die App, PHP wird nicht installiert |
| P15 | Kein NAS-Backup, keine Verschlüsselung; WLAN und Bluetooth fehlen im Backup | | Ein SD-Defekt bedeutet Handarbeit | Abschnitt 8 |
| P16 | Wiederherstellung nur in einer laufenden Box (Upload in der Oberfläche) | | Nach einem SD-Defekt fehlt der Weg | Restore-Modus im Installer |

Unkritisch und gut gelöst [Code]:
- Atomares Schreiben der Konfiguration mit Lock
- Datei-Tageskopien
- Hostname-Prüfung
- Abbruchschutz bei Updates
- Unterscheidung `/boot` / `/boot/firmware`
- libgpiod v1 und v2
- Wartezeit auf die apt-Sperre

Das übernehme ich.

---

## 3. Kompatibilität mit DietPi und Debian

| | Bullseye (11) | Bookworm (12) | Trixie (13) |
|---|---|---|---|
| Classic 5.0.12 | Reste im Code (`if OS=bullseye`) | unterstützt | unterstützt seit 5.0.10 (`libasound2t64`, `/boot/firmware`, gpiod v2, `raspi-utils-core`) [Code] |
| Kids Next | **nicht unterstützt** (DietPi pflegt es nicht mehr [Wissen]) | unterstützt | **Ziel** (aktuelles DietPi 10 baut auf Trixie [Code-Kommentar]) |

Regeln für den Installer (`installer/detect-system.sh`):
- `VERSION_CODENAME` und `/boot/dietpi/.version` lesen.
- Unterstützt sind `bookworm` und `trixie`.
- Bei einer **unbekannten neueren** Version fragt der Installer nach und bricht nicht einfach ab: Eine Liste der geprüften Versionen plus eine Warnung, damit wir nicht an Debian 12 kleben.
- Kein `dist-upgrade` auf ein neues Major-Release, das bleibt Aufgabe von DietPi.
- Architektur `aarch64` empfohlen. `armv7l` geht, weil es Soloist auch für arm32 gibt [Doku]. Für die Chromium-Oberfläche brauchen 32-Bit-Pi-Modelle mit 1 GB RAM aber Swap (zram, gibt es schon: `boot_tuning.sh`).
- Paketnamen, die sich je Version unterscheiden, löst eine Tabelle in `installer/dependencies.sh` auf, z. B. `libasound2` → `libasound2t64` und die Kernel-Header-Pakete.

---

## 4. Spotify: bestehende Lösung im Vergleich zu Soloist, librespot und Alternativen

| | Web Playback SDK (Classic heute) | librespot / go-librespot | **Spotify Soloist** | Spotify Connect ohne eigenes Gerät |
|---|---|---|---|---|
| Herkunft | offiziell, für Browser | inoffizielle Nachbauten | **offiziell, Headless-Client von Spotify** [Doku] | |
| Läuft ohne Browser | nein (Chromium + Widevine) | ja | ja | |
| Audio | Chromium → PulseAudio | ALSA/Pulse | **PipeWire oder PulseAudio**, Zielgerät mit `--pipewire-device` wählbar [Doku] | |
| ARM | Widevine-Paket von RPi | ja | **arm64 und arm32**, getestet auf Pi 3 A+ unter Raspberry Pi OS Trixie [Doku] | |
| Steuerung | JS-SDK | Web API | **lokal über WebSocket-API und `soloist ctl`**, dazu Spotify Connect [Doku] | |
| Haken | Browser muss laufen | Nutzungsbedingungen unklar | **Builds laufen nach 90 Tagen ab (Exit-Code 10)**; eigener API-Key je Nutzer, das Konto des Keys braucht **Premium**; Binärdateien **nicht weitergeben**, sondern vom Spotify-CDN laden; der Key steht in der Kommandozeile und ist in `ps` sichtbar (Issue spotify/soloist#12) [Doku] | |

**Entscheidung: Soloist wird der Standard.** Das SDK im Browser bleibt als Rückfall, wenn kein Soloist-Key hinterlegt ist; der Code dafür existiert schon.

Folgen:
- `installer/spotify.sh` lädt `https://soloist-builds.spotifycdn.com/soloist_release_<arch>.tar.gz`. Wir verteilen also nichts selbst.
- Der Dienst `mupi-kn-soloist-update.timer` prüft wöchentlich auf eine neue Build und tauscht sie vor Ablauf der 90 Tage aus. Bei Exit-Code 10 lädt er sofort neu.
- Der Key liegt in `/etc/mupibox-kn/secrets/soloist.key` (Besitzer root, Rechte `0600`). Ein Startskript übergibt ihn; da er laut Soloist-Doku nur per Kommandozeile geht, läuft der Dienst unter einem eigenen Benutzer und mit `ProtectProc=invisible`. Damit sehen andere Benutzer den Key nicht in `ps`.
- Der Player (`backend-player`) bekommt einen Soloist-Adapter für WebSocket und die Befehle play, pause, next, previous, Position und Lautstärke. Die Albumwahl läuft weiter über Web-API-Daten im API-Server.
- Wie die Wiedergabe einer bestimmten URI im Daemon-Modus genau aussieht (WebSocket-Befehl oder Web API `PUT /me/player/play` mit der Device-ID), muss ich auf der Features-Seite und auf echter Hardware nachprüfen **[prüfen]**.

**Autoplay am Album-Ende** (das Problem auf Jakobs Box): Spotify hängt nach einem Album selbst Fremdes an. Lösung in Kids Next:
- Der Player kennt die letzte Track-URI des Kontexts.
- Wechselt Spotify danach in einen fremden Kontext, pausiert der Player sofort.
- Das Verhalten ist pro Kategorie schaltbar: bei Hörspielen an, bei Musik auf Wunsch.
- Classic hat dafür schon `albumstop.sh`/`albumstop_activator.sh` [Code]. Das bauen wir auf Soloist-Ereignisse um.

**Was Premium braucht:**
- Jede Wiedergabe (Soloist, SDK, Connect), Steuerung über die Web API und den Soloist-Key.
- Nur Lesen geht ohne Premium: Playlists, Alben, Cover.
- Im Development Mode muss laut NG-Doku auch der Besitzer der Spotify-App Premium haben [Doku]. Die Änderungen am Development Mode 2026 gegenprüfen **[prüfen]**.

**Wichtig bei zwei Boxen:** Ein Spotify-Konto spielt immer nur auf einem Gerät gleichzeitig [Wissen]. Jakob und Julia brauchen deshalb je ein eigenes Konto, z. B. als Mitglieder eines Family-Abos. Sonst stoppt die eine Box die andere.

Kinderschutz bei Spotify:
- Kinder sehen nur, was die Eltern in die Medienliste aufgenommen haben (so ist es heute schon).
- Die freie Suche gibt es nur in der Eltern-App.
- Fehler zeigt die Kinderoberfläche als Bild an („Spotify schläft gerade“) statt als Text.

---

## 5. Konzept MuPiHAT und Bluetooth-Audio

### 5.1 MuPiHAT
- Treiber und Overlay wie im Original [Code]:
  - `dtparam=i2c_arm=on`, `i2c_arm_baudrate=50000`
  - `dtoverlay=max98357a,sdmode-pin=16`
  - `dtoverlay=i2s-mmap`
  - Lade-IC BQ25792 über I2C (Adresse laut Skript)
- `enable_mupihat.sh` wird **unverändert** übernommen; es ist schon idempotent und achtet auf die `[all]`-Sektion.
- Welche Hardware-Revisionen das abdeckt: Das Skript unterscheidet keine Revisionen. Die genaue Version deines HATs muss ich wissen (Abschnitt 10).
- Der Verstärker MAX98357A hat **keinen eigenen Lautstärkeregler** und keinen Mute-Pin außer SD_MODE (GPIO 16, vom Treiber geschaltet). Stummschalten heißt also:
  - der Sink wird gemutet und kein Stream läuft auf ihm;
  - PipeWire legt den Knoten nach kurzer Zeit schlafen;
  - der Treiber zieht dann SD_MODE auf low, der Verstärker ist aus und rauscht nicht [Wissen, prüfen].

### 5.2 PipeWire statt PulseAudio
Begründung:
- Debian 13 nutzt PipeWire 1.4 und WirePlumber 0.5 als Standard [Wissen].
- Bluetooth A2DP läuft dort besser als mit `pulseaudio-module-bluetooth`.
- `pipewire-pulse` versteht `pactl`. Die vorhandene Logik in `audio-output.ts` läuft also weiter.
- Soloist unterstützt PipeWire direkt.
- Auf Julias Box läuft bereits PipeWire mit genau diesem MAX98357A-Verstärker. Damit ist die Kombination auf eurer Hardware schon einmal gelaufen.

Aufbau:
- PipeWire, pipewire-pulse und WirePlumber laufen als **Benutzerdienste von `dietpi`**, mit `loginctl enable-linger dietpi`. Ein System-Modus wird von PipeWire nicht unterstützt.
- Chromium, mpv (pm2) und Soloist laufen ebenfalls als `dietpi` und hängen damit an derselben Audiositzung.
- Bluetooth-Rollen: nur `a2dp_sink`. HFP/HSP (Headset-Mikrofon) ist aus, sonst schaltet WirePlumber bei manchen Kopfhörern auf schlechte Telefonqualität.

### 5.3 Automatische Umschaltung: Dienst `mupi-kn-audiod`
Ein eigener kleiner Dienst (Python 3, nur Standardbibliothek), unabhängig vom API-Server. Fällt der API-Server aus, schaltet die Box trotzdem um.

```
Ereignisse: pactl subscribe (Sink neu/entfernt) + BlueZ D-Bus (Device1.Connected)
            │
            ▼
 Kopfhörer verbunden ──► 1. Lautstärke des BT-Sinks auf den gespeicherten Kopfhörerwert setzen (höchstens Kopfhörer-Maximum)
                         2. erst dann BT-Sink als Standard setzen und alle laufenden Streams verschieben
                         3. Lautsprecher-Sink stummschalten
 Kopfhörer getrennt  ──► 1. Lautsprecher-Sink auf den gespeicherten Lautsprecherwert (höchstens Lautsprecher-Maximum)
                         2. Lautsprecher als Standard, Streams verschieben, Mute aufheben
                         3. Hörspiele: Wiedergabe pausieren (einstellbar: „bei Trennung pausieren“ / „weiterspielen“)
 Jede Lautstärkeänderung ► über Maximum der aktiven Ausgabe? → sofort zurück auf das Maximum
 Start                   ► Lautsprecher aktiv; bevorzugte Kopfhörer werden 60 s lang angefragt; kommen sie, wird umgeschaltet
```

Begründung für die einzelnen Regeln:
- **Zuerst die Lautstärke, dann umschalten.** So wird es nie plötzlich laut.
- **Bei Trennung pausieren** ist der Standard. Sonst spielt der Lautsprecher los, während das Kind die Kopfhörer im Bett vergessen hat. Das lässt sich in der Eltern-App ändern.
- Soloist wird mit `--pipewire-device` **nicht** auf ein festes Gerät gelegt. Er folgt dem Standard-Sink und wird so mit umgeschaltet. **[prüfen]**: ob Soloist einen laufenden Stream verschieben lässt.
- Die Einstellungen liegen in `/var/lib/mupibox-kn/audio.json`:
  - `speaker.volume`, `speaker.max`
  - `headphones.volume`, `headphones.max`
  - `preferredHeadphones` (MAC-Adresse)
  - Profile Tag/Nacht mit Uhrzeit
- Die bestehende `volume-lock.ts` (Kinder-Maximum in der Oberfläche) bleibt und liest künftig das Maximum der jeweils aktiven Ausgabe.

### 5.4 Bluetooth-Verwaltung
Die Eltern-App bekommt eine API (`eltern/bluetooth.ts`) über die D-Bus-Schnittstelle von BlueZ. `bluetoothctl` wird nicht mehr ausgewertet.
- Funktionen: Suche 20 s, Koppeln mit `NoInputNoOutput`-Agent, Vertrauen, Verbinden, Trennen, Entfernen, „bevorzugt“ markieren
- Anzeige: Verbindungsstatus, Akku, aktive Ausgabe
- Kinder müssen nur die Kopfhörer einschalten. Bekannte Geräte sind `Trusted` und verbinden sich selbst; WirePlumber und `mupi-kn-audiod` erledigen den Rest.

---

## 6. Konzept WLAN, USB-WLAN und mehrere Netze

### 6.1 Entscheidung: NetworkManager übernimmt WLAN
Begründung: Alles, was gefordert ist, kann NetworkManager von Haus aus:
- mehrere Profile mit `autoconnect-priority`
- Suche mit Signal und Verschlüsselung (`nmcli -t dev wifi list`)
- Hotspot mit DHCP (`ipv4.method shared`)
- mehrere Adapter, Bindung eines Profils an ein Gerät
- Wiederverbinden

In Classic baut dafür rund 600 Zeilen eigene Shell-Logik auf ifupdown auf und bleibt trotzdem fehleranfällig (P7).

So vermeiden wir Konflikte mit DietPi:
- Der Installer übernimmt die **bestehende** WLAN-Verbindung aus `/etc/wpa_supplicant/wpa_supplicant.conf` bzw. `dietpi-wifi.db` als NM-Profil.
- `wlan*` wird in `/etc/network/interfaces` deaktiviert, `dietpi-wifi-monitor` abgeschaltet.
- Die Umstellung passiert **erst beim abschließenden Neustart**. So bricht die SSH-Sitzung während der Installation nicht ab.
- `eth0` bleibt bei ifupdown und damit bei DietPi.
- NM bekommt `unmanaged-devices=interface-name:eth0`. Nur `dietpi-config` sollte danach nicht mehr für WLAN benutzt werden; das steht in der Doku.
- Rückweg: `installer/wifi.sh --revert` stellt ifupdown wieder her.

Passwörter speichert NetworkManager in `/etc/NetworkManager/system-connections/*.nmconnection` (Besitzer root, `0600`). Die App sieht sie nie wieder, sie kann sie nur setzen.

### 6.2 Adapter
- `mupi-kn-netd` erkennt alle `wlan*` über sysfs.
- Unterscheidung intern/USB: Pfad von `/sys/class/net/<if>/device` enthält `usb` bzw. `mmc` (SDIO). Den Namen `wlan0` setzen wir nicht als intern voraus.
- Pro Adapter angezeigt werden: Chipsatz (USB-ID über `lsusb` bzw. `modalias`), Treiber (`/sys/class/net/<if>/device/driver`), Rolle und Signal.
- Optional bekommen Adapter feste Namen per `.link`-Datei: `wlint` für intern, `wlusb0` für USB.

### 6.3 Regeln (übernommen aus `mupi_wifi_select.sh`)
1. LAN vor WLAN, über die Routen-Metrik: eth0 100, bevorzugtes WLAN 600, das andere 700.
2. Der bevorzugte Adapter ist einstellbar; Standard ist der USB-Stick, falls vorhanden.
3. Die Profile sind **nicht** an einen Adapter gebunden. Fällt der bevorzugte aus (USB abgezogen, kein Netz), verbindet NM dasselbe Profil über den anderen.
4. Kommt der bevorzugte zurück, erledigt ein NM-Dispatcher-Skript den Wechsel. Erst neu verbinden, dann den anderen trennen (make before break).
5. Internes WLAN „deaktivieren“ heißt `nmcli dev set <if> managed no` plus rfkill. Das geht nur, wenn ein anderer Adapter verbunden ist (Schutz vor dem Aussperren, wie in Classic).

### 6.4 Einrichtungs-Hotspot
- **Auslöser:** 90 s nach dem Start kein bekanntes WLAN und kein LAN. Oder die Eltern starten ihn in der App bzw. mit einer Tastenkombination auf dem Display (lange auf das Logo drücken plus PIN).
- **Hotspot:** SSID `MuPiBox-<Name>`, WPA2 mit einem Passwort, das bei der Installation erzeugt wird. Es steht auf einem Aufkleber-Ausdruck in der Doku und lässt sich über die PIN auf dem Display anzeigen. IP `10.42.0.1`, Captive-Portal-DNS leitet auf die Einrichtungsseite.
- **Ein Adapter:** Hotspot und Suche wechseln sich ab. NM kann während des AP-Betriebs nicht frei suchen; deshalb wird vor dem Start gesucht und die Liste zwischengespeichert. Alle 5 min wird kurz neu gesucht.
- **Zwei Adapter:** Der USB-Stick ist Client, das interne WLAN Hotspot, oder umgekehrt.
  - Gleichzeitiger AP- und Client-Betrieb auf **einem** Chip (brcmfmac im Pi) ist nur eingeschränkt möglich (gleicher Kanal) [Wissen]. Darauf verlasse ich mich nicht.
  - Der Hotspot geht aus, sobald ein Netz 5 min stabil ist (einstellbar).
- **Offline-Wiedergabe:** Lokale Hörspiele laufen weiter; das Netz hat damit nichts zu tun.

### 6.5 USB-WLAN-Treiber
`installer/usb-wifi.sh`:
1. USB-IDs auslesen und mit `hardware/usb-wifi/known-adapters.tsv` abgleichen.
2. Treiber im laufenden Kernel vorhanden (`modinfo`)? Dann nichts tun. Das betrifft rtw88 für 8822BU/8821CU/8723DU sowie mt76 und ath9k_htc [Wissen].
3. Sonst DKMS mit dem **passenden Header-Paket** (`linux-headers-rpi-v8` bzw. `-2712`, Bookworm/Trixie [Wissen]) aus einer festgelegten Quelle und Version.
4. Bisher unterstützt waren rtl88x2bu und rtl8821au [Code]. Für 8821AU/8812AU gibt es `rtw88_8821au` erst ab Linux 6.13 [Wissen, prüfen]. Mit dem 6.12-Kernel des Pi ist dafür also wohl weiterhin DKMS nötig.
5. Die Option „Deep Power Save aus“ für rtw88 (`options rtw88_core disable_lps_deep=y`) hilft gegen Abbrüche [Wissen].

---

## 7. Spotify-OAuth zuhause und unterwegs (mit NetBird)

### 7.1 Regeln von Spotify [Wissen, Stand der Regeländerung 2025]
- Redirect-URIs müssen **HTTPS** sein. Ausnahme ist Loopback mit IP-Adresse: `http://127.0.0.1:<port>` oder `http://[::1]`.
- `localhost` ist nicht erlaubt.
- Die URI muss **exakt** einer in der App eingetragenen entsprechen; Wildcards gibt es nicht.

Ein NetBird-Name (`mupibox-jakob.netbird.cloud` oder deine eigene DNS-Zone) eignet sich damit nur mit gültigem HTTPS-Zertifikat. Das bekommt die Box im privaten Netz aber nicht ohne öffentliche DNS-Challenge. Außerdem hängt die Anmeldung dann daran, dass das Handy im NetBird ist. **Eine direkte Redirect-URI auf die Box wird deshalb verworfen.**

### 7.2 Lösung: feste Weiterleitungsseite plus PKCE
```
Eltern-Handy                          Spotify                  Weiterleitungsseite (statisch, HTTPS)          Box
     │ "Spotify verbinden" in der Eltern-App (über LAN-IP, Hotspot oder NetBird – egal)                         │
     │◄──────────────────────── 302 authorize?…&redirect_uri=https://<relay>/callback&state=S&code_challenge=C ─┤
     │──── Login + Zustimmung ──►│                                                                              │
     │◄─ 302 https://<relay>/callback?code=X&state=S ─┤                                                         │
     │── lädt Seite ──────────────────────────────────►│ JS liest S = <zufall>.<box-url-base64url>              │
     │                                                  │ prüft box-url gegen Allowlist (RFC1918, 100.64/10,    │
     │                                                  │ *.netbird-Zone, .local); sonst Abbruch                │
     │◄────────────── window.location = <box-url>/api/spotify/callback?code=X&state=S ─┤                       │
     │──────────────────────────────────────────────────────────────────────────────────────────────────────►│ prüft S (einmalig, 10 min),
     │                                                                                                          │ tauscht X + PKCE-Verifier
     │                                                                                                          │ gegen Tokens, speichert sie
```

Eigenschaften:
- **Unabhängig vom WLAN:** In `state` steht die Adresse, über die die Eltern die App gerade geöffnet haben. Das funktioniert zuhause, im Hotspot und unterwegs über NetBird.
- **Sicher:**
  - Der `code` ist ohne den PKCE-Verifier wertlos, und der liegt nur auf der Box. Die Weiterleitungsseite sieht keine Tokens und speichert nichts.
  - `state` wird nach dem Muster in `eltern/oauth.ts` geprüft: Zufallswert, einmal gültig, TTL, an die Session gebunden.
  - Die Allowlist auf der Seite verhindert, dass sie als offener Redirect missbraucht wird.
- **Hosting:** eine einzige statische HTML-Datei.
  - Empfehlung: **GitHub Pages** des Forks, also `https://<github-user>.github.io/mupibox-kids-next/callback/`. Kostenlos, HTTPS, kein eigener Server.
  - Alternativ deine eigene Domain auf dem Pangolin-VPS.
  - Das Prinzip macht NG mit `app.mupibox.de` genauso [Doku].
- **Rückfall „Manuelle Rückgabe“:**
  - Wenn die Weiterleitung nicht klappt (Handy nicht im NetBird), zeigt die Seite den Code und einen Kopieren-Knopf an.
  - Die Eltern fügen ihn in der App ein.
  - Ohne Weiterleitungsseite geht es über `http://127.0.0.1:8200/...` als zweite eingetragene URI. Der Browser zeigt dann einen Fehler, aber die Adresszeile enthält den Code.
- **Tokens:**
  - Refresh-Token und optionales Client-Secret liegen in `/etc/mupibox-kn/secrets/spotify.json` (root `0600`); der API-Server liest sie über einen Helfer. Heute liegen sie in `mupiboxconfig.json`, das wird verschoben.
  - Das Frontend bekommt nur kurzlebige Access-Tokens ohne Secret. Das ist nötig, solange das Web Playback SDK als Rückfall bleibt.
  - Erneuerung: automatisch 5 min vor Ablauf. Bei einem Fehler fragt der Dienst neu an (Backoff); bei `invalid_grant` zeigt die Eltern-App den Hinweis „Spotify neu verbinden“.
- Nach einem WLAN-Wechsel ändert sich nichts. Der Refresh-Token hängt nicht an der Adresse.

### 7.3 NetBird
- **Installation:** offizielles apt-Repository `pkgs.netbird.io` mit Signaturschlüssel; der Dienst ist `netbird.service` [Wissen].
- **Anmelden:** `netbird up --management-url <deine URL> --setup-key <key>`. Der Setup-Key wird nur einmal eingegeben und nicht gespeichert.
- **Status:** `netbird status --json` liefert IP, FQDN und Peers für das Dashboard.
- **Nach einem Netzwechsel** baut NetBird die Verbindung selbst neu auf. Zusätzlich startet ein NM-Dispatcher-Hook bei `connectivity-change` den Dienst neu, falls er länger als 2 min `Disconnected` meldet.
- **Kein offener Port:** Die Eltern-App lauscht wie bisher auf 80/443 und wird nicht ins Internet freigegeben. Die Hostname-Prüfung (`lighttpd_hosts.sh`) lässt zusätzlich die NetBird-IP und den FQDN zu.
- Wiedergabe und Oberfläche hängen nicht von NetBird ab.
- **Backup:** `/var/lib/netbird/config.json` enthält den WireGuard-Schlüssel des Peers. Er wird nur **verschlüsselt** gesichert. Beim Restore auf derselben Box geht es ohne neue Anmeldung weiter; sonst fragt der Assistent nach einem neuen Setup-Key.

---

## 8. NAS-Backup und Restore

### 8.1 Werkzeug: restic
Begründung:
- In Debian enthalten.
- **Verschlüsselt** (AES-256 + Poly1305).
- Dedupliziert, deshalb sind tägliche Backups mit Medien klein.
- **Integritätsprüfung** mit `restic check --read-data-subset`.
- Aufbewahrungsregeln mit `forget --keep-daily/--keep-weekly --prune`.
- Snapshots mit Datum, Host und Tags (wir setzen die Kids-Next-Version als Tag).
- Ein eigenes tar+gpg-System bräuchte all das selbst gebaut.

### 8.2 Ziel und Ablauf
- **NAS-Zugang:**
  - SMB/CIFS mit `mount.cifs` (vers=3.1.1, sonst 3.0) und Zugangsdatei `/etc/mupibox-kn/secrets/nas.cred` (root `0600`)
  - NFS mit `nfs-common` (v4.2, sonst v3)
  - Eingehängt wird **nur für die Dauer des Backups** unter `/run/mupibox-kn/nas`, mit `soft`/Timeouts und `timeout 30 mount`. Ist das NAS weg, scheitert nur der Backup-Lauf; die Wiedergabe bleibt unberührt.
- **Repository:** `<freigabe>/<backup-verzeichnis>/<boxname>` (ein restic-Repo pro Box).
- **Schlüssel:**
  - Das Repo-Passwort ist ein **Wiederherstellungsschlüssel**: 6 × 5 Zeichen, bei der Einrichtung erzeugt und **einmalig angezeigt**, zum Aufschreiben oder für den Passwortmanager.
  - Auf der Box liegt eine Kopie für automatische Backups (`/etc/mupibox-kn/secrets/backup.key`, root `0600`).
  - Zum Restore gibst du ihn ein. **Er hängt nicht an der SD-Karte.**
  - Optional kann ein zweites Passwort angelegt werden (`restic key add`), z. B. ein Familien-Passwort.
- **Zeitplan:** `mupi-kn-backup.timer`: täglich 03:30 (einstellbar), mit `Persistent=true`, damit ein verpasster Lauf nachgeholt wird. Ein Lauf startet nicht, während etwas abgespielt wird; er wartet höchstens 2 h.
- **Aufbewahrung:** Standard 7 täglich, 4 wöchentlich, 6 monatlich; in der App einstellbar.
- **Erfolg:**
  1. Backup läuft durch.
  2. `restic check` und `--read-data-subset=<neue Packs>` sind OK.
  3. Der Snapshot ist gelistet.
  4. Erst dann wird das Ergebnis `ok` in `/var/lib/mupibox-kn/backup-history.json` eingetragen.
  Fehler werden mit Grund protokolliert und im Dashboard rot angezeigt. Logs enthalten keine Passwörter, die werden nur per Datei oder Umgebungsvariable übergeben.

### 8.3 Inhalt
| Gruppe | Pfade | Restore |
|---|---|---|
| MuPiBox-Einstellungen | `/etc/mupibox/` (ohne Secrets), `…/server/config/*.json` (Medienliste, Resume, Favoriten, Podcasts, Sperren) | immer |
| Kids-Next-Status | `/var/lib/mupibox-kn/` (Audio, Netz-Einstellungen, Verlauf) | immer |
| Eigene Medien-Assets | Cover, eigene Themes/Bootscreens, TTS | immer |
| Lokale Hörspiele und Musik | `/home/dietpi/MuPiBox/media/` | nur wenn in der App gewählt |
| WLAN-Profile | `/etc/NetworkManager/system-connections/` | immer |
| Bluetooth-Kopplungen | `/var/lib/bluetooth/<adapter-mac>/` | nur wenn die Adapter-MAC gleich ist, also derselbe Pi; sonst Kopplungs-Assistent |
| Spotify | `/etc/mupibox-kn/secrets/spotify.json`, Soloist-Key | immer; Soloist-Binärdatei wird neu geladen |
| NetBird | `/var/lib/netbird/` | nur mit Rückfrage (siehe 7.3) |
| Elternkonto | Passwort-Hash aus der Config | immer |
| HTTPS-CA der Box | `/etc/mupibox/tls` o. ä. (Pfad aus `tls_cert.sh`) | immer, damit Handys dem Zertifikat weiter vertrauen |
| NAS-Zugang | wird bei der Wiederherstellung ohnehin eingegeben | — |

Programmdateien und Pakete werden **nicht** gesichert; die installiert der Installer neu.

### 8.4 Restore nach SD-Defekt
`install.sh` fragt am Anfang:

```
1  Neuinstallation
2  Wiederherstellung aus NAS-Backup
```

Bei 2:
1. Netzwerk prüfen. Bei einer frischen DietPi-Installation kommt es von DietPi (LAN, oder das WLAN aus `dietpi.txt`). Ohne Netz bricht der Installer mit einer klaren Anleitung ab.
2. NAS abfragen: Typ, Adresse, Freigabe, Benutzer, Passwort, Verzeichnis. Verbindungstest.
3. Unter dem Verzeichnis alle Box-Repos auflisten und eines wählen lassen. Dann den Wiederherstellungsschlüssel abfragen.
4. Snapshots anzeigen: Datum, Box-Version, Größe, Medien ja/nein.
5. Prüfen: `restic check` für den Snapshot; Version kompatibel? Älter ist OK (Migration über `conf_update.sh` und unser Migrationsskript); neuer heißt erst Kids Next updaten.
6. Erst jetzt die **normale Installation** fahren, damit Pakete und Programme vorhanden sind.
7. Daten zurückspielen, Rechte korrigieren (`dietpi`, `www-data`, `0600`-Secrets).
8. Sonderfälle: Bluetooth-MAC vergleichen; NetBird nur nach Rückfrage; Soloist-Build laden.
9. Neustart. Danach testet `mupi-kn-selftest` die Funktionen und zeigt das Ergebnis im Dashboard an: Ton auf dem Lautsprecher, API, Spotify-Token, NetBird, NAS-Erreichbarkeit.
10. Konnte etwas nicht zurückkommen (Kopfhörer, NetBird, Spotify), führt der Wiederherstellungs-Assistent in der Eltern-App durch genau diese Schritte.

Der Restore läuft also **ohne die alte SD-Karte und ohne vorher eingerichtetes WLAN**.

---

## 9. Priorisierter Entwicklungsplan

### 9.1 Repository-Strategie
**Fork von `splitti/MuPiBox` auf GitHub, Branch `kids-next`.**

Die Upstream-Struktur bleibt. Neues kommt in einen eigenen Ordner, damit wir Upstream-Änderungen weiter einmergen können. Die vorgeschlagene Struktur aus dem Master-Prompt (`installer/`, `backup/`, …) setze ich **innerhalb von `kidsnext/`** um:

```
MuPiBox (Fork)/
├── src/ … scripts/ … config/ …        ← Upstream, nur gezielt geändert (markiert mit "KN:")
└── kidsnext/
    ├── install.sh                      ← Einstieg (Neuinstallation / Restore), ersetzt autosetup.sh
    ├── update.sh
    ├── restore.sh                      ← Restore auch später aus der laufenden Box
    ├── installer/
    │   ├── lib.sh                      ← Logging, Fehler, idempotente Helfer (ensure_line, ensure_pkg …)
    │   ├── versions.env                ← feste Versionen + SHA-256
    │   ├── detect-system.sh  dependencies.sh  dietpi.sh  mupibox-core.sh (= idempotente Teile aus autosetup.sh)
    │   ├── mupihat.sh  audio.sh  bluetooth.sh  wifi.sh  usb-wifi.sh  spotify.sh  netbird.sh  backup.sh
    │   └── services.sh  security.sh  selftest.sh
    ├── daemons/
    │   ├── audiod/mupi-kn-audiod.py    ← Abschnitt 5.3
    │   └── netd/mupi-kn-netd.py        ← Adapter-Regeln, Hotspot-Fallback (6.3/6.4)
    ├── backup/
    │   ├── mupi-kn-backup               ← backup | check | list | restore | prune
    │   └── nas.sh                       ← mount/umount SMB/NFS mit Timeouts
    ├── oauth-relay/index.html           ← statische Weiterleitungsseite (GitHub Pages)
    ├── systemd/                         ← *.service, *.timer, user-units für PipeWire/Soloist
    ├── sudoers/                         ← erlaubte Helfer
    ├── tests/                           ← bats (Shell), pytest (Daemons), vitest (TS), Hardware-Testprotokoll
    └── docs/                            ← deutsche Doku
```

Erweiterungen im Upstream-Code:
- `src/backend-api/src/eltern/`: `kn-wifi.ts`, `kn-bluetooth.ts`, `kn-audio.ts`, `kn-netbird.ts`, `kn-backup.ts`, `kn-dashboard.ts`
- dazu die passenden Seiten in `mupi-app`

**Pfade:**
- Programme: `/opt/mupibox-kn/` und Upstream-Pfade
- Daten: `/var/lib/mupibox-kn/` und Upstream-Datenpfade
- Secrets: `/etc/mupibox-kn/secrets/`
- Logs: journald

### 9.2 Reihenfolge
| Prio | Phase | Lieferung | Warum zuerst |
|---|---|---|---|
| 1 | Installer-Grundgerüst | `install.sh`, `lib.sh`, `detect-system.sh`, `mupibox-core.sh` (idempotent, P1–P4 behoben), `services.sh`, `selftest.sh` | Ohne wiederholbaren Installer ist nichts testbar; P2 zerstört Daten |
| 2 | Backup/Restore | `mupi-kn-backup`, `nas.sh`, Restore-Modus im Installer, Timer, `kn-backup.ts` + App-Seite | Dir am wichtigsten; schützt alle weiteren Tests |
| 3 | Audio/Bluetooth | `audio.sh` (PipeWire), `mupi-kn-audiod`, `kn-bluetooth.ts`, Umbau von `audio-output.ts` | Größter Alltagsnutzen; Fehlerbild von Julias Box |
| 4 | WLAN | `wifi.sh` (Migration auf NM), `usb-wifi.sh`, `mupi-kn-netd`, Hotspot, `kn-wifi.ts` + App-Seiten | Riskant (Netzzugang), deshalb nach dem Backup |
| 5 | Spotify | `spotify.sh` (Soloist + Update-Timer), Soloist-Adapter in `backend-player`, OAuth-Relay, Album-Ende-Stopp | |
| 6 | NetBird | `netbird.sh`, `kn-netbird.ts`, Dispatcher-Hook | Einfach, hängt an Phase 4 |
| 7 | Eltern-Dashboard | `kn-dashboard.ts`, Seiten für Updates, Logs, Diagnose | |
| 8 | Doku + Testprotokoll | `docs/*.md`, `tests/hardware-testplan.md` | Läuft mit jeder Phase mit |

Was automatisch getestet wird:
- Shell-Skripte mit `bats` und `shellcheck`
- Daemons mit `pytest`, mit nachgebildeten `pactl`-/`nmcli`-Ausgaben
- Backup/Restore **echt** gegen eine lokale Samba- und NFS-Freigabe in einem Container auf meinem Rechner

Alles mit Hardware (Ton, Bluetooth, WLAN-Adapter, Hotspot, MuPiHAT) wird nur als **„noch nicht auf Hardware getestet“** geführt, bis es auf einem echten Pi gelaufen ist.

---

## 10. Benötigte Angaben zu deiner Hardware

### Antworten (27.10.2026)
| Frage | Antwort | Folge |
|---|---|---|
| Pi | **Raspberry Pi 3B+** (1 GB, nur USB 2.0); soll aber auf allen gängigen Modellen laufen | Referenz für Tests und Bootzeit ist der Pi 3B+; Pi 4/5 und Zero 2 W bleiben unterstützt |
| Display | **Waveshare 5inch DSI LCD**, kapazitiv, 800×480 | Treiber-/Overlay-Frage auf Hardware klären (DSI, KMS oder Firmware-Modus) **[prüfen]** |
| USB-WLAN | **TP-Link Archer T3U Plus** (RTL8822BU, USB-ID 2357:0138 [Wissen]) | Treiber `rtw88_8822bu` ist im Kernel (ab 6.2), kein DKMS nötig **[prüfen]**; am Pi 3B+ nur USB 2.0, reicht für Audio |
| Spotify | 2 Boxen mit **2 Premium-Konten** | passt (ein Konto je Box) |
| NAS | **Unraid**, NFS bevorzugt | NFS und SMB werden beide unterstützt (Abschnitt 8) |
| NetBird | `https://netbird.daschmidt.at`, Setup-Keys erlaubt | Installer fragt den Setup-Key einmal ab |
| GitHub | `daschmidt1994` | Fork `daschmidt1994/mupibox-kids-next`, Branch `kids-next`; Weiterleitungsseite unter `https://daschmidt1994.github.io/mupibox-kids-next/callback/` |
| Classic-Extras | MQTT und VNC behalten, der Rest optional | Telegram, WLED, TIDAL, DietPi-Dashboard bleiben installierbar, aber aus |
| Testgerät | ein Pi ab dem Abend des 27.10. | |

### Zusätzliche Anforderung: Bootzeit wie bei NG
Die Box soll so schnell starten wie MuPiBox NG. Vorgehen:
1. Auf dem Pi 3B+ messen: `systemd-analyze`, `systemd-analyze critical-chain`, Zeit bis zum ersten Bild der Kinderoberfläche.
2. Danach gezielt optimieren. Ansatzpunkte in Classic:
   - Chromium-Start (DietPi-Autostart über getty/X)
   - Warten auf das Netz (`ifup@`/`wait-online`)
   - pm2-Start
   - Dienste, die die Kinderoberfläche nicht braucht, später starten
   - Gegebenenfalls ein leichterer Kiosk-Browser
3. Ziel und Messwerte kommen ins Testprotokoll. Ohne Messung auf dem echten Pi wird nichts behauptet.

1. **Raspberry Pi:** Welche Modelle mit wie viel RAM? (Pi 3B+, 4, 5, Zero 2 W)
2. **MuPiHAT:** Welche Version bzw. Revision, mit Akku (BQ25792)? Oder ein einzelnes MAX98357A-Board? Auf Julias Box läuft ein MAX98357A.
3. **Display:** Modell, Auflösung, Touch über USB oder DSI?
4. **USB-WLAN-Stick:** Modell bzw. USB-ID (`lsusb`)?
5. **Bluetooth-Kopfhörer:** Welche Modelle? Gibt es Lautsprecher-Boxen, die ebenfalls verbunden werden sollen?
6. **NAS:** Der Unraid-Server? Welche Freigabe und welcher Benutzer für die Backups; SMB oder NFS?
7. **NetBird:** Selbst gehostete Management-URL (dein VPS)? Darf jede Box einen eigenen wiederverwendbaren Setup-Key bekommen?
8. **Spotify:**
   - Ein Premium-Konto je Kind (Family)?
   - Wer legt die Spotify-Developer-App und den Soloist-Key an?
   - Weiterleitungsseite auf GitHub Pages: Unter welchem GitHub-Konto soll der Fork liegen?
9. **Testgerät:** Gibt es eine freie Box bzw. einen freien Pi zum Testen? Jakobs und Julias Boxen fasse ich nur mit deiner Freigabe an. Sollen die beiden später von NG auf Kids Next umgestellt werden? Ein Datenübernahme-Werkzeug von NG plane ich **nicht** ein, außer du willst es.
10. **Weitere Classic-Funktionen:** Telegram, WLED, MQTT/Home Assistant, VNC, TIDAL: behalten (optional, aus) oder weglassen?
