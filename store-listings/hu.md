A CookieDesk sütiszerkesztő fejlesztőknek, tesztelőknek és mindenkinek, aki látni szeretné, mit tárol egy weboldal. Sütik megtekintése, szerkesztése, hozzáadása, törlése és keresése felugró ablakban vagy oldalsávban. Ön választja ki.

MITŐL MÁS

• Particionált sütiszerkesztő. A Chrome elrejti a particionált (CHIPS) sütiket az olyan eszközök elől, amelyek nem kérik őket, így a többi sütiszerkesztő csendben hiányos listát mutat. A CookieDesk a normál sütik mellett listázza őket, mindegyiket a partíciójával megjelölve.
• Visszavonás minden módosításnál. A szerkesztések, törlések, importok és készlet-visszaállítások először egy visszavonási naplóba kerülnek, majd ellenőrzésre. Ha a Chrome elutasít egy módosítást, minden visszagördül, és megtudja, miért. Egy kattintással 10 percig pontosan úgy állítható vissza a süti, ahogy volt; abban a ritka esetben, ha nem lehet visszavonási másolatot tartani, a CookieDesk megkérdezi, mielőtt folytatná.
• Sütiszerkesztő reklám, követés és hálózati kérések nélkül. Nyílt forráskódú, így minden sort ellenőrizhet.
• Webhelyenkénti engedély. A telepítés nem mutatja az „Az összes webhelyen lévő összes adat olvasása és módosítása” kérést. A CookieDesket egyenként engedélyezi webhelyenként, látja az összes engedélyezett webhelyet, és bármelyiket egy kattintással eltávolíthatja.

SÜTIK MEGTEKINTÉSE

• Sütimegjelenítő az aktuális webhely összes sütijéhez: név, érték, domain, útvonal és lejárat, HttpOnly, Secure, SameSite, munkamenet- és particionált jelvényekkel.
• A HttpOnly sütik egyértelműen jelölve vannak: „az oldal JavaScriptje nem látja”.
• Valódi keresés: szűrés név, érték vagy domain szerint gépelés közben, száz süti esetén is.
• Élő nézet: látja, mely sütiket állítja be vagy módosítja a webhely használat közben.
• „Mit csinál ez a süti”: minden jelző érthetően elmagyarázva, azt is, hogy az érték JSON Web Token-e, és mikor jár le ez a token.

SÜTIK SZERKESZTÉSE

• HttpOnly sütik és minden más mező szerkesztése: név, érték, domain, útvonal, lejárat, Secure, HttpOnly, SameSite és partíció.
• A hibákat még azelőtt elkapja, hogy a Chrome látná. SameSite=None Secure nélkül, __Host- süti aldomainen, múltbeli lejárat: a szabály a mező mellett van elmagyarázva.
• A hosszú értékek, például a JWT-k sosem törik szét az elrendezést; bármelyik érték egyetlen billentyűvel másolható.
• Védje meg a fontos sütiket, hogy a tömeges törlés, az import és a készlet-visszaállítás ne érintse őket.

SÜTIK TÖRLÉSE

• Egy süti vagy a keresés által mutatott összes süti törlése, miután megkapta a pontos listát arról, mi fog eltűnni. 10 percig visszavonható.

SÜTIKEZELŐ VALÓDI MUNKAFOLYAMATOKHOZ

• Sütikészletek: mentse egy webhely sütijeit névvel ellátott fájlba (például „bejelentkezve adminként”), és állítsa vissza később. A CookieDesk minden művelet előtt megmutatja, mi fog változni, és maga nem tart meg másolatot.
• Összehasonlítás: nézze meg, mit változtatott a bejelentkezés (mely sütik kerültek hozzá, tűntek el vagy módosultak) egy mentett készlet és a jelenlegi állapot, vagy két készlet között.
• Sütik másolása a normál és az inkognitóablak között (miután a CookieDesknél bekapcsolta az „Engedélyezés inkognitó módban” beállítást).
• JSON vagy Netscape cookies.txt importálása és exportálása, vagy a sütik másolása document.cookie kódrészletként. Az exportok figyelmeztetnek, hogy a fájl élő munkamenet-sütiket tartalmaz, és jelszóként kell kezelni.
• Billentyűzet-központú használat: / a kereséshez, nyilak a mozgáshoz, Enter a szerkesztéshez, c a másoláshoz, p a védelemhez, Del a törléshez, Ctrl+Z a visszavonáshoz, ? a teljes listához.

ADATVÉDELEM

A CookieDesk nem gyűjt semmit, és sehová nem küld semmit. Nincs analitika, nincsenek fiókok, nincs szinkronizálás, nincs távoli kód. A CookieDesk nem tárol süti-értékeket a lemezen: a visszavonási másolatok a memóriában vannak, és a Chrome bezárásakor megszűnnek. (A normál tárolóba másolt sütiket, mint bármelyik sütit ott, a Chrome menti.) A beállítások és a használati számlálók helyben tárolódnak. A forráskód nyilvános, MIT licenc alatt.

51 nyelven érhető el.

Chrome 119 vagy újabb szükséges.

Nincs kapcsolatban a Cookie-Editor és az EditThisCookie bővítményekkel.
