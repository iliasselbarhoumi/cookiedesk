CookieDesk är en cookie-redigerare för utvecklare, testare och alla som vill se vad en webbplats lagrar. Visa cookies, redigera cookies, lägg till och ta bort cookies och sök bland dem, i en popup eller en sidopanel. Du väljer själv.

DET HÄR SKILJER DEN FRÅN ANDRA

• Redigerare för partitionerade cookies. Chrome döljer partitionerade (CHIPS) cookies för verktyg som inte ber om dem, så andra cookie-redigerare visar tyst en ofullständig lista. CookieDesk visar dem bredvid vanliga cookies, var och en märkt med sin partition.
• Ångra för varje ändring. Redigeringar, borttagningar, importer och återställningar av uppsättningar skrivs först till en ångrajournal och kontrolleras efteråt. Om Chrome vägrar en ändring rullas allt tillbaka och du får veta varför. Ett klick sätter tillbaka en cookie exakt som den var, i 10 minuter; i det sällsynta fall då en ångrakopia inte kan sparas frågar CookieDesk innan det går vidare.
• Cookie-redigerare utan annonser, utan spårning och utan nätverksförfrågningar. Öppen källkod, så du kan kontrollera varje rad.
• Behörighet per webbplats. Vid installationen visas ingen fråga om att ”läsa och ändra dina data på alla webbplatser”. Du tillåter CookieDesk en webbplats i taget, ser alla webbplatser du har tillåtit och tar bort valfri med ett klick.

VISA COOKIES

• En cookie-visare för alla cookies på den aktuella webbplatsen: namn, värde, domän, sökväg och utgångstid, med märken för HttpOnly, Secure, SameSite, sessionscookies och partitionerade cookies.
• HttpOnly-cookies markeras tydligt som ”syns inte för sidans JavaScript”.
• Riktig sökning: filtrera efter namn, värde eller domän medan du skriver, även med hundra cookies.
• Live-vy: se vilka cookies webbplatsen sätter eller ändrar medan du använder den.
• ”Vad den här cookien gör”: varje flagga förklaras med enkla ord, också om värdet är en JSON Web Token och när den token går ut.

REDIGERA COOKIES

• Redigera HttpOnly-cookies och alla andra fält: namn, värde, domän, sökväg, utgångstid, Secure, HttpOnly, SameSite och partition.
• Misstag fångas innan Chrome ser dem. SameSite=None utan Secure, en __Host--cookie på en underdomän, en utgångstid i det förflutna: regeln förklaras bredvid fältet.
• Långa värden som JWT-token förstör aldrig layouten; kopiera valfritt värde med en tangent.
• Skydda viktiga cookies så att massborttagning, import och återställning av uppsättningar lämnar dem ifred.

TA BORT COOKIES

• Ta bort en cookie, eller alla cookies som sökningen visar, efter en lista över exakt vad som försvinner. Kan ångras i 10 minuter.

EN COOKIEHANTERARE FÖR RIKTIGA ARBETSFLÖDEN

• Cookieuppsättningar: spara en webbplats cookies som en namngiven fil (till exempel ”inloggad som admin”) och återställ den senare. CookieDesk visar vad som ändras innan något görs, och behåller ingen kopia själv.
• Jämför: se vad inloggningen gjorde (vilka cookies som lades till, togs bort eller ändrades) mellan en sparad uppsättning och nuläget, eller mellan två uppsättningar.
• Kopiera cookies mellan dina vanliga fönster och inkognitofönster (efter att du har slagit på ”Tillåt i inkognito” för CookieDesk).
• Importera och exportera JSON eller Netscape cookies.txt, eller kopiera cookies som en document.cookie-kodsnutt. Exporter varnar dig för att filen innehåller aktiva sessionscookies och ska behandlas som ett lösenord.
• Tangentbordet först: / för att söka, piltangenter för att flytta, Enter för att redigera, c för att kopiera, p för att skydda, Del för att ta bort, Ctrl+Z för att ångra, ? för hela listan.

INTEGRITET

CookieDesk samlar inte in något och skickar inget någonstans. Ingen analys, inga konton, ingen synkning, ingen fjärrkod. CookieDesk behåller inga cookievärden på disk själv: ångrakopior finns i minnet och försvinner när Chrome stängs. (Cookies du kopierar till din vanliga lagring sparas av Chrome, som alla cookies där.) Inställningar och användningsräknare lagras lokalt. Källkoden är offentlig under MIT-licensen.

Finns på 51 språk.

Kräver Chrome 119 eller senare.

Inte knuten till Cookie-Editor eller EditThisCookie.
