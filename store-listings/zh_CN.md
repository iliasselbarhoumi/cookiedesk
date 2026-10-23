CookieDesk 是一款 Cookie 编辑器，适合开发者、测试人员，以及所有想知道网站存了什么的人。可以查看 Cookie、编辑 Cookie、添加和删除 Cookie，还能搜索，在弹出窗口或侧边栏中都行，由你选择。

特色功能

• 分区 Cookie 编辑器。Chrome 会向没有主动请求的工具隐藏分区 (CHIPS) Cookie，所以其他 Cookie 编辑器会悄悄显示一份不完整的列表。CookieDesk 会把它们和普通 Cookie 一起列出，并标明各自的分区。
• 每次更改都能撤销。编辑、删除、导入和还原集都会先写入撤销日志，事后再校验。如果 Chrome 拒绝某项更改，所有内容都会回滚，并告诉你原因。点一下，10 分钟内就能把 Cookie 原样放回去；极少数情况下无法保留撤销副本时，CookieDesk 会先询问再继续。
• 无广告、无跟踪、无网络请求的 Cookie 编辑器。开源，每一行代码你都可以自己检查。
• 按网站授权。安装时不会弹出“读取和更改您在所有网站上的数据”的提示。你一次只允许 CookieDesk 访问一个网站，能看到所有已允许的网站，也能一键移除任何一个。

查看 COOKIE

• 查看当前网站所有 Cookie 的 Cookie 查看器：名称、值、域名、路径和过期时间，并为 HttpOnly、Secure、SameSite、会话和分区 Cookie 提供标记。
• HttpOnly Cookie 会清楚标注“页面 JavaScript 不可见”。
• 真正好用的搜索：输入时按名称、值或域名实时筛选，上百个 Cookie 也不在话下。
• 实时视图：在你使用网站时，看到它设置或更改了哪些 Cookie。
• “这个 Cookie 的作用”：用大白话解释每个标志，包括值是否为 JSON Web Token 以及该令牌何时过期。

编辑 COOKIE

• 可以编辑 HttpOnly Cookie 和其他所有字段：名称、值、域名、路径、过期时间、Secure、HttpOnly、SameSite 和分区。
• 错误在 Chrome 看到之前就会被拦下。没有 Secure 的 SameSite=None、子域名上的 __Host- Cookie、过去的过期时间：规则就解释在字段旁边。
• JWT 之类的长值不会撑坏布局；一个按键即可复制任何值。
• 保护重要的 Cookie，批量删除、导入和还原集都不会动它们。

删除 COOKIE

• 删除一个 Cookie，或删除搜索结果显示的所有 Cookie，删除前会列出具体将删除哪些。10 分钟内可撤销。

适合真实工作流程的 COOKIE 管理器

• Cookie 集：把一个网站的 Cookie 保存为命名文件（例如“以管理员身份登录”），之后再还原。CookieDesk 在动手之前会先显示将发生哪些变化，自己不保留任何副本。
• 对比：看看登录做了什么（哪些 Cookie 被添加、移除或更改），可在已保存的集与当前之间对比，也可在两个集之间对比。
• 在普通窗口和无痕窗口之间复制 Cookie（需先为 CookieDesk 开启“在无痕模式下启用”）。
• 导入和导出 JSON 或 Netscape cookies.txt，也可以把 Cookie 复制为 document.cookie 代码片段。导出时会提醒你：文件中包含有效的会话 Cookie，应像密码一样对待。
• 键盘优先：/ 搜索，方向键移动，Enter 编辑，c 复制，p 保护，Del 删除，Ctrl+Z 撤销，? 查看完整列表。

隐私

CookieDesk 不收集任何信息，也不向任何地方发送任何内容。没有分析，没有账号，没有同步，没有远程代码。CookieDesk 自己不会在磁盘上保存 Cookie 值：撤销副本保存在内存中，Chrome 关闭后即消失。（你复制到普通存储区的 Cookie，与那里的任何 Cookie 一样，由 Chrome 保存。）设置和使用次数仅保存在本地。源代码以 MIT 许可证公开。

提供 51 种语言。

需要 Chrome 119 或更高版本。

与 Cookie-Editor 或 EditThisCookie 无关联。
