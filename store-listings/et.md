CookieDesk on küpsiste redaktor arendajatele, testijatele ja kõigile, kes tahavad näha, mida veebisait salvestab. Vaata küpsiseid, muuda küpsiseid, lisa ja kustuta küpsiseid ning otsi neid, hüpikaknas või külgpaneelis. Valid ise.

MIS TEEB SELLE ERINEVAKS

• Partitsioonitud küpsiste redaktor. Chrome peidab partitsioonitud (CHIPS) küpsised tööriistade eest, mis neid ei küsi, seega näitavad teised küpsiste redaktorid vaikselt puudulikku loendit. CookieDesk näitab neid tavaliste küpsiste kõrval, igaüks märgitud oma partitsiooniga.
• Tagasivõtmine igal muudatusel. Muudatused, kustutamised, impordid ja komplektide taastamised kirjutatakse esmalt tagasivõtmise logisse ja kontrollitakse hiljem. Kui Chrome muudatuse tagasi lükkab, keeritakse kõik tagasi ja sulle öeldakse põhjus. Üks klõps paneb küpsise täpselt endiseks 10 minuti jooksul; harvadel juhtudel, kui tagasivõtmiskoopiat ei saa hoida, küsib CookieDesk enne jätkamist.
• Küpsiste redaktor ilma reklaamide, jälgimise ja võrgupäringuteta. Avatud lähtekood, nii et saad kontrollida iga rida.
• Luba saidi kaupa. Paigaldamisel ei kuvata küsimust „teie andmete lugemine ja muutmine kõigil veebisaitidel”. Lubad CookieDeski ühe saidi kaupa, näed kõiki lubatud saite ja saad ükskõik millise ühe klõpsuga eemaldada.

VAATA KÜPSISEID

• Küpsiste vaatur praeguse saidi kõigi küpsiste jaoks: nimi, väärtus, domeen, asukoht ja aegumine, koos märgetega HttpOnly, Secure, SameSite, seansi- ja partitsioonitud küpsiste jaoks.
• HttpOnly küpsised on selgelt märgitud kui „lehe JavaScript ei näe seda”.
• Päris otsing: filtreeri nime, väärtuse või domeeni järgi kirjutamise ajal, isegi sajast küpsisest.
• Reaalajas vaade: vaata, milliseid küpsiseid sait seab või muudab, kui seda kasutad.
• „Mida see küpsis teeb”: iga lipp lihtsate sõnadega lahti seletatud, sh kas väärtus on JSON Web Token ja millal see token aegub.

MUUDA KÜPSISEID

• Muuda HttpOnly küpsiseid ja kõiki muid välju: nimi, väärtus, domeen, asukoht, aegumine, Secure, HttpOnly, SameSite ja partitsioon.
• Vead püütakse kinni enne, kui Chrome neid näeb. SameSite=None ilma Secure'ita, __Host- küpsis alamdomeenil, aegumine minevikus: reegel selgitatakse välja kõrval.
• Pikad väärtused, nagu JWT-d, ei lõhu kunagi paigutust; kopeeri iga väärtus ühe klahviga.
• Kaitse olulisi küpsiseid, et hulgikustutus, import ja komplekti taastamine neid ei puutuks.

KUSTUTA KÜPSISEID

• Kustuta üks küpsis või kõik otsingu näidatud küpsised pärast loendit sellest, mis täpselt kaob. Tagasivõetav 10 minutit.

KÜPSISTE HALDUR TEGELIKEKS TÖÖVOOGUDEKS

• Küpsisekomplektid: salvesta saidi küpsised nimega failina (näiteks „sisse logitud adminina”) ja taasta see hiljem. CookieDesk näitab, mis muutub, enne kui midagi teeb, ega hoia ise koopiat.
• Võrdle: vaata, mida sisselogimine tegi (millised küpsised lisati, eemaldati või muutusid) salvestatud komplekti ja praeguse vahel või kahe komplekti vahel.
• Kopeeri küpsiseid tavaliste ja inkognito akende vahel (pärast seda, kui oled CookieDeskile sisse lülitanud „Luba inkognito režiimis”).
• Impordi ja ekspordi JSON või Netscape cookies.txt või kopeeri küpsised document.cookie koodilõiguna. Eksport hoiatab, et fail sisaldab kehtivaid seansiküpsiseid ja seda tuleb käsitleda nagu parooli.
• Klaviatuur ees: / otsimiseks, nooled liikumiseks, Enter muutmiseks, c kopeerimiseks, p kaitsmiseks, Del kustutamiseks, Ctrl+Z tagasivõtmiseks, ? kogu loendi jaoks.

PRIVAATSUS

CookieDesk ei kogu midagi ega saada midagi kuhugi. Ei mingit analüütikat, kontosid, sünkroonimist ega kaugkoodi. CookieDesk ei hoia ise küpsiste väärtusi kettal: tagasivõtmiskoopiad on mälus ja kaovad Chrome'i sulgemisel. (Tavahoidlasse kopeeritud küpsised salvestab Chrome nagu kõik teised küpsised seal.) Seaded ja kasutusloendurid salvestatakse kohapeal. Lähtekood on avalik MIT-litsentsi all.

Saadaval 51 keeles.

Nõuab Chrome'i versiooni 119 või uuemat.

Ei ole seotud Cookie-Editori ega EditThisCookie'ga.
