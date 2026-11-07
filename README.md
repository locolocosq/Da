# Blobbo 🟣

Ein Physik-Merge-Spiel fürs Handy: Schieß weiche Zahlen-Blobs in den Kasten.
Zwei Blobs mit gleicher Zahl, die sich berühren, verschmelzen zur doppelten Zahl (2+2=4, 4+4=8 … bis 16384).
Bleibt ein Blob 5 Sekunden über der roten Linie → Game Over.

- Echte Soft-Body-Physik (Massepunkte, Druck/Volumenerhalt, Hautspannung): Blobs quetschen sich wie Zellen aneinander
- 14 Stufen (2 bis 16384), Warteschlange der nächsten Blobs, Kasten mit Bumpern
- Combo-System für schnelle Merges
- 3 Joker: 🎯 Sniper (eine Kugel entfernen, ihre Punkte werden abgezogen), ↩️ Zurück (letzten Wurf rückgängig), 📳 Schütteln (rüttelt alles durch, Timer pausiert). Alle 50.000 Punkte gibt es jeden Joker einmal dazu.
- 5 Sekunden über der roten Linie = Game Over
- Synthetisierte Sounds + Hintergrundmusik (WebAudio, keine Dateien), Vibration
- Username + Rangliste (lokal und optional weltweit)
- Läuft komplett statisch – kein Build nötig

## Spielen über GitHub Pages

1. Im Repo auf **Settings → Pages** gehen.
2. Bei **Source** „**GitHub Actions**“ wählen.
3. Code auf `main` pushen/mergen (oder unter **Actions → Deploy to GitHub Pages → Run workflow** starten).
4. Das Spiel läuft dann unter `https://<dein-github-name>.github.io/<repo-name>/`.

Tipp: Auf dem Handy im Browser „Zum Startbildschirm hinzufügen“ → startet im Vollbild wie eine App.

## Weltweite Rangliste einrichten (kostenlos, ~5 Minuten)

Ohne Einrichtung gibt es nur die Rangliste pro Gerät. Für eine gemeinsame Rangliste:

1. Auf <https://console.firebase.google.com> ein Projekt anlegen.
2. **Build → Realtime Database → Datenbank erstellen** (Standort egal, im „gesperrten Modus“ starten).
3. Unter **Regeln** folgendes einfügen und veröffentlichen:

```json
{
  "rules": {
    "scores": {
      ".read": true,
      ".indexOn": ["score"],
      "$id": {
        ".write": "!data.exists()",
        ".validate": "newData.hasChildren(['name','score','ts']) && newData.child('name').isString() && newData.child('name').val().length > 0 && newData.child('name').val().length <= 16 && newData.child('score').isNumber() && newData.child('score').val() >= 0 && newData.child('score').val() < 10000000"
      }
    }
  }
}
```

4. Die Datenbank-URL (z.B. `https://blobbo-123-default-rtdb.europe-west1.firebasedatabase.app`) in `config.js` bei `firebaseUrl` eintragen und pushen.

Hinweis: Da das Spiel komplett im Browser läuft, kann jemand mit Technikwissen theoretisch falsche Punktzahlen einschicken. Für ein Spiel unter Freunden reicht das völlig.

## Lokal testen

Einfach `index.html` im Browser öffnen, oder `python3 -m http.server` und `http://localhost:8000` aufrufen.
