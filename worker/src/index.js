/**
 * Cloudflare Worker: POST /api/socratic
 * Server-side Gemini call. GEMINI_API_KEY from env secret — never in frontend.
 * No student name/score persistence.
 */

const SYSTEM = `你是香港中學文憑試（HKDSE）數學科【必修部分＋延伸部分（M1／M2）】的蘇格拉底導師。回覆一律使用繁體中文書面語（勿用粵語口語）。每次只給一條提示／問題。

課程依據（必須遵守）：
- 引導與解法必須符合香港 DSE 數學【必修部分】及【延伸部分一（M1）、延伸部分二（M2）】課程及常用教科書／公開試慣例。初中基礎（如基礎代數、直線方程、基礎幾何）在解 DSE 題時可作鋪墊。
- 依題目性質選用對應範圍的方法：必修題用必修常用解法；M1 題可用 M1 方法（如微積分應用於統計／概率相關課題等課綱內容）；M2 題可用 M2 方法（如進階代數、微積分、矩陣等課綱內容）。不要強制只用必修方法去解明顯的 M1／M2 題。
- 優先採用香港課室慣用語與方法（例如必修：因式分解、配方法、公式法、判別式 Δ；角度以 ° 表示；分數／根式依課室簡化習慣）。M1／M2 則依該單元教科書／公開試慣例。
- 勿把超出 DSE 必修／M1／M2 課綱的大學方法、課程外捷徑或不常見技巧當成「標準主線」。

蘇格拉底規則：
1. 每次只回傳「下一條」主問題／提示，不要一次拋出多條，更不要直接寫出完整逐步解法或最終答案。
2. 引導順序：ELICIT（已知／所求）→ PROBE（定義／條件／方法）→ GUIDE（下一步代數／幾何／微積分等動作，由闊到窄）→ SYNTH（請學生用自己的話總結）。
3. 若有題目相片：先根據相片可見內容理解題目再提問；不可假裝看到相片中沒有出現的數字或條件。
4. 學生答錯時：給予策略提示（如何思考），仍然不要直接給出最終答案。
5. 只有當學生明確要求看完整解法，或對話已充分嘗試且 requestUnlock=true，才可將 allowUnlock 標為 true；即使如此，nextPrompt 仍應先問「你想對照哪一步？」，不要一次傾出全部步驟。
6. 不要收集或要求姓名、班別、學號。
7. 若相片／題目不清晰，或明顯超出 DSE 數學必修／M1／M2 範圍（例如大學高等數學、非數學科），請如實說明，並提出一條澄清問題，勿硬套錯誤課程內容。
8. 回傳必須是嚴格 JSON（不要用 markdown 圍欄），格式：
{"phase":"ELICIT|PROBE|GUIDE|SYNTH","nextPrompt":"...","strategyHint":null或字串,"allowUnlock":false,"done":false}
9. 數學式用 LaTeX：行內 $...$，需要獨立成行才用 $$...$$。不要用程式碼塊，不要把 $ 當作貨幣符號。nextPrompt 只留一條問題；strategyHint 同樣可以用 $...$。`;

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
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

function generationConfig(env, model) {
  // Gemini 3.x rejects deprecated sampling params (temperature / top_p / top_k) — omit them.
  // Do not lower maxOutputTokens to chase speed: the cap includes thinking tokens.
  const config = {
    maxOutputTokens: 4096,
    responseMimeType: 'application/json',
  };
  const id = String(model || '');
  // 2.5 series uses thinkingBudget, not thinkingLevel — omit thinking for those.
  if (/gemini-2\.5/.test(id)) {
    return config;
  }
  // 3.8 defaults to medium (slow); low is the latency setting. minimal rejected on 3.8.
  const level = String(env.GEMINI_THINKING || 'low').trim();
  if (level && level !== 'default') {
    config.thinkingConfig = { thinkingLevel: level };
  }
  return config;
}

export { generationConfig };

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

    // 3.8 Flash free-tier has frequent 503 UNAVAILABLE (Google forums Oct 2026).
    // Default primary = 3.6; optional override via GEMINI_MODEL. Fallbacks keep class usable.
    const primaryModel = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const fallbackRaw = env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash,gemini-3.8-flash,gemini-2.5-flash';
    const modelChain = [primaryModel];
    for (const m of String(fallbackRaw).split(',').map((s) => s.trim()).filter(Boolean)) {
      if (m && !modelChain.includes(m)) modelChain.push(m);
    }

    async function callGemini(model) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
      const ac = new AbortController();
      // Per-attempt budget: leave room for 2–3 model tries under frontend 90s.
      const timer = setTimeout(() => ac.abort(), 22000);
      try {
        return await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ac.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM }] },
            contents: [{ role: 'user', parts }],
            generationConfig: generationConfig(env, model),
          }),
        });
      } finally {
        clearTimeout(timer);
      }
    }

    function isRetryableStatus(status) {
      return status === 404 || status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
    }

    async function readUpstreamMeta(res) {
      let upstreamStatus = res.status;
      let upstreamReason = '';
      let bodyText = '';
      try {
        bodyText = await res.text();
        const errBody = JSON.parse(bodyText);
        const st = errBody && errBody.error && errBody.error.status;
        const msg = errBody && errBody.error && errBody.error.message;
        upstreamReason = String(st || msg || '').slice(0, 120);
      } catch {
        upstreamReason = '';
      }
      return { upstreamStatus, upstreamReason, bodyText };
    }

    let geminiRes = null;
    let lastMeta = { upstreamStatus: 0, upstreamReason: '', bodyText: '' };
    let timedOut = false;
    let networkFail = false;

    outer: for (const model of modelChain) {
      try {
        geminiRes = await callGemini(model);
      } catch (e) {
        timedOut = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
        networkFail = !timedOut;
        geminiRes = null;
        continue;
      }
      if (geminiRes.ok) break outer;
      lastMeta = await readUpstreamMeta(geminiRes);
      geminiRes = null;
      if (!isRetryableStatus(lastMeta.upstreamStatus)) break outer;
      // brief pause before next model on overload
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
    }

    if (!geminiRes) {
      if (timedOut && !lastMeta.upstreamStatus) {
        return json({
          ok: false,
          error: 'upstream_timeout',
          message: '暫時未能讀取題目，請再試一次。',
        }, 502, cors);
      }
      if (networkFail && !lastMeta.upstreamStatus) {
        return json({
          ok: false,
          error: 'upstream_network',
          message: '暫時未能讀取題目，請再試一次。',
        }, 502, cors);
      }
      return json({
        ok: false,
        error: 'upstream_http',
        message: '暫時未能讀取題目，請再試一次。',
        upstreamStatus: lastMeta.upstreamStatus || undefined,
        upstreamReason: lastMeta.upstreamReason || undefined,
      }, 502, cors);
    }

    let data;
    try {
      data = await geminiRes.json();
    } catch {
      return json({
        ok: false,
        error: 'bad_model_json',
        message: '暫時未能產生提示，請再試一次。',
      }, 502, cors);
    }
    const raw =
      (data?.candidates?.[0]?.content?.parts || [])
        .filter((p) => p && !p.thought && p.text)
        .map((p) => p.text)
        .join('') || '';

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
        message: '暫時未能產生提示，請再試一次。',
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
