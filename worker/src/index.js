/**
 * Cloudflare Worker: POST /api/socratic
 * Server-side Gemini call. GEMINI_API_KEY from env secret — never in frontend.
 * No student name/score persistence.
 */

const SYSTEM = `你是香港中學文憑試（HKDSE）數學科【必修部分】的蘇格拉底導師。回覆一律使用繁體中文書面語（勿用粵語口語）。

課程依據（必須遵守）：
- 引導與解法必須符合香港 DSE 數學【必修部分】課程及常用教科書／公開試慣例。初中基礎（如基礎代數、直線方程、基礎幾何）在解 DSE 題時可作鋪墊。
- 不要以延伸部分 M1／M2 的內容或技巧作為主要解法，除非題目明顯只屬於 M2／延伸部分；若學生使用超出必修的進階方法，應溫和引導回必修常用方法。
- 優先採用香港課室慣用語與方法，例如：因式分解、配方法、公式法；二次方程判別式 Δ；角度以 ° 表示；分數／根式依課室簡化習慣處理。
- 勿把課程外的捷徑、大學方法或不常見技巧當成「標準主線」。

蘇格拉底規則：
1. 每次只回傳「下一條」主問題／提示，不要一次拋出多條，更不要直接寫出完整逐步解法或最終答案。
2. 引導順序：ELICIT（已知／所求）→ PROBE（定義／條件／方法）→ GUIDE（下一步代數／幾何動作，由闊到窄）→ SYNTH（請學生用自己的話總結）。
3. 若有題目相片：先根據相片可見內容理解題目再提問；不可假裝看到相片中沒有出現的數字或條件。
4. 學生答錯時：給予策略提示（如何思考），仍然不要直接給出最終答案。
5. 只有當學生明確要求看完整解法，或對話已充分嘗試且 requestUnlock=true，才可將 allowUnlock 標為 true；即使如此，nextPrompt 仍應先問「你想對照哪一步？」，不要一次傾出全部步驟。
6. 不要收集或要求姓名、班別、學號。
7. 若相片／題目不清晰，或明顯超出必修數學範圍（例如純 M1／M2、大學微積分、非數學科），請如實說明，並提出一條澄清問題，勿硬套錯誤課程內容。
8. 回傳必須是嚴格 JSON（不要用 markdown 圍欄），格式：
{"phase":"ELICIT|PROBE|GUIDE|SYNTH","nextPrompt":"...","strategyHint":null或字串,"allowUnlock":false,"done":false}`;

function corsHeaders(origin, allow) {
  const ok = !allow || allow === '*' || (origin && origin.startsWith(allow.replace(/\/$/, '')))
    || (origin && origin.includes('masir-math.github.io'))
    || (origin && origin.includes('localhost'))
    || (origin && origin.includes('127.0.0.1'));
  return {
    'Access-Control-Allow-Origin': ok && origin ? origin : (allow || '*'),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOW_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/api/health')) {
      return json({ ok: true, service: 'socratic-solver-api', hasKey: Boolean(env.GEMINI_API_KEY) }, 200, cors);
    }

    if (request.method !== 'POST' || !url.pathname.endsWith('/api/socratic')) {
      return json({ ok: false, error: 'not_found' }, 404, cors);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ ok: false, error: 'server_misconfigured', message: '服務尚未設定完成' }, 503, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, cors);
    }

    const imageBase64 = body.imageBase64 || null;
    const mimeType = body.mimeType || 'image/jpeg';
    const problemText = (body.problemText || '').slice(0, 8000);
    const history = Array.isArray(body.history) ? body.history.slice(-16) : [];
    const requestUnlock = Boolean(body.requestUnlock);

    if (!imageBase64 && !problemText) {
      return json({ ok: false, error: 'need_image_or_text' }, 400, cors);
    }

    // Size guard (~4MB base64)
    if (imageBase64 && imageBase64.length > 5_500_000) {
      return json({ ok: false, error: 'image_too_large', message: '相片太大，請壓縮後再試' }, 413, cors);
    }

    const parts = [];
    parts.push({
      text:
        `locale=zh-HK；requestUnlock=${requestUnlock}\n` +
        (problemText ? `學生貼上的題文：\n${problemText}\n` : '（無額外題文，請依據相片）\n') +
        `對話紀錄（舊→新）：\n` +
        (history.length
          ? history.map((h, i) => `${i + 1}. [${h.role || 'student'}] ${h.content || ''}`).join('\n')
          : '（尚未開始，請出第一條 ELICIT 問題）'),
    });
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: imageBase64.replace(/^data:[^;]+;base64,/, ''),
        },
      });
    }

    const model = env.GEMINI_MODEL || 'gemini-3.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    let geminiRes;
    try {
      geminiRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
          },
        }),
      });
    } catch (e) {
      return json({ ok: false, error: 'upstream_network', message: String(e) }, 502, cors);
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return json({
        ok: false,
        error: 'upstream_http',
        status: geminiRes.status,
        message: errText.slice(0, 500),
      }, 502, cors);
    }

    const data = await geminiRes.json();
    const raw =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // try extract JSON object
      const m = raw.match(/\{[\s\S]*\}/);
      try {
        parsed = m ? JSON.parse(m[0]) : null;
      } catch {
        parsed = null;
      }
    }

    if (!parsed || !parsed.nextPrompt) {
      return json({
        ok: false,
        error: 'bad_model_json',
        message: '模型回傳格式不正確',
        raw: raw.slice(0, 400),
      }, 502, cors);
    }

    return json({
      ok: true,
      phase: parsed.phase || 'GUIDE',
      nextPrompt: String(parsed.nextPrompt).slice(0, 2000),
      strategyHint: parsed.strategyHint ? String(parsed.strategyHint).slice(0, 1000) : null,
      allowUnlock: Boolean(parsed.allowUnlock) || requestUnlock,
      done: Boolean(parsed.done),
      // never echo key or full chain-of-thought dump
    }, 200, cors);
  },
};
