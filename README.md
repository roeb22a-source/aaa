# eBay-Verkaufshelfer

Ein Verkaufstool "für Dummies": Du machst Fotos, die App verbessert sie, schreibt mit Hilfe von Claude (KI) Titel und Beschreibung, schlägt einen Preis vor und stellt den Artikel über die offiziellen eBay-Schnittstellen ein. Die komplette Oberfläche ist auf Deutsch und am Handy bedienbar.

## Was die App kann

1. **Fotos**: 1 bis 6 Bilder per Handykamera, Galerie oder Drag & Drop; Reihenfolge ändern, entfernen (erstes Bild = Hauptbild).
2. **Bilder verbessern**: automatische Drehung (EXIF), Helligkeit/Kontrast, leichte Sättigung, Schärfen, max. 1600 px. Der Hintergrund wird unscharf (Freistellung mit `@imgly/background-removal-node`; Fallback: Fokus-Unschärfe in der Bildmitte). Vorher/Nachher, Wahl pro Bild, Regler für die Unschärfe.
3. **Artikel erkennen & Text**: Claude (Vision) erstellt Titel (max. 80 Zeichen), Beschreibung, Zustand, Artikelmerkmale und Preisvorschlag. Dazu kommen Vergleichspreise (eBay Browse API) und Kategorie-Vorschläge (Taxonomy API). Alles ist editierbar, "Neu formulieren" möglich.
4. **Verkaufsart**: Festpreis, Auktion oder Auktion + Sofort-Kaufen, Preisvorschlag (Best Offer) mit optionalen Grenzen, Dauer, Menge, Versand-/Zahlungs-/Rückgaberichtlinien aus deinem Konto, Standort.
5. **Vorschau & Einstellen**: Bilder zu eBay hochladen (Commerce Media API), Inventory Item, Offer, Veröffentlichen. Fehler werden auf Deutsch erklärt.

**Demo-Modus:** Ohne Schlüssel ist die App komplett durchklickbar (Bildbearbeitung echt, Text als Beispiel, Einstellen simuliert). Das wird oben deutlich angezeigt.

## Einfachste Variante: nur index.html

Du brauchst weder Node.js noch eine Installation: Die Datei **`index.html`** im Projektordner enthält die komplette App (Oberfläche, Bildbearbeitung, KI-Anbindung).

1. Die Datei `index.html` herunterladen (oder aus dem Projektordner kopieren).
2. Doppelklick: Sie öffnet sich im Browser (Chrome, Edge, Firefox, Safari; am Handy die Datei im Browser öffnen).
3. Oben auf **Einstellungen** tippen, den [Anthropic-Schlüssel](https://console.anthropic.com/) eintragen und speichern. Er bleibt nur auf diesem Gerät (localStorage) und geht direkt vom Browser an Anthropic. Ohne Schlüssel läuft der Demo-Modus mit Beispieltext.
4. Den 5 Schritten folgen. Die Bilder werden komplett im Browser verbessert (Auto-Kontrast, Schärfen, unscharfer Hintergrund). Die Freistellung des Objekts lädt dafür beim ersten Mal ein Modell aus dem Internet (ca. 45 MB, [@imgly/background-removal](https://github.com/imgly/background-removal-js)); klappt das nicht (offline, gesperrt), nutzt die App automatisch eine Fokus-Unschärfe (Mitte scharf, Rand unscharf). Der Text kommt von Claude mit Websuche nach Vergleichsangeboten.
5. Am Ende gibt es Knöpfe zum Kopieren von Titel und Beschreibung, zum Herunterladen der Bilder (einzeln oder als ZIP) und zur eBay-Verkaufsseite, dazu eine Schritt-für-Schritt-Anleitung und eine Zusammenfassung aller Angaben.

**Unterschied zum Server-Modus:** Die Einzeldatei kann den Artikel nicht selbst bei eBay einstellen, weil eBay Zugriffe direkt aus dem Browser blockiert (CORS) und die eBay-Anmeldung ein Geheimnis (Cert ID) braucht. Das Einstellen machst du dort selbst mit der Anleitung. Mit dem Server (siehe unten) geht es per Knopf: Öffnest du `index.html` über den laufenden Server (`http://localhost:3000/einfach`) und ist dort dein eBay-Konto verbunden, erscheint in Schritt 5 zusätzlich **"Direkt bei eBay einstellen"**. Die Seite erkennt den Server automatisch (`GET /api/status`); die verbesserten Bilder werden dann zum Server hochgeladen.

Hinweis: Wird die Datei per Doppelklick geöffnet (`file://`), sperren manche Browser das Laden des Freistellungs-Moduls; dann greift die Fokus-Unschärfe. Über `http://localhost:3000/einfach` klappt die Freistellung am zuverlässigsten.

## Installation

1. [Node.js](https://nodejs.org/) (Version 20 oder neuer, empfohlen 22) installieren.
2. In den Projektordner wechseln und ausführen:
   ```
   npm install
   npm start
   ```
3. Im Browser `http://localhost:3000` öffnen. Am Handy im selben WLAN: `http://<IP-des-Rechners>:3000`.

Die Modelldateien für die Freistellung liegen bereits im npm-Paket (kein Download nötig); das erste Bild dauert nur einige Sekunden länger, weil das Modell geladen wird.

Konfiguration optional über `.env` (Vorlage: `.env.example`). Werte aus `.env` haben Vorrang vor den Einstellungen in der App (`data/config.json`).

## eBay-Zugang einrichten (einmalig)

1. Kostenloses Konto im [eBay Developer Portal](https://developer.ebay.com/) anlegen.
2. Unter [Application Keys](https://developer.ebay.com/my/keys) ein Schlüsselpaar erzeugen (zuerst **Sandbox**): **App ID (Client ID)** und **Cert ID (Client Secret)**.
3. In der Zeile "User Tokens" auf "Get a Token from eBay via Your Application" klicken und eine **Redirect-URL (RuName)** anlegen. Als "Auth Accepted URL" trägst du `http://localhost:3000/auth/ebay/callback` ein. Falls eBay dafür https verlangt, nutze einen Tunnel (z. B. ngrok oder Cloudflare Tunnel) und setze `PUBLIC_URL` in der `.env`. Es geht auch ohne: Nach dem Login kopierst du die Adresse aus dem Browser und fügst sie in den Einstellungen unter "Code von Hand einfügen" ein.
4. In der App unter **Einstellungen** App ID, Cert ID, RuName und Umgebung eintragen, speichern, dann **Mit eBay verbinden**.
5. Bei eBay (Verkäufer-Center, Konto, Geschäftsrichtlinien) die **Geschäftsrichtlinien** aktivieren und je eine Versand-, Zahlungs- und Rückgaberichtlinie anlegen. Die App kann die Aktivierung in Schritt 4 auch auslösen.

Verwendete Berechtigungen (Scopes): `https://api.ebay.com/oauth/api_scope`, `.../sell.inventory`, `.../sell.account`, `.../sell.fulfillment`.

**Sandbox vs. Produktion:** Die Sandbox ist eine Testumgebung ohne echte Angebote (eigene Testnutzer nötig, Browse-Ergebnisse sind dort oft leer). Wechsle erst auf **Produktion**, wenn alles funktioniert; dafür brauchst du die Production-Schlüssel und einen eigenen RuName. Achtung: In Produktion wird wirklich veröffentlicht (Gebühren möglich).

## Anthropic-Key (KI)

Key unter <https://console.anthropic.com/settings/keys> erstellen und in den Einstellungen oder als `ANTHROPIC_API_KEY` in der `.env` eintragen. Standardmodell: `claude-sonnet-5-5`, änderbar mit `CLAUDE_MODEL`. Mit `CLAUDE_FALLBACK=off` wird der serverseitige Ersatzmodell-Mechanismus abgeschaltet.

## Struktur

```
src/server.js      Express-Server, Routen
src/config.js      Konfiguration (.env vor data/config.json); Schlüssel verlassen nie das Backend
src/images.js      Bildverbesserung + Freistellung + Fallback
src/ai.js          Claude-Aufruf (Vision, strukturierte JSON-Ausgabe), Demo-Text
src/ebay/          auth, browse, inventory, account, media, http, errors (Fehlerübersetzung)
public/            index.html, app.js, styles.css (kein Build)
test/              node --test
data/              Laufzeitdaten (gitignored): config.json, uploads/
```

Tests: `npm test` (Preisstatistik, Titelkürzung, Offer-Mapping, Bildverbesserung inkl. Fallback).

## Fehlerbehebung

- **"Keine Verbindung" im Browser:** Läuft `npm start` noch?
- **Foto wird nicht angenommen:** Nur JPG, PNG, WebP. iPhone: Einstellungen, Kamera, Formate, "Maximale Kompatibilität" (statt HEIC).
- **Hinweis "Fokus-Unschärfe":** Die Freistellung ist fehlgeschlagen (z. B. wenig Speicher); es wird automatisch die Bildmitte scharf gelassen.
- **eBay-Verbindung abgelaufen:** Einstellungen, erneut "Mit eBay verbinden".
- **Keine Richtlinien sichtbar:** Geschäftsrichtlinien bei eBay aktivieren und anlegen, in Schritt 4 "Richtlinien neu laden".
- **"Pflicht-Artikelmerkmale fehlen":** In Schritt 3 Merkmale ergänzen (z. B. Marke, Herstellernummer) und erneut einstellen.
- **KI-Fehler "Schlüssel ungültig" / "Guthaben aufgebraucht":** Key bzw. Guthaben in der Anthropic Console prüfen.
- Alte Uploads werden nach `CLEANUP_HOURS` (Standard 48 h) automatisch gelöscht.

## Hinweise

Prüfe Texte und Preise vor dem Einstellen. Die eBay- und Claude-Aufrufe sind nach der öffentlichen Dokumentation umgesetzt, aber ohne echte Zugangsdaten nicht live getestet.
