// 중계 서버 (Cloudflare Worker)
// - Anthropic API 키는 Worker 시크릿(ANTHROPIC_API_KEY)에만 있고 앱에는 없다
// - 초대 코드(KV)로만 사용 가능, 코드별 하루 횟수 + 전체 하루 횟수 제한
// - 정해진 입력(상품/샵/옵션/이미지)만 받아 서버에서 프롬프트를 조립 → 범용 Claude 프록시로 못 씀
import Anthropic from '@anthropic-ai/sdk';
import { buildRequest, publicOptions, validateInput } from './metaprompt.js';

const MODEL = 'claude-opus-5-5';
const MAX_BODY_BYTES = 7_000_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// 한국 날짜 기준으로 하루 카운트
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

async function bump(kv, key, limit) {
  const used = Number((await kv.get(key)) || 0);
  if (used >= limit) return false;
  await kv.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  return true;
}

async function authorize(request, env) {
  const code = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!/^[A-Za-z0-9-]{6,64}$/.test(code)) return { error: '초대 코드를 입력해 주세요.', status: 401 };
  const record = await env.CODES.get(`code:${code}`, 'json');
  if (!record || record.active === false) return { error: '사용할 수 없는 초대 코드입니다.', status: 401 };
  return { code, record };
}

async function handleGenerate(request, env) {
  const auth = await authorize(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status);

  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return json({ error: '요청이 너무 큽니다. 이미지 수나 크기를 줄여 주세요.' }, 413);
  }
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }
  const invalid = validateInput(input);
  if (invalid) return json({ error: invalid }, 400);

  const day = today();
  const perCode = Number(auth.record.daily || env.DEFAULT_CODE_DAILY_LIMIT || 20);
  if (!(await bump(env.CODES, `usage:${auth.code}:${day}`, perCode))) {
    return json({ error: `오늘 사용 횟수(${perCode}회)를 모두 썼습니다. 내일 다시 이용해 주세요.` }, 429);
  }
  if (!(await bump(env.CODES, `usage:all:${day}`, Number(env.GLOBAL_DAILY_LIMIT || 200)))) {
    return json({ error: '오늘 서비스 전체 사용량이 가득 찼습니다. 내일 다시 이용해 주세요.' }, 429);
  }

  const { system, content, schema } = buildRequest(input);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // NDJSON 스트림: {"type":"delta","text"} … {"type":"done","stop_reason"} 또는 {"type":"error","error"}
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (obj) => writer.write(encoder.encode(JSON.stringify(obj) + '\n'));

  const run = async () => {
    try {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 32000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high', format: { type: 'json_schema', schema } },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          messages: [{ role: 'user', content }],
        },
        { signal: request.signal }
      );
      stream.on('text', (text) => send({ type: 'delta', text }));
      const message = await stream.finalMessage();
      await send({ type: 'done', stop_reason: message.stop_reason });
    } catch (err) {
      console.error('generate failed', err?.status, err?.message);
      const error =
        err instanceof Anthropic.RateLimitError
          ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
          : err instanceof Anthropic.APIError
            ? `AI 서버 오류가 발생했습니다 (${err.status ?? '연결'}). 잠시 후 다시 시도해 주세요.`
            : '생성 중 오류가 발생했습니다.';
      await send({ type: 'error', error }).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  };

  return { response: new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } }), run };
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (request.method === 'GET' && pathname === '/options') {
      const auth = await authorize(request, env);
      if (auth.error) return json({ error: auth.error }, auth.status);
      return json({ ...publicOptions(), name: auth.record.name || '' });
    }

    if (request.method === 'POST' && pathname === '/generate') {
      const result = await handleGenerate(request, env);
      if (result instanceof Response) return result;
      ctx.waitUntil(result.run());
      return result.response;
    }

    return json({ error: 'Not found' }, 404);
  },
};
