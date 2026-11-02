const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { publicOptions } = require('./src/metaprompt');
const { generate } = require('./src/generate');
const { makeCutout } = require('./src/cutout');

// 운영자 키: 개발 중에는 프로젝트 폴더, 설치본에서는 resources 폴더의 operator-key.txt
function getApiKey() {
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'operator-key.txt')
    : path.join(__dirname, 'operator-key.txt');
  try {
    // 안내 문구 등 다른 줄이 섞여 있어도 키(sk-ant-...)만 골라 읽음
    const match = fs.readFileSync(file, 'utf8').match(/sk-ant-[A-Za-z0-9_-]+/);
    if (match) return match[0];
  } catch {}
  return process.env.ANTHROPIC_API_KEY || null;
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

// ---- 생성 ----
ipcMain.handle('options', () => ({ ...publicOptions(), hasKey: Boolean(getApiKey()) }));

let currentAbort = null;
ipcMain.handle('cancel', () => currentAbort?.abort());

ipcMain.handle('generate', async (e, input) => {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: 'API 키가 없습니다. operator-key.txt를 넣고 다시 빌드해 주세요.' };

  const images = (input.images || []).map(({ id, role }) => ({ role, data: cutouts.get(id)?.aiBase64 })).filter((i) => i.data);
  currentAbort = new AbortController();
  try {
    return await generate({
      apiKey,
      input: { ...input, images },
      onDelta: (text) => !e.sender.isDestroyed() && e.sender.send('progress', text),
      signal: currentAbort.signal,
    });
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
