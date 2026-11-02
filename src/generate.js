// Claude 호출: 입력 검증 → 프롬프트 조립 → 스트리밍 생성 → JSON 결과
const Anthropic = require('@anthropic-ai/sdk').default;
const { validateInput, buildRequest } = require('./metaprompt');

const MODEL = 'claude-opus-5-5';

async function generate({ apiKey, input, onDelta, signal }) {
  const invalid = validateInput(input);
  if (invalid) return { ok: false, error: invalid };

  const { system, content, schema } = buildRequest(input);
  const client = new Anthropic({ apiKey });

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
      { signal }
    );
    stream.on('text', (text) => onDelta?.(text));
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') return { ok: false, error: '요청이 거절되었습니다. 키워드를 바꿔서 다시 시도해 주세요.' };
    if (message.stop_reason === 'max_tokens') return { ok: false, error: '응답이 너무 길어 잘렸습니다. 영상 길이를 줄여 다시 시도해 주세요.' };
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { ok: true, result: JSON.parse(text) };
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) return { ok: false, error: '생성을 취소했습니다.' };
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'API 키가 올바르지 않습니다. 운영자에게 문의해 주세요.' };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: '네트워크에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.' };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `AI 서버 오류 (${err.status}): 잠시 후 다시 시도해 주세요.` };
    if (err instanceof SyntaxError) return { ok: false, error: '응답을 해석하지 못했습니다. 다시 시도해 주세요.' };
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = { generate };
