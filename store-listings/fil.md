Ang CookieDesk ay cookie editor para sa mga developer, tester at sinumang gustong makita kung ano ang iniimbak ng isang website. Tingnan ang cookies, i-edit ang cookies, magdagdag at magbura ng cookies, at hanapin ang mga ito, sa popup o sa side panel. Ikaw ang pipili.

ANO ANG NAGPAPAIBA SA KANYA

• Partitioned cookie editor. Itinatago ng Chrome ang partitioned (CHIPS) cookies sa mga tool na hindi humihingi ng mga ito, kaya tahimik na nagpapakita ng kulang na listahan ang ibang cookie editor. Inililista ng CookieDesk ang mga ito katabi ng karaniwang cookies, bawat isa may label ng partition nito.
• Undo sa bawat pagbabago. Ang mga edit, pagbura, import at set restore ay isinusulat muna sa undo journal at sinusuri pagkatapos. Kung tanggihan ng Chrome ang isang pagbabago, ibabalik ang lahat at sasabihin sa iyo kung bakit. Isang click lang para maibalik ang cookie nang eksakto sa dati, sa loob ng 10 minuto; sa bihirang pagkakataong hindi maitabi ang kopya para sa undo, magtatanong muna ang CookieDesk bago ituloy.
• Cookie editor na walang ads, walang tracking at walang network request. Open source, kaya masusuri mo ang bawat linya.
• Pahintulot kada site. Walang lalabas na "basahin at baguhin ang lahat ng iyong data sa lahat ng website" sa pag-install. Pinapayagan mo ang CookieDesk isang site sa isang pagkakataon, nakikita mo ang bawat site na pinayagan mo, at maaari mong alisin ang alinman sa isang click.

TINGNAN ANG COOKIES

• Cookie viewer para sa bawat cookie ng kasalukuyang site: pangalan, value, domain, path at expiry, may mga badge para sa HttpOnly, Secure, SameSite, session at partitioned cookies.
• Malinaw na minamarkahan ang HttpOnly cookies bilang "hindi nakikita ng JavaScript ng page".
• Totoong search: i-filter ayon sa pangalan, value o domain habang nagta-type ka, kahit isandaang cookie pa.
• Live view: tingnan kung aling cookies ang itinatakda o binabago ng site habang ginagamit mo ito.
• "Ano ang ginagawa ng cookie na ito": bawat flag ay ipinaliwanag sa simpleng salita, kasama kung JSON Web Token ang value at kung kailan mag-e-expire ang token na iyon.

I-EDIT ANG COOKIES

• I-edit ang HttpOnly cookies at bawat iba pang field: pangalan, value, domain, path, expiry, Secure, HttpOnly, SameSite at partition.
• Nahuhuli ang mga pagkakamali bago pa makita ng Chrome. SameSite=None na walang Secure, __Host- cookie sa subdomain, expiry sa nakaraan: ipinapaliwanag ang patakaran sa tabi ng field.
• Hindi sinisira ng mahahabang value tulad ng JWT ang layout; kopyahin ang anumang value sa isang key.
• Protektahan ang mahahalagang cookie para lampasan ng bulk delete, import at set restore ang mga ito.

BURAHIN ANG COOKIES

• Magbura ng isang cookie, o ng bawat cookie na ipinapakita ng search, pagkatapos makita ang listahan ng eksaktong mabubura. Maaaring i-undo sa loob ng 10 minuto.

COOKIE MANAGER PARA SA TOTOONG DALOY NG TRABAHO

• Mga cookie set: i-save ang cookies ng isang site bilang may pangalang file (halimbawa "naka-login bilang admin") at i-restore ito mamaya. Ipinapakita ng CookieDesk kung ano ang magbabago bago ito gumawa ng anuman, at wala itong itinatabing kopya.
• Ihambing: tingnan kung ano ang ginawa ng pag-login (aling cookies ang idinagdag, inalis o binago) sa pagitan ng naka-save na set at ngayon, o sa pagitan ng dalawang set.
• Kopyahin ang cookies sa pagitan ng normal at incognito window mo (pagkatapos i-on ang "Allow in Incognito" para sa CookieDesk).
• Mag-import at mag-export ng JSON o Netscape cookies.txt, o kopyahin ang cookies bilang document.cookie snippet. Binabalaan ka ng mga export na may live session cookies ang file at dapat ituring na parang password.
• Keyboard-first: / para maghanap, arrow keys para lumipat, Enter para mag-edit, c para kumopya, p para magprotekta, Del para magbura, Ctrl+Z para mag-undo, ? para sa buong listahan.

PRIVACY

Walang kinokolekta at walang ipinapadala saanman ang CookieDesk. Walang analytics, walang account, walang sync, walang remote code. Walang sariling itinatabing cookie value sa disk ang CookieDesk: nasa memory ang mga kopya para sa undo at nawawala kapag nagsara ang Chrome. (Ang cookies na kinopya mo sa normal store, tulad ng anumang cookie doon, ay sine-save ng Chrome.) Lokal na iniimbak ang mga setting at bilang ng paggamit. Pampubliko ang source code sa ilalim ng MIT license.

Available sa 51 wika.

Nangangailangan ng Chrome 119 o mas bago.

Walang kaugnayan sa Cookie-Editor o EditThisCookie.
