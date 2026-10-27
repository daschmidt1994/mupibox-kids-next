# NetBird – Fernzugriff von unterwegs

Mit NetBird hängt die Box in deinem eigenen VPN. Die Eltern-App erreichst du dann auch außerhalb des Heimnetzes, ohne Portfreigabe im Router.

## Einrichten in der Eltern-App
Einstellungen › Netzwerk › **NetBird**:
1. Ist NetBird noch nicht installiert: **„NetBird installieren“** (1–3 Minuten). Die Installation kommt aus dem offiziellen Repository von netbird.io und wird danach mit dem Betriebssystem-Update aktuell gehalten.
2. **„Verbinden“** und dann eintragen:
   - **Server:** deine Management-URL, z. B. `https://netbird.daschmidt.at`
   - **Setup-Key:** aus dem NetBird-Dashboard unter „Setup Keys“
   - **Name im VPN:** vorbelegt mit dem Hostnamen der Box
3. Danach zeigt die Seite den Status, die **NetBird-IP** und die Adresse für unterwegs (`http://<NetBird-IP>/app/`).

- **Trennen** beendet die Verbindung. Die Anmeldung bleibt, **„Wieder verbinden“** braucht keinen neuen Key.
- **„Mit neuem Setup-Key verbinden“** meldet die Box neu an, z. B. an einem anderen Server.

## Automatisch bei der Installation
Liegt auf der Boot-Partition (neben `dietpi.txt`) eine Datei `mupibox-kn-netbird.txt`, verbindet der Installer die Box gleich mit:
```
KN_NETBIRD_URL=https://netbird.daschmidt.at
KN_NETBIRD_SETUP_KEY=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```
Die Datei wird nach dem Lesen gelöscht. Trotzdem nimm dafür am besten einen Setup-Key mit **kurzer Gültigkeit und einmaliger Nutzung**, denn die Boot-Partition ist an jedem PC lesbar.

## Per SSH
```
sudo mupi-kn-netbird status
echo '<setup-key>' | sudo mupi-kn-netbird up --url https://netbird.daschmidt.at --key-stdin
sudo mupi-kn-netbird down
```

## Sicherheit
- Der Setup-Key geht nur über stdin bzw. eine kurzlebige Datei (0600, `/run`) an NetBird. Er erscheint nicht in der Prozessliste, in keinem Log und nicht in den Einstellungen der Box.
- Die Eltern-App lässt neben dem Heimnetz auch NetBird-Adressen (100.64.0.0/10) zu. Diese Adressen werden im Internet nicht geroutet. Ist die Anmeldung der App ausgeschaltet, kommt **jedes Gerät in deinem NetBird-Netz** ohne Passwort hinein. Willst du das nicht, schalte unter Sicherheit › Passwort & Anmeldung das Login ein oder beschränke den Zugriff im NetBird-Dashboard mit Access Policies.
- **Backup:** Die NetBird-Identität (`/var/lib/netbird`, `/etc/netbird`) ist im NAS-Backup enthalten. Bei der Wiederherstellung fragt der Assistent, ob sie übernommen wird. Nur „Ja“ wählen, wenn die alte SD-Karte nicht mehr läuft, sonst gibt es zwei Geräte mit derselben Identität.

## Nicht auf Hardware getestet
Stand 0.1.0: Werkzeug und App sind nur mit einem nachgebauten `netbird` getestet (`tests/test_netbird.sh`). Den ersten echten Test macht Jakobs Box.
