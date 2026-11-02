// 메타프롬프트 엔진: 키워드 + 참고 이미지 → Claude 요청 (system / content / 출력 스키마)

// 모든 툴 공통: 씬마다 FLUX 3 키프레임(첫 프레임 이미지) → 영상 AI 이미지-투-비디오
// LTX는 첫·끝 프레임 둘 다 넣는다 (ComfyUI video_ltx2_5_flf2v: LTXVAddGuide frame_idx 0 / -1)
const KEYFRAME_GUIDE = `# Keyframe prompts (FLUX 3 still images)
- keyframe_prompt = the FIRST frame of the scene. keyframe_end_prompt = the LAST frame of the scene (only when the target section says so; otherwise "").
- Describe ONE frozen instant. No motion, no time passing, no "slow motion", no camera movement words.
- Order: main subject first → composition & framing (state the aspect ratio, e.g. "in a vertical 9:16 frame") → setting → lighting → lens & aperture → color grade / film look.
- FLUX 3 does not use a negative prompt. Rewrite anything to avoid as a positive statement (e.g. instead of "no logo" write "the cup surface is completely blank and clean").
- You may specify palette colors with HEX codes inline, e.g. "warm walnut wood counter (#6B4A33)".
- 90–150 words. Photographic, specific, premium.
- Product recognizability: whenever the product is in frame, show it in its true, recognizable form with its silhouette clearly readable (the product shape lock). State the count explicitly ("a single sock", "one coat"). Choose a viewpoint that reveals the silhouette (side profile or flat top-down for flat goods); avoid angles, folds, rolls or crops that hide what the product is.
- If the user attached reference images, the user will feed the cutout image into FLUX 3 as an image reference. Place that exact item in the frame and describe it with its lock phrase.`;

const TOOLS = {
  ltx: {
    label: 'FLUX 3 → LTX-2.5 (첫·끝 프레임 → 영상)',
    clipSeconds: 8,
    // LTX 2.4+ (Gemma 4 인코더) 학습 캡션 스타일 — ComfyUI nodes_textgen.py LTX24_I2V_SYSTEM_PROMPT 기준
    guide: `- Workflow: every scene uses LTX-2.5 FIRST-AND-LAST-FRAME to video. Write BOTH keyframe_prompt (first frame) and keyframe_end_prompt (last frame) for EVERY scene, not only for special shots.
- The two keyframes are the same continuous take: same location, same lighting, same lock phrases, same lens. The camera position may differ only by the camera move described in the video prompt (e.g. a slow push-in → the last frame is slightly tighter). Only the action changes between them, so LTX interpolates natural motion instead of morphing or cutting.
- The last frame must be the scene's clearest product moment: the product fully visible in its recognizable shape, resting naturally, with the empty area for on-screen text when it is the CTA scene.
- video_prompt follows the LTX-2.5 training-caption style (Lightricks' official prompt guide):
  1. One single continuous paragraph in English, roughly 150–220 words of narration plus the verbatim lock phrases (about 280 words at most in total; keep the non-lock narration concise rather than shortening lock phrases). No headings, no bullet points, no labels such as "Audio:" or "Visual:", no timestamps, no cuts — one continuous take.
  2. Begin immediately with the visual description. Never write "The scene opens…", "We see…", "There is…", "The video starts…".
  3. First-frame grounding: the opening sentences match the first keyframe exactly (same subject, lock phrases, setting, lighting, composition). The closing sentences arrive exactly at the last keyframe's state.
  4. Weave into the prose, never as tags: exactly one shot type (extreme wide shot / wide shot / medium shot / medium close-up / close-up / extreme close-up), the camera motion (always stated; if none, say the camera remains static), and the viewpoint (front-facing / side view / top-down / low-angle / high-angle / over-the-shoulder). Example: "a close-up frames…, captured from a top-down angle as the camera slowly pushes in…".
  5. Strict real-time chronology with transitions such as "Initially…", "A moment later…", "Simultaneously…", "Finally…". Use present-progressive verbs ("is lifting", "is settling"). Keep the action simple enough to finish within the clip.
  6. Objective and observable only: describe visible actions and audible sounds, not emotions or intentions (not "she feels cozy" but "her shoulders relax and her toes curl slowly"). No smell, taste or touch.
  7. Restrained, natural wording: plain colors ("oatmeal sock", not "vibrant"), neutral light ("soft morning window light"), no exaggerated adjectives.
  8. Sound woven chronologically into the paragraph alongside the actions that make it (e.g. "…sets the cup down with a soft ceramic clink while quiet room tone continues"), matching action tempo. Use the ambience lock phrase in every scene. SFX and ambience only — narration and music are added in editing, so no speech, singing or music in the prompt.
  9. Add a few production-quality descriptors woven into the prose ("warm cinematic lighting", "crisp fine knit texture", "film-grade color") without adding new objects or actions.
- LTX-2.5 has a negative prompt field: make negative_prompt a thorough comma-separated list (text, logos, watermark, distorted hands, extra fingers, morphing objects, flicker, camera shake, sudden cuts, CGI look, music, speech, etc.) PLUS the shape failures typical for this product (e.g. socks: "tube shape, shorts shape, legwarmer, two joined cuffs, missing heel"; coat: "cape shape, missing sleeves").
- settings_ko: "LTX-2.5 첫·끝 프레임 워크플로(ComfyUI 템플릿 video_ltx2_5_flf2v) / 첫 프레임 = 키프레임 시작, 끝 프레임 = 키프레임 끝 / 9:16 / 8초" plus trimming if the scene is shorter. If a scene must be shorter than the clip length, set generate_seconds to 8.`,
  },
  veo: {
    label: 'Google Veo 3',
    clipSeconds: 8,
    guide: `- Video model: Veo 3 (~8-second clips WITH native audio), used image-to-video from the keyframe when possible.
- Use cinematic vocabulary for camera and motion. End every video prompt with an "Audio:" line (ambience, SFX, music feel). Reuse the same ambience and voice lock phrases in every scene.
- Spoken lines, if any, as: The woman says in Korean: "..." — short enough for the clip, and always with the same voice lock phrase.`,
  },
  sora: {
    label: 'OpenAI Sora 2',
    clipSeconds: 10,
    guide: `- Video model: Sora 2. Write each video prompt as a short film direction: style first, then camera, then action beats in order, then a "Sound:" sentence that reuses the sound lock phrases.
- Describe physical details precisely (fabric, liquid, light behavior). No real people's likeness or trademarked characters.`,
  },
  kling: {
    label: 'Kling',
    clipSeconds: 5,
    guide: `- Video model: Kling, image-to-video from the keyframe. Order: subject + motion + camera movement + lighting + style. 40–80 words, one main action per clip.
- Kling has a negative prompt field: make negative_prompt specific (distorted hands, warped fabric, flicker, extra fingers, text artifacts…).`,
  },
  runway: {
    label: 'Runway Gen-4',
    clipSeconds: 5,
    guide: `- Video model: Runway Gen-4, image-to-video from the keyframe. Video prompts describe ONLY motion and camera (the image carries the look), 30–70 words, positive phrasing only. Keep negative_prompt short.`,
  },
  generic: {
    label: '범용 (어떤 영상 AI든)',
    clipSeconds: 8,
    guide: `- Tool-agnostic video prompts that work as text-to-video or image-to-video: [camera] + [subject with lock phrases] + [action in order] + [setting] + [lighting] + [look] + [mood], ending with an "Audio:" sentence. 60–110 words.`,
  },
};

const RATIOS = {
  '9:16': '세로 9:16 (릴스·쇼츠·틱톡)',
  '16:9': '가로 16:9 (유튜브·웹)',
  '1:1': '정사각 1:1 (피드)',
};

const LENGTHS = [15, 30, 60];

const IMAGE_ROLES = {
  product: '상품',
  person: '모델/인물',
  space: '매장/공간',
};

const SYSTEM_PROMPT = `You are an award-winning creative director and AI-video prompt engineer for small-business commercials in Korea.
A shop owner gives you a product keyword and a shop name (sometimes reference images). You turn that into a complete, premium promotional video plan whose prompts can be pasted directly into image and video AIs and produce footage that looks like a high-end brand commercial — not a cheap template ad.

# How to think
1. Infer the product's core selling points, the most likely customer, the season/occasion and the emotional payoff. Extra notes from the user override your assumptions.
2. Pick ONE strong, specific creative concept with a scroll-stopping hook. Avoid stock-footage clichés.
   - By default, do NOT use transformation, disguise or reveal concepts: no product disguised as something else (e.g. socks rolled up to look like a cinnamon roll), no objects morphing into the product, no magic transitions, no "it was actually…" twists. AI video models lose the product's shape in these shots. Use them only if the user's tone or notes explicitly ask for a transformation, twist or reveal.
   - Instead, show the real product in its recognizable form from the first frame it appears in, and get the hook from staging, light, texture, a striking composition, a satisfying natural action, or a relatable human moment.
3. Story arc: HOOK (the first 1–2 seconds must stop the scroll) → DESIRE (product hero, texture, detail, in use) → PROOF (lifestyle payoff) → CTA (shop name + call to action). Short videos may merge beats, but always start with HOOK and end with CTA.

# Consistency locks (most important)
Image and video models have no memory between cuts, so the same product, person, place and sound drift unless they are described with the exact same words every time.
- Define "locks": short, precise English phrases for every element that appears in more than one scene, plus the overall look and the soundscape. Kinds:
  - product: the exact item, written so the product is recognizable from its outline alone. Start with count + silhouette and structural parts in spatial terms, then material, color with HEX and distinctive details (e.g. "a single crew sock, L-shaped in side profile with a cupped heel at the bend, a rounded toe and a ribbed cuff reaching mid-calf, soft oatmeal cotton knit (#D8C7AE) with one thin terracotta stripe (#C0623B) at the cuff"). Material and color alone are not enough. Keep it unbranded unless it is the shop's own product.
  - person: the same model (approximate age, ethnicity if relevant, hair, clothing). Never a real or famous person.
  - set: the main surface/location.
  - lighting: one lighting logic for the whole film.
  - look: lens family, color grade, film texture.
  - ambience: the background soundscape used in every Audio line.
  - voice: only if the video model speaks lines; one voice description reused verbatim.
- Every keyframe_prompt, keyframe_end_prompt and video_prompt that shows an element MUST contain its lock phrase copied VERBATIM (same words, same order). List those lock ids in lock_ids. The lighting, look and ambience locks apply to every scene.
- In keyframe_reference_ko, tell the user which image to feed as reference for that scene's keyframes (e.g. "업로드한 상품 누끼 이미지", "씬1 끝 프레임 이미지") so the same product/person carries over visually. The end keyframe of a scene uses that scene's first keyframe as reference. From scene 2 on, always reuse an earlier keyframe or the uploaded cutout as reference when the same product or person appears.
- Music: recommend ONE continuous music track added in editing (not generated per clip), so sound does not jump between cuts.

# Single-take reliability
- Write every prompt so it works on the first generation. Never tell the user to generate several candidates or variations, try multiple seeds, re-roll, or pick the best take — not in tips, settings_ko or keyframe_reference_ko. Put the reliability into the prompts themselves (clear shape, simple action, stable camera, matching first/last frames).

# Reference images
If images are attached, they are background-removed cutouts the shop owner supplied, each with a role (product / person / space).
- Build the matching lock phrase from what you SEE: exact shape, material, colors (estimate HEX), details. Do not invent features that are not visible. Do not try to identify who a person is; describe only visible appearance and clothing.
- The concept must feature that exact product. The keyframe prompts must stage it so the cutout can be used as the image reference.

# Prompt language and text rules
- keyframe_prompt, keyframe_end_prompt, video_prompt, negative_prompt, oneshot_prompt and lock phrases: ENGLISH.
- keyframe_end_prompt: write it only when the video section below asks for a last frame; otherwise return "".
- Everything else (titles, descriptions, settings, on-screen text, voiceover, captions, tips): KOREAN.
- Never ask image/video models to render text, prices, logos or the shop name — AI renders letters (especially Korean) badly. All words go into on_screen_text for the editor to overlay. Leave clean empty space in the frame where CTA text will sit.

{{KEYFRAME_GUIDE}}

# Video prompts
Target: {{TOOL_LABEL}}
{{TOOL_GUIDE}}

# Korean copy
- on_screen_text: very short (≤ 14 Korean characters per line, use " / " between lines), ad-quality. "" if the scene should be clean. The final scene must include the shop name and a CTA.
- voiceover: natural spoken Korean that fits the scene duration (max ~4 syllables per second). "" if none.
- settings_ko: generation settings for the video tool (mode, ratio, length, trimming).
- social.post_copy: Instagram/Naver caption, 3–5 short lines, tasteful emojis OK, ends with a CTA. hashtags: 8–12 Korean hashtags including the shop name, each starting with #.
- tips: 4–6 concrete production tips (generation order, hook timing, music, text overlay font/color, cover frame).

# Output
Return only the JSON object matching the schema. oneshot_prompt is a single 120–180 word text-to-video prompt for the whole commercial (lower consistency than the per-scene workflow; for quick tests).`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['concept', 'locks', 'scenes', 'negative_prompt', 'oneshot_prompt', 'social', 'tips'],
  properties: {
    concept: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'logline', 'target_audience', 'mood', 'color_palette', 'music'],
      properties: {
        title: { type: 'string' },
        logline: { type: 'string' },
        target_audience: { type: 'string' },
        mood: { type: 'string' },
        color_palette: { type: 'array', items: { type: 'string' } },
        music: { type: 'string' },
      },
    },
    locks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'label_ko', 'phrase'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['product', 'person', 'set', 'lighting', 'look', 'ambience', 'voice'] },
          label_ko: { type: 'string' },
          phrase: { type: 'string' },
        },
      },
    },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'number', 'beat', 'duration_seconds', 'generate_seconds', 'description_ko', 'lock_ids',
          'keyframe_prompt', 'keyframe_end_prompt', 'keyframe_reference_ko', 'video_prompt', 'settings_ko', 'on_screen_text', 'voiceover',
        ],
        properties: {
          number: { type: 'integer' },
          beat: { type: 'string', enum: ['HOOK', 'DESIRE', 'PROOF', 'CTA'] },
          duration_seconds: { type: 'integer' },
          generate_seconds: { type: 'integer' },
          description_ko: { type: 'string' },
          lock_ids: { type: 'array', items: { type: 'string' } },
          keyframe_prompt: { type: 'string' },
          keyframe_end_prompt: { type: 'string' },
          keyframe_reference_ko: { type: 'string' },
          video_prompt: { type: 'string' },
          settings_ko: { type: 'string' },
          on_screen_text: { type: 'string' },
          voiceover: { type: 'string' },
        },
      },
    },
    negative_prompt: { type: 'string' },
    oneshot_prompt: { type: 'string' },
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

// 입력 검증: 서버는 이 형태의 요청만 받아서 범용 Claude 프록시로 악용되지 않게 한다
const MAX_TEXT = { product: 60, shop: 40, tone: 120, notes: 500 };
const MAX_IMAGES = 3;
const MAX_IMAGE_B64 = 2_000_000; // 이미지 1장 base64 약 1.5MB

function validateInput(body) {
  if (!body || typeof body !== 'object') return '요청 형식이 올바르지 않습니다.';
  for (const [k, max] of Object.entries(MAX_TEXT)) {
    const v = body[k] ?? '';
    if (typeof v !== 'string' || v.length > max) return `${k} 값이 너무 깁니다 (최대 ${max}자).`;
  }
  if (!body.product?.trim() || !body.shop?.trim()) return '상품 키워드와 샵 이름은 필수입니다.';
  if (!TOOLS[body.tool]) return '지원하지 않는 영상 AI입니다.';
  if (!RATIOS[body.ratio]) return '지원하지 않는 화면 비율입니다.';
  if (!LENGTHS.includes(Number(body.length))) return '지원하지 않는 영상 길이입니다.';
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return `참고 이미지는 최대 ${MAX_IMAGES}장입니다.`;
  for (const img of images) {
    if (!IMAGE_ROLES[img?.role]) return '참고 이미지 종류가 올바르지 않습니다.';
    if (typeof img.data !== 'string' || img.data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(img.data)) {
      return '참고 이미지가 너무 크거나 형식이 올바르지 않습니다.';
    }
  }
  return null;
}

function buildRequest(input) {
  const tool = TOOLS[input.tool];
  const total = Number(input.length);
  const sceneCount = Math.max(2, Math.round(total / tool.clipSeconds));
  const images = input.images ?? [];

  const system = SYSTEM_PROMPT.replace('{{KEYFRAME_GUIDE}}', KEYFRAME_GUIDE)
    .replace('{{TOOL_LABEL}}', tool.label)
    .replace('{{TOOL_GUIDE}}', tool.guide);

  const lines = [
    `상품 키워드: ${input.product.trim()}`,
    `샵 이름: ${input.shop.trim()}`,
    `영상 길이: 총 약 ${total}초`,
    `화면 비율: ${RATIOS[input.ratio]}`,
    `대상: ${tool.label} (클립당 약 ${tool.clipSeconds}초 → ${sceneCount}개 씬으로 구성)`,
  ];
  if (input.tone?.trim()) lines.push(`원하는 분위기/톤: ${input.tone.trim()}`);
  if (input.notes?.trim()) lines.push(`추가 요청사항: ${input.notes.trim()}`);
  if (images.length) {
    lines.push(`첨부한 참고 이미지(누끼): ${images.map((img, i) => `이미지 ${i + 1} = ${IMAGE_ROLES[img.role]}`).join(', ')}`);
  }
  lines.push('', '위 정보로 고퀄리티 홍보 영상 기획과 씬별 키프레임·영상 프롬프트를 만들어 주세요.');

  const content = [
    ...images.flatMap((img, i) => [
      { type: 'text', text: `이미지 ${i + 1} (${IMAGE_ROLES[img.role]}):` },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img.data } },
    ]),
    { type: 'text', text: lines.join('\n') },
  ];

  return { system, content, schema: SCHEMA };
}

function publicOptions() {
  return {
    tools: Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.label])),
    ratios: RATIOS,
    lengths: LENGTHS,
    imageRoles: IMAGE_ROLES,
    maxImages: MAX_IMAGES,
  };
}

module.exports = { validateInput, buildRequest, publicOptions };
