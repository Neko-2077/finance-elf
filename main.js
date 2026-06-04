/**
 * 财报精灵 — Electron 主进程
 * 
 * 复用「法典」已验证架构，完全不依赖 EasyClaw
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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
  return result;
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
