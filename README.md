# 蘇格拉底解題引導｜馬Sir教室

學生打開 HTTPS 連結：示範題本地引導，或（接上後端後）影相 → 蘇格拉底下一提示。  
**學生唔使、亦唔可以貼 API Key。** Key 只放 Cloudflare Worker 環境變數。

詳細架構見 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

## 公開網址

https://masir-math.github.io/socratic-solver/

前端 meta 已指向 `https://socratic-solver-api.pages.dev`。有呢個網址時，主頁唔再顯示「未接上」橫額；影相會呼叫 Worker。Key 仍然只喺 Cloudflare，唔會出現喺頁面。

## 兩條路徑

| 模式 | 做咩 | 要唔要後端 |
|------|------|------------|
| **示範模式（唔睇圖）** | 6 條內建 DSE 風格題＋本地腳本 | 唔需要；純靜態 Pages 即用 |
| **文字題本地引導** | 貼題文 → 關鍵字粗分類 → 通用鷹架 | 唔需要（**唔係**睇圖） |
| **影相 AI 引導** | 上載相片 → `POST` Worker → Gemini Vision → 下一條提示 | **需要** Worker＋`GEMINI_API_KEY` |

未接後端時，撳「影相引導」會**老實說明後端未接上**，唔會用關鍵字假裝睇圖。

## 學生點用（而家）

1. 打開網址  
2. 揀左邊**示範模式（唔睇圖）**題（建議）  
3. 一次一條主問題；可「再提示一下」  
4. 完整解法預設隱藏（「我試完先睇」或多次失敗後）

唔收集姓名／成績；示範題離線都用得（KaTeX 已內嵌）。影相提示入面嘅 `$...$`／`$$...$$` 亦用同一套 KaTeX 顯示，唔會見到原始美元符號。

## 馬Sir 要提供先至開到影相 AI

1. **Gemini API Key**（Google AI Studio）  
2. **Cloudflare 帳戶**（建議；或自行改 Vercel，合約見 ARCHITECTURE）  
3. 部署 Worker，把 **Worker 公開 URL** 寫入前端：

```html
<meta name="socratic-api" content="https://YOUR-WORKER.workers.dev">
```

或部署時注入 `window.SOCRATIC_API = 'https://YOUR-WORKER.workers.dev'`。

## 部署後端（Cloudflare Worker）

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put GEMINI_API_KEY   # 貼上 Key；唔好 commit
npx wrangler deploy
```

- `wrangler.toml` 已設 `ALLOW_ORIGIN` 指向 `https://masir-math.github.io`  
- Health：`GET /api/health` → `{ ok, hasKey }`（只回 boolean）  
- 合約：`POST /api/socratic`（見 ARCHITECTURE.md）  
- **公開 repo 零秘密**；`worker/` 源碼可以放同一 repo，但唔好把 `.env`／secret 推進去

部署後：把 Worker URL 填入 `src/app.html` 的 meta → `python3 src/build.py` → 再更新 GitHub Pages。  
`src/build.py` 用 `src/vendor/` 入面已內嵌字型嘅 KaTeX；舊路徑 `/workspace/definite-integral/vendor/katex` 仍然可以作後備。

Worker 要再 `npx wrangler deploy` 一次，思考量先會改為 `low`（模型 id 仍然係 `gemini-3.8-flash`）。未 redeploy 之前，頁面嘅公式顯示同相片縮小已經生效。

## 本機預覽

```bash
cd /workspace/socratic-solver
python3 src/build.py
python3 -m http.server 8766
```

打開 http://127.0.0.1:8766/

## GitHub Pages 發布內容

建議發布：`index.html`、`README.md`、`ARCHITECTURE.md`、`.nojekyll`，以及 **`worker/` 源碼**（無 secret）。  
唔發布：任何 Key、`.env`、本機 `.github-pages-publisher.json`（可留喺專案根目錄作更新紀錄）。

## 速度

- 上載前把相片長邊縮到約 1800px、轉成 JPEG，再送去 Worker（細圖就保持原檔）。
- 等候時引導卡會顯示進度同已等候秒數；返回主頁會取消未完成嘅請求。
- 預設模型改為 `gemini-3.5-flash-lite`（`GEMINI_MODEL` 可覆寫）。`gemini-3.8-flash` 喺 Free tier 常出現 503，Worker 會自動 fallback（`GEMINI_FALLBACK_MODEL`，預設 `gemini-3.6-flash,gemini-3.8-flash,gemini-2.5-flash`）。
- 對 Gemini 3.x 唔再傳 `temperature`（已棄用會拒收）。thinking 用 `thinkingLevel: low`（2.5 系列會略過）。輸出上限 4096。
- 上游錯誤唔再把回應正文傳去瀏覽器，避免錯誤訊息帶出網址或秘密。

## 已知限制（試版）

- 影相引導需要已部署、並且設好 `GEMINI_API_KEY` 嘅 Worker。未接上時會老實話未能使用，唔會用關鍵字假裝睇圖  
- 自訂「文字本地」完整解法係通用說明，唔會自動寫你條題嘅數式答案  
- 示範題自動改卷靠關鍵字／數值，寫法太怪可能判錯  
- 相片經 Worker 轉去 Gemini 時短暫處理；Worker 唔做長期儲存／記分  
- 學生頁面唔顯示模型名稱、網址或 Key
