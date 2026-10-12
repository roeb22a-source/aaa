---
name: skills-agenten
description: Zeigt auf Deutsch alle verfügbaren Skills und Agenten dieses Projekts und schlägt vor, welcher für die aktuelle Aufgabe passt. Nutzen, wenn der Nutzer /skills-agenten eingibt oder fragt, welche Skills/Agenten es gibt.
---

# Skills & Agenten (Übersicht auf Deutsch)

Antworte immer auf Deutsch.

1. Liste die in der aktuellen Sitzung verfügbaren Skills (Slash-Befehle) mit je einem kurzen Satz, wofür sie gut sind. Gruppiere nach: Code, App starten/testen, Dokumente/Dateien, Recherche, Automatisierung.
2. Liste die verfügbaren Agenten, inklusive der Projekt-Agenten aus `.claude/agents/`:
   - `bauer`: setzt Programmieraufgaben um (günstiges Modell Sonnet).
   - `pruefer`: führt Tests aus und prüft Änderungen (günstiges Modell Haiku).
3. Wenn der Nutzer eine Aufgabe genannt hat (Argumente nach dem Befehl), empfiehl den passenden Skill oder Agenten und biete an, ihn sofort zu starten.

Regel des Nutzers: Für Erstellung schwache/günstige Modelle verwenden (Agenten `bauer`/`pruefer`); das stärkste Modell nur einsetzen, wenn es wirklich nötig ist (Architektur, schwierige Fehler, Endkontrolle).
