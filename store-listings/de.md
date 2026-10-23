CookieDesk ist ein Cookie-Editor für Entwickler, Tester und alle, die sehen möchten, was eine Website speichert. Cookies anzeigen, Cookies bearbeiten, Cookies hinzufügen und löschen und durchsuchen, in einem Popup oder in der Seitenleiste. Sie entscheiden.

DAS UNTERSCHEIDET COOKIEDESK

• Editor für partitionierte Cookies. Chrome verbirgt partitionierte (CHIPS) Cookies vor Tools, die nicht danach fragen, daher zeigen andere Cookie-Editoren stillschweigend eine unvollständige Liste. CookieDesk listet sie neben normalen Cookies auf, jeweils mit Angabe der Partition.
• Rückgängig bei jeder Änderung. Bearbeitungen, Löschungen, Importe und Set-Wiederherstellungen werden zuerst in ein Rückgängig-Journal geschrieben und danach geprüft. Lehnt Chrome eine Änderung ab, wird alles zurückgesetzt und Sie erfahren, warum. Ein Klick stellt ein Cookie 10 Minuten lang exakt so wieder her, wie es war; kann in seltenen Fällen keine Kopie für Rückgängig gespeichert werden, fragt CookieDesk nach, bevor es weitermacht.
• Cookie-Editor ohne Werbung, ohne Tracking und ohne Netzwerkanfragen. Open Source, Sie können jede Zeile prüfen.
• Berechtigung pro Website. Bei der Installation erscheint keine Abfrage „Alle Ihre Daten auf allen Websites lesen und ändern“. Sie erlauben CookieDesk Website für Website, sehen jede erlaubte Website und entfernen jede mit einem Klick.

COOKIES ANZEIGEN

• Ein Cookie-Viewer für jedes Cookie der aktuellen Website: Name, Wert, Domain, Pfad und Ablauf, mit Kennzeichen für HttpOnly, Secure, SameSite, Sitzungs-Cookies und partitionierte Cookies.
• HttpOnly-Cookies sind deutlich als „für JavaScript der Seite nicht sichtbar“ markiert.
• Echte Suche: nach Name, Wert oder Domain filtern, während Sie tippen, auch bei hundert Cookies.
• Live-Ansicht: sehen, welche Cookies die Website während der Nutzung setzt oder ändert.
• „Was dieses Cookie macht“: jedes Flag in einfachen Worten erklärt, auch ob der Wert ein JSON Web Token ist und wann dieses Token abläuft.

COOKIES BEARBEITEN

• HttpOnly-Cookies und jedes andere Feld bearbeiten: Name, Wert, Domain, Pfad, Ablauf, Secure, HttpOnly, SameSite und Partition.
• Fehler werden abgefangen, bevor Chrome sie sieht. SameSite=None ohne Secure, ein __Host--Cookie auf einer Subdomain, ein Ablaufdatum in der Vergangenheit: Die Regel wird direkt am Feld erklärt.
• Lange Werte wie JWTs sprengen nie das Layout; jeden Wert mit einer Taste kopieren.
• Wichtige Cookies schützen, damit Massenlöschen, Import und Set-Wiederherstellung sie unangetastet lassen.

COOKIES LÖSCHEN

• Ein einzelnes Cookie löschen oder alle, die die Suche anzeigt, nach einer Liste dessen, was genau entfernt wird. 10 Minuten lang rückgängig machbar.

EIN COOKIE-MANAGER FÜR ECHTE ARBEITSABLÄUFE

• Cookie-Sets: die Cookies einer Website als benannte Datei speichern (zum Beispiel „als Admin angemeldet“) und später wiederherstellen. CookieDesk zeigt, was sich ändert, bevor es etwas tut, und behält selbst keine Kopie.
• Vergleichen: sehen, was die Anmeldung bewirkt hat (welche Cookies hinzugekommen, entfernt oder geändert wurden), zwischen einem gespeicherten Set und jetzt oder zwischen zwei Sets.
• Cookies zwischen normalem und Inkognito-Fenster kopieren (nachdem Sie „In Inkognito zulassen“ für CookieDesk aktiviert haben).
• JSON oder Netscape cookies.txt importieren und exportieren oder Cookies als document.cookie-Snippet kopieren. Exporte warnen, dass die Datei aktive Sitzungs-Cookies enthält und wie ein Passwort behandelt werden sollte.
• Tastatur zuerst: / zum Suchen, Pfeiltasten zum Navigieren, Enter zum Bearbeiten, c zum Kopieren, p zum Schützen, Del zum Löschen, Ctrl+Z zum Rückgängigmachen, ? für die vollständige Liste.

DATENSCHUTZ

CookieDesk sammelt nichts und sendet nichts irgendwohin. Keine Analysen, keine Konten, keine Synchronisierung, kein Remote-Code. CookieDesk speichert selbst keine Cookie-Werte auf der Festplatte: Kopien für Rückgängig liegen im Arbeitsspeicher und sind weg, wenn Chrome schließt. (Cookies, die Sie in Ihren normalen Speicher kopieren, werden wie jedes Cookie dort von Chrome gespeichert.) Einstellungen und Nutzungszähler werden lokal gespeichert. Der Quellcode ist öffentlich unter der MIT-Lizenz.

In 51 Sprachen verfügbar.

Erfordert Chrome 119 oder neuer.

Nicht verbunden mit Cookie-Editor oder EditThisCookie.
