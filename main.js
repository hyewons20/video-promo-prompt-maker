const { app, BrowserWindow, ipcMain, safeStorage, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { SERVER_URL } = require('./src/config');
const { makeCutout } = require('./src/cutout');

// 앱에는 API 키가 없다. 중계 서버에 초대 코드로만 접속한다.
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

// ---- 초대 코드 저장 (OS 키체인 기반 safeStorage로 암호화) ----
function getCode() {
  const cfg = readConfig();
  if (!cfg.code || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(cfg.code, 'base64'));
  } catch {
    return null;
  }
}

function saveCode(code) {
  const cfg = readConfig();
  delete cfg.apiKey; // v1에서 남은 키 정보 정리
  if (!code) delete cfg.code;
  else cfg.code = safeStorage.encryptString(code).toString('base64');
  fs.writeFileSync(configPath(), JSON.stringify(cfg));
}

// ---- 창 ----
function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 660,
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

// ---- 서버 통신 ----
async function readError(res) {
  try {
    return (await res.json()).error || `서버 오류 (${res.status})`;
  } catch {
    return `서버 오류 (${res.status})`;
  }
}

ipcMain.handle('options', async () => {
  const code = getCode();
  if (!code) return { ok: false, needCode: true };
  try {
    const res = await fetch(`${SERVER_URL}/options`, { headers: { authorization: `Bearer ${code}` } });
    if (res.status === 401) return { ok: false, needCode: true, error: await readError(res) };
    if (!res.ok) return { ok: false, error: await readError(res) };
    return { ok: true, options: await res.json() };
  } catch {
    return { ok: false, error: '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.' };
  }
});

ipcMain.handle('save-code', (_e, code) => saveCode((code || '').trim().toUpperCase()));

let currentAbort = null;
ipcMain.handle('cancel', () => currentAbort?.abort());

ipcMain.handle('generate', async (e, input) => {
  const code = getCode();
  if (!code) return { ok: false, error: '초대 코드를 먼저 입력해 주세요.' };
  const send = (channel, payload) => !e.sender.isDestroyed() && e.sender.send(channel, payload);

  const images = (input.images || []).map(({ id, role }) => ({ role, data: cutouts.get(id)?.aiBase64 })).filter((i) => i.data);
  currentAbort = new AbortController();
  try {
    const res = await fetch(`${SERVER_URL}/generate`, {
      method: 'POST',
      headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, images }),
      signal: currentAbort.signal,
    });
    if (!res.ok) return { ok: false, error: await readError(res) };

    // NDJSON 스트림 읽기
    let text = '';
    let buffer = '';
    let done = null;
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'delta') {
          text += event.text;
          send('progress', event.text);
        } else if (event.type === 'error') {
          return { ok: false, error: event.error };
        } else if (event.type === 'done') {
          done = event;
        }
      }
    }

    if (!done) return { ok: false, error: '응답이 중간에 끊겼습니다. 다시 시도해 주세요.' };
    if (done.stop_reason === 'refusal') return { ok: false, error: '요청이 거절되었습니다. 키워드를 바꿔서 다시 시도해 주세요.' };
    if (done.stop_reason === 'max_tokens') return { ok: false, error: '응답이 너무 길어 잘렸습니다. 영상 길이를 줄여 다시 시도해 주세요.' };
    return { ok: true, result: JSON.parse(text) };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: '생성을 취소했습니다.' };
    if (err instanceof SyntaxError) return { ok: false, error: '응답을 해석하지 못했습니다. 다시 시도해 주세요.' };
    return { ok: false, error: '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.' };
  } finally {
    currentAbort = null;
  }
});

// ---- 참고 이미지 누끼 ----
const cutouts = new Map(); // id → { cutout: Buffer, aiBase64, name }

ipcMain.handle('pick-image', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (canceled || !filePaths[0]) return null;
  try {
    const { cutout, aiBase64 } = await makeCutout(filePaths[0]);
    const id = crypto.randomUUID();
    cutouts.set(id, { cutout, aiBase64, name: path.parse(filePaths[0]).name });
    return { ok: true, id, preview: `data:image/png;base64,${cutout.toString('base64')}` };
  } catch (err) {
    console.error('cutout failed', err);
    return { ok: false, error: '이미지 배경 제거에 실패했습니다. 다른 이미지로 시도해 주세요.' };
  }
});

ipcMain.handle('remove-image', (_e, id) => cutouts.delete(id));

ipcMain.handle('save-cutout', async (e, id) => {
  const item = cutouts.get(id);
  if (!item) return false;
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${item.name}_누끼.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, item.cutout);
  return true;
});

// ---- 기타 ----
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
