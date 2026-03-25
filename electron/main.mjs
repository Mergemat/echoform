import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
  nativeImage,
  shell,
} from 'electron';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const port = Number(process.env.PORT || 3001);
const baseUrl = `http://127.0.0.1:${port}`;

let mainWindow = null;
let tray = null;
let serverProcess = null;
let isQuitting = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveResourcesRoot() {
  return app.isPackaged ? process.resourcesPath : projectRoot;
}

function resolveServerProcess() {
  if (app.isPackaged) {
    return {
      command: join(process.resourcesPath, 'bin', 'ablegit-server'),
      args: [],
      cwd: process.resourcesPath,
    };
  }

  return {
    command: 'bun',
    args: ['server/src/server.ts'],
    cwd: projectRoot,
  };
}

async function waitForServer() {
  const timeoutMs = 15000;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/session`);
      if (response.ok) return;
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  throw lastError ?? new Error('Timed out waiting for Ablegit server');
}

async function startServer() {
  if (serverProcess) return;

  const resourcesRoot = resolveResourcesRoot();
  const server = resolveServerProcess();
  const stateRoot = app.getPath('userData');

  serverProcess = spawn(server.command, server.args, {
    cwd: server.cwd,
    env: {
      ...process.env,
      PORT: String(port),
      ABLEGIT_STATIC_DIR: join(resourcesRoot, 'dist'),
      ABLEGIT_STATE_DIR: stateRoot,
    },
    stdio: 'inherit',
  });

  serverProcess.once('exit', (code, signal) => {
    serverProcess = null;
    if (isQuitting) return;

    app.show();
    app.focus({ steal: true });
    const detail =
      signal !== null
        ? `server exited via signal ${signal}`
        : `server exited with code ${code ?? 'unknown'}`;
    dialog.showErrorBox('Ablegit stopped', detail);
  });

  await waitForServer();
}

function createWindow() {
  if (mainWindow) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: 'Ablegit',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1014',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

async function showWindow() {
  const window = createWindow();
  if (window.webContents.getURL() !== `${baseUrl}/`) {
    await window.loadURL(baseUrl);
  }

  window.show();
  window.focus();
}

function toggleWindow() {
  const window = createWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }

  void showWindow();
}

function createTray() {
  if (tray) return tray;

  const trayMenu = Menu.buildFromTemplate([
    {
      label: 'Open Ablegit',
      click: () => {
        void showWindow();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('Ablegit');
  tray.setToolTip('Ablegit');
  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    tray?.popUpContextMenu(trayMenu);
  });

  return tray;
}

async function bootstrap() {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  await startServer();
  createTray();
  createWindow();
  await showWindow();
}

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void showWindow();
  });

  app.whenReady().then(() => {
    void bootstrap().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      app.show();
      app.focus({ steal: true });
      dialog.showErrorBox('Ablegit failed to start', message);
      app.quit();
    });
  });
}

app.on('activate', () => {
  void showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (!serverProcess) return;

  serverProcess.kill('SIGTERM');
});
