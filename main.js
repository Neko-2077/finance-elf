/**
 * 财报精灵 — Electron 主进程
 * 
 * 复用「法典」已验证架构，完全不依赖 EasyClaw
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getApiKey, saveApiKey, runPipeline } = require('./pipeline-engine');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: '财报精灵 — AI 财务报表分析助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#f8fafc',
    show: false
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── IPC ──
ipcMain.handle('api:health', async () => {
  return { status: 'ok', version: '1.0.0' };
});

ipcMain.handle('api:save-key', async (_event, data) => {
  const key = typeof data === 'string' ? data : data.apiKey;
  saveApiKey(key);
  return { success: true };
});

ipcMain.handle('api:check-key', async () => {
  const key = getApiKey();
  return { hasKey: !!key, masked: key ? maskKey(key) : null };
});

ipcMain.handle('api:run-review', async (_event, data) => {
  const { content, fileName, pipelineType } = data;
  const result = await runPipeline(content, fileName, pipelineType);
  saveHistory(result, pipelineType, fileName);
  return result;
});

// ── 历史记录 ──
const HISTORY_FILE = path.join(app.getPath('userData'), 'review-history.json');
const MAX_HISTORY = 10;

function saveHistory(result, pipelineType, fileName) {
  let history = [];
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) { /* ignore corrupt file */ }
  history.unshift({
    id: Date.now(),
    time: new Date().toISOString(),
    pipelineType: pipelineType,
    fileName: fileName || '(手动输入)',
    result: result
  });
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (e) { console.error('[saveHistory] write failed:', e.message); }
}

ipcMain.handle('api:load-history', async () => {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) { return []; }
});

ipcMain.handle('api:load-latest', async () => {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return null;
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    return history.length > 0 ? history[0] : null;
  } catch (e) { return null; }
});

ipcMain.handle('api:export-file', async (_event, { content, defaultName, filters }) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters
  });
  if (result.canceled || !result.filePath) return { success: false };
  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// ── 生命周期 ──
app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
