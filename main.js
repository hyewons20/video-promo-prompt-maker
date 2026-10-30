const { app, BrowserWindow, ipcMain, safeStorage, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk').default;
const { TOOLS, RATIOS, buildRequest } = require('./src/metaprompt');

const MODEL = 'claude-opus-5-5';
const configPath = () => path.join(app.getPath('userData'), 'config.json');

// ---- API 키 저장 (OS 키체인 기반 safeStorage로 암호화) ----
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

// 운영자 키: 개발 중에는 프로젝트 폴더, 설치본에서는 resources 폴더의 operator-key.txt
function getOperatorKey() {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'operator-key.txt')
    : path.join(__dirname, 'operator-key.txt');
  try {
    // 안내 문구 등 다른 줄이 섞여 있어도 키(sk-ant-...)만 골라 읽음
    const match = fs.readFileSync(file, 'utf8').match(/sk-ant-[A-Za-z0-9_-]+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

function getApiKey() {
  const operatorKey = getOperatorKey();
  if (operatorKey) return operatorKey;
  const cfg = readConfig();
  if (cfg.apiKey && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(cfg.apiKey, 'base64'));
    } catch {
      return null;
    }
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

function saveApiKey(key) {
  const cfg = readConfig();
  if (!key) delete cfg.apiKey;
  else cfg.apiKey = safeStorage.encryptString(key).toString('base64');
  fs.writeFileSync(configPath(), JSON.stringify(cfg));
}

// ---- 창 ----
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1115',
    title: '홍보영상 프롬프트 메이커',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---- IPC ----
let currentStream = null;

ipcMain.handle('options', () => ({
  tools: Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.label])),
  ratios: RATIOS,
  hasKey: Boolean(getApiKey()),
  operatorMode: Boolean(getOperatorKey()),
}));

ipcMain.handle('save-key', (_e, key) => {
  saveApiKey((key || '').trim());
  return Boolean(getApiKey());
});

ipcMain.handle('copy', (_e, text) => clipboard.writeText(text));

ipcMain.handle('export', async (e, { filename, content }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: filename,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
});

ipcMain.handle('cancel', () => {
  currentStream?.abort();
});

ipcMain.handle('generate', async (e, input) => {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'API 키가 설정되지 않았습니다. 오른쪽 위 ⚙ 설정에서 입력하거나 operator-key.txt를 넣어 주세요.' };

  const client = new Anthropic({ apiKey });
  const { system, user, schema } = buildRequest(input);
  const send = (channel, payload) => !e.sender.isDestroyed() && e.sender.send(channel, payload);

  try {
    currentStream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
    });

    currentStream.on('text', (delta) => send('progress', delta));
    const message = await currentStream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return { ok: false, error: '요청이 거절되었습니다. 키워드를 바꿔서 다시 시도해 주세요.' };
    }
    if (message.stop_reason === 'max_tokens') {
      return { ok: false, error: '응답이 너무 길어 중간에 잘렸습니다. 영상 길이를 줄여 다시 시도해 주세요.' };
    }
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { ok: true, result: JSON.parse(text) };
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) return { ok: false, error: '생성을 취소했습니다.' };
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: getOperatorKey() ? '서비스 인증에 실패했습니다. 운영자에게 문의해 주세요.' : 'API 키가 올바르지 않습니다. 설정에서 다시 입력해 주세요.' };
    }
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, error: '네트워크에 연결할 수 없습니다.' };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `API 오류 (${err.status}): ${err.message}` };
    if (err instanceof SyntaxError) return { ok: false, error: '응답을 해석하지 못했습니다. 다시 시도해 주세요.' };
    return { ok: false, error: String(err?.message || err) };
  } finally {
    currentStream = null;
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
