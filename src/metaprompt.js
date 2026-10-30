// 메타프롬프트 엔진: 키워드(상품/샵) → Claude에게 보낼 시스템 프롬프트 + 사용자 메시지 + 출력 스키마

const TOOLS = {
  generic: {
    label: '범용 (어떤 영상 AI든)',
    clipSeconds: 8,
    guide: `- Write tool-agnostic prompts that work in most text-to-video models.
- Structure each prompt as: [shot type & camera] + [subject] + [action] + [setting] + [lighting] + [style/film look] + [mood].
- Keep each scene prompt to 60–110 words, concrete and visual.`,
  },
  veo: {
    label: 'Google Veo 3',
    clipSeconds: 8,
    guide: `- Veo 3 generates ~8-second clips WITH native audio. Every scene prompt must end with an "Audio:" line describing ambient sound, SFX and music feel.
- If a scene has spoken lines, put them in the prompt as: A woman says: "..." (keep lines short enough to be spoken in the clip length). Spoken lines may be Korean.
- Use cinematic vocabulary (e.g. "slow dolly-in", "35mm lens", "shallow depth of field", "golden hour backlight").
- Avoid asking the model to render written text/logos on screen; those go in the editing overlay instead.`,
  },
  sora: {
    label: 'OpenAI Sora 2',
    clipSeconds: 10,
    guide: `- Sora handles multi-beat cinematic shots with synchronized audio. Write each scene prompt as a short film direction: setting & style first, then camera, then action beats, then sound.
- Describe physical details precisely (fabric texture, how light falls, how the body moves) for realism.
- Include a brief "Sound:" sentence per scene. Dialogue, if any, in quotes and short.
- Do not request real people's likeness, celebrities, or trademarked characters.`,
  },
  kling: {
    label: 'Kling',
    clipSeconds: 5,
    guide: `- Kling works best with clear, single-subject prompts focused on MOTION. Use the order: subject + motion + scene + camera movement + lighting + style.
- 40–80 words per scene. One main action per clip; avoid complex multi-beat choreography.
- Kling supports a separate negative prompt — make negative_prompt specific (e.g. "distorted hands, warped fabric, flicker, extra fingers, text artifacts").
- Recommend image-to-video when a real product photo exists (mention in tips).`,
  },
  runway: {
    label: 'Runway Gen-4',
    clipSeconds: 5,
    guide: `- Runway Gen-4 is strongest as image-to-video: assume the user will supply a reference image of the product/shop. Scene prompts should focus on MOTION and CAMERA, not re-describing what is already in the image.
- Use positive phrasing only (describe what should happen, never "no X"). Leave negative_prompt short.
- 30–70 words per scene, simple and direct ("The camera slowly orbits the coat as snow begins to fall").`,
  },
};

const RATIOS = {
  '9:16': '세로 9:16 (릴스·쇼츠·틱톡)',
  '16:9': '가로 16:9 (유튜브·웹)',
  '1:1': '정사각 1:1 (피드)',
};

const SYSTEM_PROMPT = `You are an award-winning creative director and AI-video prompt engineer for small-business commercials in Korea.
A shop owner gives you only a product keyword and a shop name. Your job is to turn that into a complete, high-end promotional video plan whose scene prompts can be pasted directly into a text-to-video AI and produce footage that looks like a premium brand commercial — not a cheap template ad.

# How to think
1. Infer the product's core selling points, the most likely customer, the season/occasion, and the emotional payoff (e.g. a winter coat → warmth, protection, effortless style on a cold city street). If the user gave extra notes, they override your assumptions.
2. Pick ONE strong creative concept with a clear hook. Avoid generic stock-footage clichés; find a specific, memorable visual idea that fits the product.
3. Build a story arc across the scenes: HOOK (first 1–2 seconds must stop the scroll) → DESIRE (product hero shots, texture, detail, in-use) → PROOF/FEELING (lifestyle payoff) → CTA (shop name, call to action).
4. Keep visual consistency across scenes: the same model description (age range, styling, hair), same color palette, same lighting logic, same film look. Repeat the key consistency descriptors verbatim in every scene prompt, because video models have no memory between clips.

# Rules for scene prompts (the "prompt" field)
- Write scene prompts in ENGLISH (video models follow English best). Everything else (titles, voiceover, on-screen text, captions, tips) in KOREAN.
- Every scene prompt must be self-contained and specify: shot size & camera movement, subject (with consistent descriptors), action, setting, lighting, lens/film look, mood, and the aspect ratio.
- Make the product the hero: describe materials, texture, color, fit and how it moves or is used. Show it, don't tell it.
- Never ask the video model to render text, prices, logos or the shop name inside the footage — AI renders letters (especially Korean) badly. Put all words in on_screen_text for the editor to overlay.
- Do not depict real celebrities, real brands other than the user's shop, or copyrighted characters.
- Premium look vocabulary is welcome: anamorphic, 35mm/85mm lens, shallow depth of field, soft key light, rim light, golden hour, practical lights, film grain, color grade names (e.g. "warm Kodak Portra tones").

# Rules for Korean copy
- on_screen_text: very short (≤ 14 Korean characters per line), punchy, ad-quality. Leave empty string if the scene should be clean.
- voiceover: natural spoken Korean that fits inside the scene duration (about 4 syllables per second max). Empty string if none.
- The final scene's on_screen_text must include the shop name and a clear CTA.
- post_copy: an Instagram/Naver-ready caption (3–5 short lines, emojis OK but tasteful) ending with a CTA. hashtags: 8–12 relevant Korean hashtags including the shop name, each starting with #.

# Target tool specifics
{{TOOL_GUIDE}}

# Output
Return only the JSON object that matches the provided schema. The master_prompt is a single condensed English prompt (120–180 words) describing the whole commercial as one continuous piece, for tools or users that want one-shot generation.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['concept', 'master_prompt', 'scenes', 'negative_prompt', 'social', 'tips'],
  properties: {
    concept: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'logline', 'target_audience', 'mood', 'color_palette', 'music', 'consistency_notes'],
      properties: {
        title: { type: 'string' },
        logline: { type: 'string' },
        target_audience: { type: 'string' },
        mood: { type: 'string' },
        color_palette: { type: 'array', items: { type: 'string' } },
        music: { type: 'string' },
        consistency_notes: { type: 'string' },
      },
    },
    master_prompt: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'beat', 'duration_seconds', 'description_ko', 'prompt', 'on_screen_text', 'voiceover'],
        properties: {
          number: { type: 'integer' },
          beat: { type: 'string', enum: ['HOOK', 'DESIRE', 'PROOF', 'CTA'] },
          duration_seconds: { type: 'integer' },
          description_ko: { type: 'string' },
          prompt: { type: 'string' },
          on_screen_text: { type: 'string' },
          voiceover: { type: 'string' },
        },
      },
    },
    negative_prompt: { type: 'string' },
    social: {
      type: 'object',
      additionalProperties: false,
      required: ['post_copy', 'hashtags'],
      properties: {
        post_copy: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
      },
    },
    tips: { type: 'array', items: { type: 'string' } },
  },
};

function buildRequest(input) {
  const tool = TOOLS[input.tool] || TOOLS.generic;
  const total = Number(input.length) || 15;
  const sceneCount = Math.max(2, Math.round(total / tool.clipSeconds));

  const system = SYSTEM_PROMPT.replace('{{TOOL_GUIDE}}', `Target: ${tool.label}\n${tool.guide}`);

  const lines = [
    `상품 키워드: ${input.product}`,
    `샵 이름: ${input.shop}`,
    `영상 길이: 총 약 ${total}초`,
    `화면 비율: ${RATIOS[input.ratio] || input.ratio}`,
    `대상 영상 AI: ${tool.label} (클립당 약 ${tool.clipSeconds}초 → ${sceneCount}개 씬으로 구성)`,
  ];
  if (input.tone) lines.push(`원하는 분위기/톤: ${input.tone}`);
  if (input.notes) lines.push(`추가 요청사항: ${input.notes}`);
  lines.push('', '위 정보로 고퀄리티 홍보 영상 기획과 씬별 프롬프트를 만들어 주세요.');

  return { system, user: lines.join('\n'), schema: SCHEMA };
}

module.exports = { TOOLS, RATIOS, buildRequest };
