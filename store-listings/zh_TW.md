CookieDesk 是一款 Cookie 編輯器，適合開發人員、測試人員，以及所有想知道網站存了什麼的人。可以檢視 Cookie、編輯 Cookie、新增和刪除 Cookie，還能搜尋，在彈出視窗或側邊面板中都行，由你選擇。

特色功能

• 分割 Cookie 編輯器。Chrome 會向沒有主動要求的工具隱藏分割 (CHIPS) Cookie，所以其他 Cookie 編輯器會悄悄顯示一份不完整的清單。CookieDesk 會把它們和一般 Cookie 一起列出，並標明各自的分割區。
• 每次變更都能復原。編輯、刪除、匯入和還原組合都會先寫入復原日誌，事後再驗證。如果 Chrome 拒絕某項變更，所有內容都會回復，並告訴你原因。按一下，10 分鐘內就能把 Cookie 原樣放回去；極少數情況下無法保留復原副本時，CookieDesk 會先詢問再繼續。
• 無廣告、不追蹤、不發送網路要求的 Cookie 編輯器。開放原始碼，每一行程式碼你都可以自己檢查。
• 依網站授權。安裝時不會跳出「讀取及變更您在所有網站上的資料」的提示。你一次只允許 CookieDesk 存取一個網站，看得到所有已允許的網站，也能一鍵移除任何一個。

檢視 COOKIE

• 檢視目前網站所有 Cookie 的 Cookie 檢視器：名稱、值、網域、路徑和到期時間，並為 HttpOnly、Secure、SameSite、工作階段和分割 Cookie 提供標記。
• HttpOnly Cookie 會清楚標註「頁面 JavaScript 看不到」。
• 真正好用的搜尋：輸入時依名稱、值或網域即時篩選，上百個 Cookie 也不成問題。
• 即時檢視：在你使用網站時，看到它設定或變更了哪些 Cookie。
• 「這個 Cookie 的作用」：用白話解釋每個旗標，包括值是否為 JSON Web Token 以及該權杖何時到期。

編輯 COOKIE

• 可以編輯 HttpOnly Cookie 和其他所有欄位：名稱、值、網域、路徑、到期時間、Secure、HttpOnly、SameSite 和分割區。
• 錯誤在 Chrome 看到之前就會被攔下。沒有 Secure 的 SameSite=None、子網域上的 __Host- Cookie、過去的到期時間：規則就解釋在欄位旁邊。
• JWT 之類的長值不會撐壞版面；按一個鍵即可複製任何值。
• 保護重要的 Cookie，大量刪除、匯入和還原組合都不會動它們。

刪除 COOKIE

• 刪除一個 Cookie，或刪除搜尋結果顯示的所有 Cookie，刪除前會列出具體將刪除哪些。10 分鐘內可復原。

適合真實工作流程的 COOKIE 管理工具

• Cookie 組合：把一個網站的 Cookie 儲存為具名檔案（例如「以管理員身分登入」），之後再還原。CookieDesk 在動手之前會先顯示將發生哪些變化，自己不保留任何副本。
• 比較：看看登入做了什麼（哪些 Cookie 被新增、移除或變更），可在已儲存的組合與目前狀態之間比較，也可在兩個組合之間比較。
• 在一般視窗和無痕視窗之間複製 Cookie（需先為 CookieDesk 開啟「允許在無痕模式中執行」）。
• 匯入和匯出 JSON 或 Netscape cookies.txt，也可以把 Cookie 複製為 document.cookie 程式碼片段。匯出時會提醒你：檔案中包含有效的工作階段 Cookie，應像密碼一樣對待。
• 鍵盤優先：/ 搜尋，方向鍵移動，Enter 編輯，c 複製，p 保護，Del 刪除，Ctrl+Z 復原，? 查看完整清單。

隱私權

CookieDesk 不收集任何資料，也不向任何地方傳送任何內容。沒有分析，沒有帳戶，沒有同步，沒有遠端程式碼。CookieDesk 自己不會在磁碟上保存 Cookie 值：復原副本存放在記憶體中，Chrome 關閉後即消失。（你複製到一般儲存區的 Cookie，與那裡的任何 Cookie 一樣，由 Chrome 儲存。）設定和使用次數只儲存在本機。原始碼以 MIT 授權公開。

提供 51 種語言。

需要 Chrome 119 或更新版本。

與 Cookie-Editor 或 EditThisCookie 無關聯。
