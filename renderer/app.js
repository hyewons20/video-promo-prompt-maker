const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hidden', !on);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LOCK_KINDS = {
  product: '상품', person: '인물', set: '배경', lighting: '조명', look: '톤/룩', ambience: '사운드', voice: '목소리',
};

let options = null;
let images = []; // { id, role, preview }
let lastResult = null;
let streamedChars = 0;

const LOADING_STEPS = [
  '크리에이티브 디렉터가 콘셉트를 구상하고 있어요…',
  '상품·인물·사운드 일관성 문구를 고정하는 중…',
  '스크롤을 멈추게 할 첫 장면을 고르는 중…',
  '씬별 키프레임과 카메라 움직임을 설계하는 중…',
  '자막과 내레이션을 다듬는 중…',
];

// ---- 옵션 불러오기 ----
async function loadOptions() {
  options = await window.api.options();
  const fill = (el, entries) => (el.innerHTML = entries.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''));
  fill($('tool'), Object.entries(options.tools));
  fill($('ratio'), Object.entries(options.ratios));
  fill($('length'), options.lengths.map((n) => [n, `${n}초`]));
  $('length').value = options.lengths.includes(15) ? '15' : String(options.lengths[0]);
  warn(options.hasKey ? '' : 'API 키가 없습니다. operator-key.txt를 넣고 다시 빌드해 주세요.');
  renderImages();
}

function warn(msg) {
  $('formWarn').textContent = msg || '';
  show($('formWarn'), Boolean(msg));
}

// ---- 참고 이미지 ----
$('addImageBtn').onclick = async () => {
  if (!options || images.length >= options.maxImages) return;
  const btn = $('addImageBtn');
  btn.disabled = true;
  btn.textContent = '누끼 따는 중…';
  const res = await window.api.pickImage();
  btn.disabled = false;
  btn.textContent = '+ 추가';
  if (!res) return;
  if (!res.ok) return warn(res.error);
  warn('');
  images.push({ id: res.id, role: images.some((i) => i.role === 'product') ? 'person' : 'product', preview: res.preview });
  renderImages();
};

function renderImages() {
  const roles = options?.imageRoles || {};
  $('images').innerHTML = images
    .map(
      (img) => `
      <div class="img-item" data-id="${img.id}">
        <img class="thumb" src="${img.preview}" alt="누끼 미리보기" />
        <div>
          <select data-role>${Object.entries(roles)
            .map(([v, l]) => `<option value="${v}" ${v === img.role ? 'selected' : ''}>${esc(l)}</option>`)
            .join('')}</select>
          <div class="img-actions">
            <button type="button" data-save>누끼 PNG 저장</button>
            <button type="button" data-remove>삭제</button>
          </div>
        </div>
      </div>`
    )
    .join('');
  $('addImageBtn').disabled = !options || images.length >= (options?.maxImages ?? 0);
  show($('imageHint'), images.length === 0);
}

$('images').addEventListener('change', (e) => {
  const item = e.target.closest('.img-item');
  if (item && e.target.matches('[data-role]')) images.find((i) => i.id === item.dataset.id).role = e.target.value;
});
$('images').addEventListener('click', async (e) => {
  const item = e.target.closest('.img-item');
  if (!item) return;
  const id = item.dataset.id;
  if (e.target.matches('[data-save]')) await window.api.saveCutout(id);
  if (e.target.matches('[data-remove]')) {
    await window.api.removeImage(id);
    images = images.filter((i) => i.id !== id);
    renderImages();
  }
});

// ---- 생성 ----
$('form').onsubmit = async (e) => {
  e.preventDefault();
  const input = {
    product: $('product').value.trim(),
    shop: $('shop').value.trim(),
    length: Number($('length').value),
    ratio: $('ratio').value,
    tool: $('tool').value,
    tone: $('tone').value.trim(),
    notes: $('notes').value.trim(),
    images: images.map(({ id, role }) => ({ id, role })),
  };
  if (!input.product || !input.shop) return;

  setBusy(true);
  const res = await window.api.generate(input);
  setBusy(false);

  if (!res.ok) {
    $('error').textContent = res.error;
    show($('error'));
    show($('empty'), !lastResult);
    show($('result'), Boolean(lastResult));
    return;
  }
  lastResult = res.result;
  renderResult(res.result, input);
};

$('cancelBtn').onclick = () => window.api.cancel();

let stepTimer = null;
function setBusy(busy) {
  $('genBtn').disabled = busy;
  show($('cancelBtn'), busy);
  show($('loading'), busy);
  show($('error'), false);
  if (busy) {
    show($('empty'), false);
    show($('result'), false);
    streamedChars = 0;
    let i = 0;
    $('loadingText').textContent = LOADING_STEPS[0];
    stepTimer = setInterval(() => {
      if (streamedChars > 0) return;
      i = (i + 1) % LOADING_STEPS.length;
      $('loadingText').textContent = LOADING_STEPS[i];
    }, 3500);
  } else {
    clearInterval(stepTimer);
  }
}

window.api.onProgress((delta) => {
  streamedChars += delta.length;
  $('loadingText').textContent = `프롬프트 작성 중… (${streamedChars.toLocaleString()}자)`;
});

// ---- 결과 렌더링 ----
const copyBtn = (text, label = '복사') => `<button class="copy" data-copy="${esc(text)}">${label}</button>`;

function swatch(color) {
  const hex = String(color).match(/#[0-9a-fA-F]{3,8}/);
  return hex ? `<span class="swatch" style="background:${hex[0]}"></span>` : '';
}

// 일관성 검사: 씬에서 쓴다고 한 락 문구가 프롬프트에 그대로 들어갔는지
function checkLocks(scene, locks) {
  const text = `${scene.keyframe_prompt}\n${scene.keyframe_end_prompt || ''}\n${scene.video_prompt}`.toLowerCase();
  const used = locks.filter((l) => scene.lock_ids.includes(l.id));
  const missing = used.filter((l) => !text.includes(l.phrase.toLowerCase()));
  return { total: used.length, missing };
}

function renderResult(r, input) {
  const c = r.concept;
  const toolLabel = options?.tools[input.tool] || input.tool;
  const videoLabel = toolLabel.replace(/\s*\(.*\)$/, '').split('→').pop().trim(); // "FLUX 3 → LTX-2.5 (…)" → "LTX-2.5"

  const locks = r.locks
    .map(
      (l) => `
      <div class="lock">
        <div class="lock-kind">${esc(LOCK_KINDS[l.kind] || l.kind)}<small>${esc(l.label_ko)}</small></div>
        <code>${esc(l.phrase)}</code>
        ${copyBtn(l.phrase)}
      </div>`
    )
    .join('');

  const scenes = r.scenes
    .map((s) => {
      const check = checkLocks(s, r.locks);
      const badge = check.missing.length
        ? `<span class="lockcheck bad" title="${esc(check.missing.map((m) => m.phrase).join('\n'))}">일관성 문구 ${check.missing.length}개 누락</span>`
        : `<span class="lockcheck ok">일관성 고정 ✓ ${check.total}/${check.total}</span>`;
      const gen = s.generate_seconds && s.generate_seconds !== s.duration_seconds ? ` (${s.generate_seconds}초 생성 후 트리밍)` : '';
      return `
      <div class="card">
        <div class="card-head">
          <div class="card-title"><span class="beat ${esc(s.beat)}">${esc(s.beat)}</span> 씬 ${s.number} · ${s.duration_seconds}초${esc(gen)}</div>
          ${badge}
        </div>
        <p class="desc">${esc(s.description_ko)}</p>

        ${s.keyframe_reference_ko ? `<p class="ref">📎 레퍼런스: ${esc(s.keyframe_reference_ko)}</p>` : ''}
        <div class="step"><span>① ${s.keyframe_end_prompt ? '첫 프레임' : '키프레임'} 이미지 (FLUX 3)</span>${copyBtn(s.keyframe_prompt)}</div>
        <pre class="prompt">${esc(s.keyframe_prompt)}</pre>
        ${
          s.keyframe_end_prompt
            ? `<div class="step"><span>② 끝 프레임 이미지 (FLUX 3)</span>${copyBtn(s.keyframe_end_prompt)}</div>
        <pre class="prompt">${esc(s.keyframe_end_prompt)}</pre>`
            : ''
        }

        <div class="step"><span>${s.keyframe_end_prompt ? '③' : '②'} 영상 (${esc(videoLabel)})</span>${copyBtn(s.video_prompt)}</div>
        <pre class="prompt">${esc(s.video_prompt)}</pre>
        ${s.settings_ko ? `<p class="settings-line">⚙ ${esc(s.settings_ko)}</p>` : ''}

        <div class="meta">
          <div><small>화면 자막 (편집에서 합성)</small>${esc(s.on_screen_text) || '<span style="color:var(--muted)">—</span>'}</div>
          <div><small>내레이션 (편집에서 합성)</small>${esc(s.voiceover) || '<span style="color:var(--muted)">—</span>'}</div>
        </div>
      </div>`;
    })
    .join('');

  $('result').innerHTML = `
    <div class="result-head">
      <div>
        <h2>${esc(c.title)}</h2>
        <p class="logline">${esc(c.logline)}</p>
      </div>
      <div class="actions">
        <button class="ghost" id="copyAllBtn">전체 복사</button>
        <button class="ghost" id="exportBtn">파일로 저장</button>
      </div>
    </div>
    <div class="chips">
      <span class="chip">타깃 <b>${esc(c.target_audience)}</b></span>
      <span class="chip">무드 <b>${esc(c.mood)}</b></span>
      <span class="chip">음악 <b>${esc(c.music)}</b></span>
      ${c.color_palette.map((p) => `<span class="chip">${swatch(p)}${esc(p)}</span>`).join('')}
    </div>

    <div class="section-title">🔒 일관성 고정 문구 — 모든 컷에 똑같이 들어가 상품·인물·소리가 유지돼요</div>
    <div class="locks">${locks}</div>

    <div class="section-title">씬별 프롬프트 (${r.scenes.length}개 씬 · ${r.scenes.some((s) => s.keyframe_end_prompt) ? '첫·끝 프레임 이미지' : '키프레임 이미지'} → 영상 순서로 생성)</div>
    ${scenes}

    <div class="section-title">네거티브 프롬프트 (영상 AI)</div>
    <div class="card">
      <div class="card-head"><div class="card-title">피해야 할 요소</div>${copyBtn(r.negative_prompt)}</div>
      <pre class="prompt">${esc(r.negative_prompt)}</pre>
    </div>

    <div class="section-title">(선택) 원샷 텍스트-투-비디오</div>
    <div class="card">
      <div class="card-head"><div class="card-title">이미지 없이 한 번에 — 일관성은 씬별 방식보다 낮아요</div>${copyBtn(r.oneshot_prompt)}</div>
      <pre class="prompt">${esc(r.oneshot_prompt)}</pre>
    </div>

    <div class="section-title">SNS 업로드 문구</div>
    <div class="card">
      <div class="card-head"><div class="card-title">게시글</div>${copyBtn(r.social.post_copy + '\n\n' + r.social.hashtags.join(' '))}</div>
      <p style="white-space:pre-wrap;line-height:1.7;margin:0 0 10px">${esc(r.social.post_copy)}</p>
      <div class="tags">${esc(r.social.hashtags.join(' '))}</div>
    </div>

    <div class="section-title">제작 팁</div>
    <div class="card"><ul class="tips">${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
  `;
  show($('result'));
  $('output').scrollTop = 0;

  $('copyAllBtn').onclick = (e) => flashCopy(e.currentTarget, toMarkdown(r, input, toolLabel));
  $('exportBtn').onclick = () =>
    window.api.exportFile(
      `${input.shop}_${input.product}_영상프롬프트.md`.replace(/[\\/:*?"<>|]/g, ''),
      toMarkdown(r, input, toolLabel)
    );
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (btn) flashCopy(btn, btn.dataset.copy);
});

async function flashCopy(btn, text) {
  await window.api.copy(text);
  const old = btn.textContent;
  btn.textContent = '복사됨 ✓';
  btn.classList.add('done');
  setTimeout(() => {
    btn.textContent = old;
    btn.classList.remove('done');
  }, 1200);
}

function toMarkdown(r, input, toolLabel) {
  const c = r.concept;
  const out = [
    `# ${c.title}`,
    `> ${c.logline}`,
    '',
    `- 상품: ${input.product} / 샵: ${input.shop}`,
    `- 길이: ${input.length}초 / 비율: ${input.ratio} / 대상: ${toolLabel}`,
    `- 타깃: ${c.target_audience}`,
    `- 무드: ${c.mood}`,
    `- 컬러: ${c.color_palette.join(', ')}`,
    `- 음악: ${c.music}`,
    '',
    '## 일관성 고정 문구 (모든 프롬프트에 동일하게 사용)',
    ...r.locks.map((l) => `- ${LOCK_KINDS[l.kind] || l.kind} (${l.label_ko}): \`${l.phrase}\``),
    '',
    '---',
  ];
  for (const s of r.scenes) {
    out.push(
      '',
      `## 씬 ${s.number} [${s.beat}] · ${s.duration_seconds}초`,
      s.description_ko,
      '',
      s.keyframe_reference_ko ? `- 레퍼런스: ${s.keyframe_reference_ko}` : '',
      `### ① ${s.keyframe_end_prompt ? '첫 프레임' : '키프레임'} 이미지 (FLUX 3)`,
      '```',
      s.keyframe_prompt,
      '```',
      ...(s.keyframe_end_prompt ? ['### ② 끝 프레임 이미지 (FLUX 3)', '```', s.keyframe_end_prompt, '```'] : []),
      `### ${s.keyframe_end_prompt ? '③' : '②'} 영상 (${toolLabel})`,
      '```',
      s.video_prompt,
      '```',
      s.settings_ko ? `- 설정: ${s.settings_ko}` : '',
      `- 자막(편집): ${s.on_screen_text || '—'}`,
      `- 내레이션(편집): ${s.voiceover || '—'}`
    );
  }
  out.push(
    '',
    '## 네거티브 프롬프트',
    '```',
    r.negative_prompt,
    '```',
    '',
    '## (선택) 원샷 텍스트-투-비디오',
    '```',
    r.oneshot_prompt,
    '```',
    '',
    '## SNS 업로드 문구',
    r.social.post_copy,
    '',
    r.social.hashtags.join(' '),
    '',
    '## 제작 팁',
    ...r.tips.map((t) => `- ${t}`)
  );
  return out.filter((l) => l !== '').join('\n').replace(/\n(#+ )/g, '\n\n$1');
}

loadOptions();
