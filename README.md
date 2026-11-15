# 蘇格拉底解題引導｜馬Sir教室

學生打開 HTTPS 連結：示範題本地引導，或影相 → 蘇格拉底下一提示。  
**學生唔使、亦唔可以貼 API Key。** Key 只放 Cloudflare Worker 環境變數。

詳細架構見 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。  
開發里程碑（**不是**數學延伸單元）見 [`MILESTONES.md`](./MILESTONES.md)。

## 公開網址

https://masir-math.github.io/socratic-solver/

前端 meta 已指向 `https://socratic-solver-api.pages.dev`。Key 仍然只喺 Cloudflare，唔會出現喺頁面。

## 而家有咩功能（M1 核心）

| 功能 | 做咩 | 要唔要後端 |
|------|------|------------|
| **示範題** | 6 條內建題；一次一問；公式用 KaTeX | 唔需要 |
| **文字題** | 貼題文 → 關鍵字粗分類 → 通用鷹架（唔自動寫完整答案） | 唔需要 |
| **影相引導** | 相片縮小後交 Worker；每次一條提示；`$...$` 會渲染 | 需要 Worker＋Key |
| **等候／失敗** | 讀秒；返回可取消；錯誤唔洩漏上游內容 | 需要 Worker |

主頁會檢查拍照引導是否就緒（只顯示「已就緒／未能使用」，唔顯示模型名）。

## 學生點用

1. 打開網址  
2. **先做一條示範題**（建議，離線都得）  
3. 有自己的題：上載相片 → 拍照引導 → 寫想法 → 下一提示  
4. 完整解法預設隱藏  

唔收集姓名／成績；**Google 帳戶登入留到 M2**，M1 唔做。

## 點樣試（可唔使入 GitHub）

- **M1 驗收**：喺 Cursor 預覽或本機 `http.server` 試就得；示範題離線可用。
- **唔使**為咗試用而去 GitHub 合併 PR。
- 正式站（上面公開網址）要見到最新改動，先至需要合併進 `main`；到時可喺 Cursor 叫 Agent 代做。

## 馬Sir 要提供先至開到影相 AI

1. **Gemini API Key**（Google AI Studio）  
2. **Cloudflare 帳戶**  
3. 部署 Worker，把公開 URL 寫入前端 meta（而家已填 Pages URL）

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

- Health：`GET /api/health` → `{ ok, hasKey }`（只回 boolean）  
- 合約：`POST /api/socratic`（見 ARCHITECTURE.md）  
- 預設模型：`gemini-3.5-flash-lite`；唔穩時自動 fallback 其他 Flash  
- 公開 repo **零秘密**

前端改動後：

```bash
python3 src/build.py
```

再更新 GitHub Pages。

## 本機預覽

```bash
python3 src/build.py
python3 -m http.server 8766
```

打開 http://127.0.0.1:8766/

## 已知限制

- 影相要有已設 Key 的 Worker；否則老實話未能使用  
- 文字本地模式唔會自動寫出該題完整數式答案  
- 示範題改卷靠關鍵字，怪寫法可能判錯  
- 相片只短暫轉交，唔做長期儲存／記分  
- 學生頁唔顯示模型名稱或 Key  
- 用量限制、正式上線回滾、**Google 帳戶登入**屬 **M2**（見 MILESTONES.md）
