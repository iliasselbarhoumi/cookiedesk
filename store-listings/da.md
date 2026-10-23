CookieDesk er en cookie-editor til udviklere, testere og alle, der vil se, hvad et websted gemmer. Se cookies, rediger cookies, tilføj og slet cookies, og søg i dem, i en popup eller et sidepanel. Du vælger selv.

DET ADSKILLER DEN FRA ANDRE

• Editor til partitionerede cookies. Chrome skjuler partitionerede (CHIPS) cookies for værktøjer, der ikke beder om dem, så andre cookie-editorer viser i det skjulte en ufuldstændig liste. CookieDesk viser dem ved siden af almindelige cookies, hver især mærket med sin partition.
• Fortryd ved hver ændring. Redigeringer, sletninger, importer og gendannelser af sæt skrives først til en fortrydjournal og kontrolleres bagefter. Hvis Chrome afviser en ændring, rulles alt tilbage, og du får at vide hvorfor. Ét klik sætter en cookie tilbage præcis som før, i 10 minutter; i det sjældne tilfælde, hvor en fortrydkopi ikke kan gemmes, spørger CookieDesk, før den går videre.
• Cookie-editor uden reklamer, uden sporing og uden netværksanmodninger. Open source, så du kan tjekke hver eneste linje.
• Tilladelse pr. websted. Ved installationen vises ingen besked om at “læse og ændre dine data på alle websteder”. Du tillader CookieDesk ét websted ad gangen, kan se alle websteder, du har tilladt, og fjerne dem med ét klik.

SE COOKIES

• En cookie-viser til alle cookies på det aktuelle websted: navn, værdi, domæne, sti og udløbstid, med mærker for HttpOnly, Secure, SameSite, sessionscookies og partitionerede cookies.
• HttpOnly-cookies er tydeligt markeret som “kan ikke ses af sidens JavaScript”.
• Rigtig søgning: filtrér efter navn, værdi eller domæne, mens du skriver, også med hundrede cookies.
• Live-visning: se, hvilke cookies webstedet sætter eller ændrer, mens du bruger det.
• “Hvad denne cookie gør”: hvert flag forklaret i almindelige ord, også om værdien er et JSON Web Token, og hvornår det token udløber.

REDIGER COOKIES

• Rediger HttpOnly-cookies og alle andre felter: navn, værdi, domæne, sti, udløbstid, Secure, HttpOnly, SameSite og partition.
• Fejl fanges, før Chrome ser dem. SameSite=None uden Secure, en __Host--cookie på et underdomæne, en udløbstid i fortiden: reglen forklares ved siden af feltet.
• Lange værdier som JWT'er ødelægger aldrig layoutet; kopiér en hvilken som helst værdi med én tast.
• Beskyt vigtige cookies, så masseletning, import og gendannelse af sæt lader dem være.

SLET COOKIES

• Slet én cookie, eller alle cookies, som søgningen viser, efter en liste over præcis, hvad der forsvinder. Kan fortrydes i 10 minutter.

EN COOKIE-MANAGER TIL RIGTIGE ARBEJDSGANGE

• Cookiesæt: gem et websteds cookies som en navngivet fil (for eksempel “logget ind som admin”), og gendan den senere. CookieDesk viser, hvad der ændres, før den gør noget, og beholder ikke selv nogen kopi.
• Sammenlign: se, hvad login gjorde (hvilke cookies der blev tilføjet, fjernet eller ændret) mellem et gemt sæt og nu, eller mellem to sæt.
• Kopiér cookies mellem dine almindelige vinduer og inkognitovinduer (efter at du har slået “Tillad i inkognito” til for CookieDesk).
• Importér og eksportér JSON eller Netscape cookies.txt, eller kopiér cookies som en document.cookie-kodestump. Eksporter advarer dig om, at filen indeholder aktive sessionscookies og bør behandles som en adgangskode.
• Tastaturet først: / for at søge, piletaster for at flytte, Enter for at redigere, c for at kopiere, p for at beskytte, Del for at slette, Ctrl+Z for at fortryde, ? for hele listen.

PRIVATLIV

CookieDesk indsamler intet og sender intet nogen steder hen. Ingen analyse, ingen konti, ingen synkronisering, ingen fjernkode. CookieDesk gemmer ikke selv cookieværdier på disken: fortrydkopier ligger i hukommelsen og forsvinder, når Chrome lukkes. (Cookies, du kopierer til dit almindelige lager, gemmes af Chrome som alle andre cookies dér.) Indstillinger og brugstællere gemmes lokalt. Kildekoden er offentlig under MIT-licensen.

Findes på 51 sprog.

Kræver Chrome 119 eller nyere.

Ikke tilknyttet Cookie-Editor eller EditThisCookie.
