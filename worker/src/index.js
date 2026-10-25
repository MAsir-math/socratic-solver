/**
 * Cloudflare Worker: POST /api/socratic
 * Server-side Gemini call. GEMINI_API_KEY from env secret — never in frontend.
 * No student name/score persistence.
 */

const SYSTEM = `你是香港 DSE 數學科蘇格拉底導師（繁體中文、香港課室用語）。
規則（必須遵守）：
1. 每次只回傳「下一條」主問題／提示，不要一次拋多條，更不要直接寫出完整逐步解法或最終答案。
2. 引導順序：ELICIT（已知／所求）→ PROBE（定義／條件／方法）→ GUIDE（下一步代數／幾何動作，由闊到窄）→ SYNTH（請學生用自己說話總結）。
3. 若有題目相片：先根據相片內容理解題目，再提問；唔好假裝睇到冇出現嘅數。
4. 學生答錯時：給策略提示（點諗），仍然唔好直接俾最終答案。
5. 只有當學生明確要求睇完整解法，或對話已充分嘗試且 requestUnlock=true，先可以喺 allowUnlock 標 true；即使如此 nextPrompt 仍應先問「你想對照邊一步？」而唔好一次傾晒。
6. 唔好收集或要求姓名、班別、學號。
7. 回傳必須係嚴格 JSON（唔好 markdown 圍欄），格式：
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
      return json({ ok: false, error: 'server_misconfigured', message: 'GEMINI_API_KEY 未設定' }, 503, cors);
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
        (problemText ? `學生貼上嘅題文：\n${problemText}\n` : '（無額外題文，請靠相片）\n') +
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

    const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
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
        message: '模型回傳格式唔正確',
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
