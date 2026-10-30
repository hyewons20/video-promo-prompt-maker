const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hidden', !on);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let lastInput = null;
let lastResult = null;
let streamedChars = 0;

const LOADING_STEPS = [
  '크리에이티브 디렉터가 콘셉트를 구상하고 있어요…',
  '타깃 고객과 셀링 포인트를 분석 중…',
  '스크롤을 멈추게 할 첫 장면을 고르는 중…',
  '씬별 카메라·조명·연출을 설계하는 중…',
  '자막과 내레이션을 다듬는 중…',
];

async function init() {
  const opts = await window.api.options();
  $('tool').innerHTML = Object.entries(opts.tools).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  $('ratio').innerHTML = Object.entries(opts.ratios).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  show($('keyWarn'), !opts.hasKey);
  show($('settingsBtn'), !opts.operatorMode); // 운영자 키가 있으면 고객에게 키 설정을 숨김

  window.api.onProgress((delta) => {
    streamedChars += delta.length;
    $('loadingText').textContent = `프롬프트 작성 중… (${streamedChars.toLocaleString()}자)`;
  });
}

// ---- 설정 ----
$('settingsBtn').onclick = () => {
  $('apiKey').value = '';
  $('settings').showModal();
};
$('saveKeyBtn').onclick = async (e) => {
  e.preventDefault();
  const has = await window.api.saveKey($('apiKey').value);
  show($('keyWarn'), !has);
  $('settings').close();
};

// ---- 생성 ----
$('form').onsubmit = async (e) => {
  e.preventDefault();
  const input = {
    product: $('product').value.trim(),
    shop: $('shop').value.trim(),
    length: $('length').value,
    ratio: $('ratio').value,
    tool: $('tool').value,
    tone: $('tone').value.trim(),
    notes: $('notes').value.trim(),
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
  lastInput = input;
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

// ---- 결과 렌더링 ----
function copyBtn(text) {
  return `<button class="copy" data-copy="${esc(text)}">복사</button>`;
}

function swatch(color) {
  const hex = String(color).match(/#[0-9a-fA-F]{3,8}/);
  return hex ? `<span class="swatch" style="background:${hex[0]}"></span>` : '';
}

function renderResult(r, input) {
  const c = r.concept;
  const scenes = r.scenes
    .map(
      (s) => `
      <div class="card">
        <div class="card-head">
          <div class="card-title"><span class="beat ${esc(s.beat)}">${esc(s.beat)}</span> 씬 ${s.number} · ${s.duration_seconds}초</div>
          ${copyBtn(s.prompt)}
        </div>
        <p class="desc">${esc(s.description_ko)}</p>
        <pre class="prompt">${esc(s.prompt)}</pre>
        <div class="meta">
          <div><small>화면 자막</small>${esc(s.on_screen_text) || '<span style="color:var(--muted)">—</span>'}</div>
          <div><small>내레이션</small>${esc(s.voiceover) || '<span style="color:var(--muted)">—</span>'}</div>
        </div>
      </div>`
    )
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

    <div class="section-title">씬별 프롬프트 (${r.scenes.length}개 씬 · 각각 영상 AI에 붙여넣기)</div>
    ${scenes}

    <div class="section-title">원샷 마스터 프롬프트</div>
    <div class="card">
      <div class="card-head"><div class="card-title">전체 광고를 한 번에</div>${copyBtn(r.master_prompt)}</div>
      <pre class="prompt">${esc(r.master_prompt)}</pre>
    </div>

    <div class="section-title">네거티브 프롬프트</div>
    <div class="card">
      <div class="card-head"><div class="card-title">피해야 할 요소</div>${copyBtn(r.negative_prompt)}</div>
      <pre class="prompt">${esc(r.negative_prompt)}</pre>
    </div>

    <div class="section-title">일관성 유지 메모</div>
    <div class="card"><p class="desc" style="margin:0">${esc(c.consistency_notes)}</p></div>

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

  $('copyAllBtn').onclick = (e) => flashCopy(e.currentTarget, toMarkdown(r, input));
  $('exportBtn').onclick = () =>
    window.api.exportFile(`${input.shop}_${input.product}_영상프롬프트.md`.replace(/[\\/:*?"<>|]/g, ''), toMarkdown(r, input));
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

function toMarkdown(r, input) {
  const c = r.concept;
  const out = [
    `# ${c.title}`,
    `> ${c.logline}`,
    '',
    `- 상품: ${input.product} / 샵: ${input.shop}`,
    `- 길이: ${input.length}초 / 비율: ${input.ratio} / 대상 AI: ${input.tool}`,
    `- 타깃: ${c.target_audience}`,
    `- 무드: ${c.mood}`,
    `- 컬러: ${c.color_palette.join(', ')}`,
    `- 음악: ${c.music}`,
    `- 일관성 메모: ${c.consistency_notes}`,
    '',
    '## 씬별 프롬프트',
  ];
  for (const s of r.scenes) {
    out.push(
      '',
      `### 씬 ${s.number} [${s.beat}] · ${s.duration_seconds}초`,
      s.description_ko,
      '',
      '```',
      s.prompt,
      '```',
      `- 자막: ${s.on_screen_text || '—'}`,
      `- 내레이션: ${s.voiceover || '—'}`
    );
  }
  out.push(
    '',
    '## 원샷 마스터 프롬프트',
    '```',
    r.master_prompt,
    '```',
    '',
    '## 네거티브 프롬프트',
    '```',
    r.negative_prompt,
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
  return out.join('\n');
}

init();
