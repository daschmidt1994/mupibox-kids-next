# Spotify einrichten

## Einmalig: eine Spotify-App pro Box
1. Auf <https://developer.spotify.com/dashboard> mit deinem Spotify-Konto anmelden und **Create app** wählen, für jede Box eine eigene App, z. B. „MuPiBox Jakob“ und „MuPiBox Julia“. Spotify zählt die Anfragen pro App: Teilen sich zwei Boxen eine App, sperrt eine viel fragende Box die andere mit.
2. Bei **Redirect URIs** genau diese **eine** Adresse eintragen:
   ```
   https://daschmidt1994.github.io/mupibox-kids-next/callback/
   ```
   Sie gilt für alle Boxen und jeden Weg zur Box: IP, Name oder NetBird. Weitere Einträge sind nicht nötig.
3. Bei „Which API/SDKs …“ **Web API** und **Web Playback SDK** ankreuzen.
4. Unter **User Management** das Spotify-Konto eintragen, das sich an dieser Box anmeldet. Solange die App im Entwicklungsmodus ist, lehnt Spotify andere Konten ab.

## Pro Box
In der Eltern-App unter Bibliothek › Spotify › Zugangsdaten:
1. **Client ID** und **Client Secret** der Spotify-App dieser Box eintragen.
2. Als Redirect URI ist **„Weiterleitung (empfohlen)“** gewählt (Standard bei neuen Boxen).
3. **Bei Spotify anmelden**, und zwar mit dem Konto dieser Box. Die Anmeldung gilt 6 Monate, die Box erinnert rechtzeitig.

## Wie die Weiterleitung funktioniert
- Die Box schreibt beim Start der Anmeldung ihre Adresse so, wie dein Browser sie gerade zeigt (z. B. `http://192.168.178.10`), in den `state`-Parameter.
- Spotify schickt dich nach dem Login zur festen Seite auf GitHub Pages. Die Seite liest die Adresse aus `state` und leitet sofort zur Box weiter (`/app/spotify-callback`). Dort tauscht die Box den Code gegen ihren Zugang.
- Die Seite ist rein statisch (`kidsnext/relay`, veröffentlicht im Branch `gh-pages`). Sie speichert nichts, lädt nichts nach und hat eine strenge Content-Security-Policy.
- Sie leitet ohne Rückfrage nur an Adressen aus dem Heimnetz oder NetBird weiter: private IPs, 100.64.0.0/10, Namen ohne Punkt, `.local`, `.lan`, `.fritz.box`, `.home.arpa` und NetBird-Domains. Bei jeder anderen Adresse fragt sie nach.
- Der Code allein nützt niemandem: Für den Tausch braucht es das Client Secret, und das liegt nur auf der Box. Der `state` ist einmalig, 10 Minuten gültig und an die Sitzung in der Eltern-App gebunden.

## Andere Möglichkeiten (Zugangsdaten › „Welche Adresse steht in deiner Spotify-App?“)
- **Adresse der Box:** `https://<Adresse>/app/spotify-callback`. Für jede Adresse, über die du dich anmeldest, muss ein eigener Eintrag in der Spotify-App stehen. Der Browser fragt wegen des Zertifikats der Box einmal nach.
- **/spotify.php:** nur für Boxen aus der Zeit vor der Eltern-App.

## „Spotify sperrt die Box gerade“
Fragt die Box Spotify zu oft, z. B. wenn man in der Eltern-App viele Künstler mit vielen Alben hintereinander öffnet, sperrt Spotify die App für Stunden bis zu einem Tag (HTTP 429). Die Box merkt sich die Sperre und fragt bis zum Ende nicht mehr. Jede weitere Anfrage würde die Sperre verlängern. Gespeicherte Inhalte bleiben in der Liste. Ab 0.1.0 (Commit nach ebb2ee0c) übersteht die gemerkte Sperre auch Updates, ebenso die Albumlisten der Künstler.
