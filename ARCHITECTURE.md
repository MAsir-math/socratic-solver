# 架構：蘇格拉底解題（影相 → AI 下一提示）

## 目標

學生喺屋企影題 → 打開公開網站 → **後端真正睇圖** → 回傳**一條**蘇格拉底下一提示。  
學生**唔使**、亦**唔可以**貼 API Key。Key 只存在伺服器環境變數。

## 元件

```
[瀏覽器靜態頁 GitHub Pages]
        │  POST JSON（相片 base64 + 對話 history）
        ▼
[Cloudflare Worker  /api/socratic]  ← GEMINI_API_KEY（secret）
        │
        ▼
[Gemini Vision API]
```

- **Frontend**：`index.html`（Pages，由 `src/app.html` 經 `python3 src/build.py` 產生）。示範題用本地腳本，公式用內嵌 KaTeX。影相模式只呼叫 API。AI 回傳嘅 `nextPrompt`／`strategyHint` 若含 `$...$`、`$$...$$`、`\(...\)` 或 `\[...\]`，前端會轉成 KaTeX；不合法或未閉合嘅 `$` 保持原文。上載前先把相片長邊縮到約 1800px。失敗就誠實報未能使用，**唔會**用關鍵字假裝睇圖，亦**唔會**把上游錯誤正文顯示俾學生。
- **Backend**：`worker/` Cloudflare Worker（亦可以改寫成 Vercel `api/socratic.ts`，合約相同）。模型 id 維持 `gemini-3.8-flash`，`thinkingLevel` 預設 `low`（可用 `GEMINI_THINKING` 覆寫）。

## API 合約 `POST /api/socratic`

### Request
```json
{
  "imageBase64": "<raw base64 或 data-URL>",
  "mimeType": "image/jpeg",
  "problemText": "可選補充文字",
  "history": [
    { "role": "assistant", "content": "上一條提示" },
    { "role": "student", "content": "學生回答" }
  ],
  "locale": "zh-HK",
  "requestUnlock": false
}
```

### Response 200
```json
{
  "ok": true,
  "phase": "ELICIT",
  "nextPrompt": "一次一條主問題…",
  "strategyHint": null,
  "allowUnlock": false,
  "done": false
}
```

### Errors
`503 server_misconfigured`（無 Key）、`413 image_too_large`、`502 upstream_*`、`400 need_image_or_text`

### Health
`GET /api/health` → `{ ok, hasKey }`（hasKey 只係 boolean，唔洩漏 Key）

## 私隱

- 唔收集姓名／學號／成績；唔寫資料庫。
- 相片只短暫經 Worker 轉去 Gemini；唔做長期儲存（Worker 無 R2／KV 寫入）。
- 公開 repo **零秘密**；用 `wrangler secret put GEMINI_API_KEY`。

## 前端點搵 API

頁面讀：
1. `window.SOCRATIC_API`（可喺部署時注入）
2. 或 `<meta name="socratic-api" content="https://….workers.dev">`
3. 或同域 `/api/socratic`（若用 Pages+Functions／反向代理）

`src/app.html` 的 meta 而家指向 `https://socratic-solver-api.pages.dev`。Pages 仍然係靜態頁；影相請求去該 Worker。Key 只放 Worker secret。

## 馬Sir 要提供／做嘅事

1. **Gemini API Key**（Google AI Studio）
2. **Cloudflare 帳戶**（建議）或 Vercel
3. 按 README「部署後端」步驟：`wrangler login` → `secret put` → `deploy`
4. 把 Worker URL 填入前端 meta／環境後重新發布靜態頁（或設 Pages 自訂）

若 meta 冇 API 網址，主頁橫額會叫學生先用示範題。有網址但 Worker 未設 Key 或暫時失敗時，影相引導顯示一般錯誤，唔暴露模型名或秘密。
