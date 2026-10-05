// Übersetzt eBay-Fehlermeldungen in verständliches Deutsch.
const RULES = [
  {
    test: (m) => /item specific|aspect|artikelmerkmal/i.test(m),
    titel: 'Pflicht-Artikelmerkmale fehlen',
    text: 'eBay verlangt für diese Kategorie weitere Angaben (z. B. Marke oder Herstellernummer). Bitte ergänze sie in Schritt 3 unter "Artikelmerkmale".',
    schritt: 3,
  },
  {
    test: (m, id) => /category/i.test(m) || [25005, 25009].includes(id),
    titel: 'Kategorie nicht passend',
    text: 'Die gewählte eBay-Kategorie wurde abgelehnt. Bitte wähle in Schritt 3 eine andere (möglichst die genaueste) Kategorie.',
    schritt: 3,
  },
  {
    test: (m, id) => /merchantLocationKey|location/i.test(m) || [25702, 25804].includes(id),
    titel: 'Standort fehlt oder ist ungültig',
    text: 'Es ist kein gültiger Artikelstandort hinterlegt. Lege in Schritt 4 einen Standort an (PLZ, Ort, Land).',
    schritt: 4,
  },
  {
    test: (m) => /fulfillment ?policy|shipping|versand/i.test(m),
    titel: 'Versandrichtlinie fehlt',
    text: 'Bitte wähle in Schritt 4 eine Versandrichtlinie (oder Abholung) aus.',
    schritt: 4,
  },
  {
    test: (m) => /payment ?policy|zahlung/i.test(m),
    titel: 'Zahlungsrichtlinie fehlt',
    text: 'Bitte wähle in Schritt 4 eine Zahlungsrichtlinie aus. Falls keine angezeigt wird, lege sie in deinem eBay-Konto unter "Verkäufer-Center > Konto > Geschäftsrichtlinien" an.',
    schritt: 4,
  },
  {
    test: (m) => /return ?policy|rückgabe/i.test(m),
    titel: 'Rückgaberichtlinie fehlt',
    text: 'Bitte wähle in Schritt 4 eine Rückgaberichtlinie aus (auch Privatverkäufer brauchen bei eBay eine Auswahl).',
    schritt: 4,
  },
  {
    test: (m) => /price|preis/i.test(m),
    titel: 'Preis ungültig',
    text: 'Mit dem Preis stimmt etwas nicht (zu niedrig, zu hoch oder Startpreis höher als Sofort-Kaufen-Preis). Bitte prüfe die Preise in Schritt 4.',
    schritt: 4,
  },
  {
    test: (m) => /title|titel/i.test(m),
    titel: 'Titel ungültig',
    text: 'Der Titel wurde abgelehnt (max. 80 Zeichen, keine unzulässigen Zeichen). Bitte passe ihn in Schritt 3 an.',
    schritt: 3,
  },
  {
    test: (m) => /image|picture|bild|photo/i.test(m),
    titel: 'Problem mit den Bildern',
    text: 'eBay hat die Bilder nicht akzeptiert (mindestens 500 Pixel an der längsten Seite, JPEG/PNG). Bitte gehe zu Schritt 1 und lade andere Fotos hoch.',
    schritt: 1,
  },
  {
    test: (m) => /limit/i.test(m),
    titel: 'Verkaufslimit erreicht',
    text: 'Dein Konto hat sein aktuelles Verkaufslimit erreicht. Du kannst bei eBay eine Erhöhung beantragen.',
  },
];

export function translateEbayErrors(status, errors = []) {
  const first = errors[0] || {};
  const msg = [first.message, first.longMessage, ...(first.parameters || []).map((p) => `${p.name}=${p.value}`)].filter(Boolean).join(' ');
  const id = Number(first.errorId) || 0;

  if (status === 401 || first.errorId === 'invalid_grant' || /token/i.test(msg) && status >= 400 && status < 500 && /invalid|expired/i.test(msg)) {
    return {
      titel: 'eBay-Verbindung abgelaufen',
      text: 'Die Verbindung zu deinem eBay-Konto ist abgelaufen oder ungültig. Bitte verbinde dich unter "Einstellungen" erneut mit eBay.',
      einstellungen: true,
    };
  }
  if (status === 403) {
    return {
      titel: 'Keine Berechtigung',
      text: 'eBay verweigert den Zugriff. Prüfe, ob du dich mit den richtigen Rechten verbunden hast (Einstellungen > "Mit eBay verbinden") und ob dein Konto zum Verkaufen freigeschaltet ist.',
      einstellungen: true,
    };
  }
  if (status === 429) {
    return { titel: 'Zu viele Anfragen', text: 'eBay bremst gerade ab. Bitte warte eine Minute und versuche es erneut.' };
  }
  if (status === 0) {
    return { titel: 'Keine Verbindung zu eBay', text: first.message || 'eBay ist gerade nicht erreichbar. Prüfe deine Internetverbindung.' };
  }
  for (const r of RULES) {
    if (r.test(msg, id)) return { titel: r.titel, text: r.text, schritt: r.schritt };
  }
  if (status >= 500) {
    return { titel: 'eBay hat ein Problem', text: 'Bei eBay ist ein technischer Fehler aufgetreten. Bitte versuche es in ein paar Minuten erneut.' };
  }
  return {
    titel: 'eBay hat die Anfrage abgelehnt',
    text: msg ? `eBay meldet: ${msg}` : 'eBay hat die Anfrage abgelehnt, ohne einen Grund zu nennen.',
  };
}
