CookieDesk je uređivač kolačića (cookie editor) za programere, testere i sve koji žele vidjeti što web-lokacija sprema u pregledniku. Pregledajte kolačiće, mijenjajte ih, dodajte i brišite kolačiće i pretražujte ih u skočnom prozoru ili u bočnoj ploči. Vi birate.

ŠTO GA RAZLIKUJE

• Uređivač podijeljenih (partitioned) kolačića. Chrome skriva podijeljene kolačiće (CHIPS) od alata koji ih ne traže, pa drugi uređivači kolačića šutke prikazuju nepotpun popis. CookieDesk ih prikazuje uz obične, a svaki ima naznačenu podjelu.
• Poništavanje svake promjene. Izmjene, brisanja, uvozi i vraćanja skupova prvo se zapisuju u dnevnik poništavanja, a zatim provjeravaju. Ako Chrome odbije promjenu, sve se vraća i kaže vam se zašto. Jedan klik vraća kolačić točno onakav kakav je bio, tijekom 10 minuta; u rijetkom slučaju kad se kopija za poništavanje ne može spremiti, CookieDesk pita prije nego nastavi.
• Uređivač kolačića bez oglasa, bez praćenja i bez mrežnih zahtjeva. Otvorenog je koda, pa možete provjeriti svaki redak.
• Dopuštenje po web-lokaciji. Instalacija ne prikazuje upit „čitanje i promjena svih vaših podataka na svim web-lokacijama“. CookieDesku dopuštate jednu po jednu web-lokaciju, vidite svaku dopuštenu web-lokaciju i uklanjate bilo koju jednim klikom.

PREGLED KOLAČIĆA

• Prikaz kolačića (cookie viewer) za svaki kolačić trenutačne web-lokacije: naziv, vrijednost, domena, putanja i rok valjanosti, s oznakama za HttpOnly, Secure, SameSite, sesijske i podijeljene kolačiće.
• HttpOnly kolačići jasno su označeni kao „nije vidljiv JavaScriptu na stranici“.
• Prava pretraga: filtrirajte po nazivu, vrijednosti ili domeni dok tipkate, čak i sa stotinama kolačića.
• Prikaz uživo: vidite koje kolačiće web-lokacija postavlja ili mijenja dok je koristite.
• „Što ovaj kolačić radi“: svaka je oznaka objašnjena običnim riječima, uključujući i to je li vrijednost JSON Web Token i kada taj token istječe.

IZMJENA KOLAČIĆA

• Mijenjajte HttpOnly kolačiće i svako drugo polje: naziv, vrijednost, domenu, putanju, rok valjanosti, Secure, HttpOnly, SameSite i podjelu.
• Pogreške se hvataju prije nego ih Chrome vidi. SameSite=None bez Secure, __Host- kolačić na poddomeni, rok valjanosti u prošlosti: pravilo je objašnjeno uz polje.
• Duge vrijednosti poput JWT-ova nikad ne kvare raspored; bilo koju vrijednost kopirate jednom tipkom.
• Zaštitite važne kolačiće da ih skupno brisanje, uvoz i vraćanje skupa zaobilaze.

BRISANJE KOLAČIĆA

• Izbrišite jedan kolačić ili svaki koji pretraga prikazuje, nakon popisa onoga što će točno nestati. Može se poništiti 10 minuta.

UPRAVITELJ KOLAČIĆA ZA STVARAN RAD

• Skupovi kolačića: spremite kolačiće web-lokacije kao imenovanu datoteku (na primjer „prijavljen kao administrator“) i vratite ih kasnije. CookieDesk pokazuje što će se promijeniti prije nego išta učini i sam ne čuva kopiju.
• Usporedba: pogledajte što je prijava promijenila (koji su kolačići dodani, uklonjeni ili izmijenjeni) između spremljenog skupa i trenutačnog stanja ili između dva skupa.
• Kopirajte kolačiće između običnog i anonimnog prozora (nakon što za CookieDesk uključite „Dopusti u anonimnom načinu“).
• Uvoz i izvoz JSON-a ili Netscape cookies.txt, ili kopiranje kolačića kao isječka document.cookie. Izvozi vas upozoravaju da datoteka sadrži važeće sesijske kolačiće i da je treba čuvati kao zaporku.
• Upravljanje tipkovnicom: / za pretragu, strelice za kretanje, Enter za izmjenu, c za kopiranje, p za zaštitu, Del za brisanje, Ctrl+Z za poništavanje, ? za cijeli popis.

PRIVATNOST

CookieDesk ništa ne prikuplja i ništa nikamo ne šalje. Bez analitike, računa, sinkronizacije i udaljenog koda. CookieDesk ne sprema vrijednosti kolačića na disk: kopije za poništavanje su u memoriji i nestaju kad se Chrome zatvori. (Kolačiće koje kopirate u običnu pohranu, kao i svaki drugi kolačić tamo, sprema Chrome.) Postavke i brojači korištenja spremaju se lokalno. Izvorni kod je javan pod MIT licencijom.

Dostupno na 51 jeziku.

Potreban je Chrome 119 ili noviji.

Nije povezano s Cookie-Editor ili EditThisCookie.
