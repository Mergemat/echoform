import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { getServerRestartDelayMs } from "./server-supervisor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const port = Number(process.env.PORT || 3001);
const rendererUrl = process.env.ECHOFORM_RENDERER_URL?.trim() || null;
const useExternalServer = rendererUrl !== null;
const baseUrl = rendererUrl ?? `http://127.0.0.1:${port}`;

let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverReady = false;
let serverRestartAttempt = 0;
let serverRestartTimer = null;
let serverLaunchInFlight = false;
let isQuitting = false;
const serverReadyWaiters = new Set();

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    }

    if (!signal) {
      return;
    }

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveResourcesRoot() {
  return app.isPackaged ? process.resourcesPath : projectRoot;
}

function resolveServerProcess() {
  if (app.isPackaged) {
    return {
      command: join(process.resourcesPath, "bin", "echoform-server"),
      args: [],
      cwd: process.resourcesPath,
    };
  }

  return {
    command: "bun",
    args: ["server/src/server.ts"],
    cwd: projectRoot,
  };
}

function clearServerRestartTimer() {
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer);
    serverRestartTimer = null;
  }
}

function notifyServerReady() {
  for (const resolve of serverReadyWaiters) {
    resolve();
  }
  serverReadyWaiters.clear();
}

function waitForHealthyServer() {
  if (serverReady) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    serverReadyWaiters.add(resolve);
  });
}

async function waitForServer(signal) {
  const timeoutMs = 15_000;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Server launch aborted");
    }

    try {
      const response = await fetch(`${baseUrl}/api/session`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(250, signal);
  }

  throw lastError ?? new Error("Timed out waiting for Echoform server");
}

function describeServerStop(code, signal) {
  if (signal === null) {
    return `server exited with code ${code ?? "unknown"}`;
  }
  return `server exited via signal ${signal}`;
}

function scheduleServerRestart(reason) {
  if (isQuitting || serverRestartTimer) {
    return;
  }

  const delayMs = getServerRestartDelayMs(serverRestartAttempt);
  serverRestartAttempt += 1;
  console.error(
    `[echoform] daemon stopped; restarting in ${delayMs}ms`,
    reason
  );
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    void startServer();
  }, delayMs);
}

async function startServer() {
  if (useExternalServer) {
    return waitForServer();
  }

  if (serverReady || serverProcess || serverLaunchInFlight) {
    return waitForHealthyServer();
  }

  clearServerRestartTimer();
  serverLaunchInFlight = true;
  const resourcesRoot = resolveResourcesRoot();
  const server = resolveServerProcess();
  const stateRoot = app.getPath("userData");
  const legacyStateRoot = join(app.getPath("appData"), "Ablegit");
  const launchAbort = new AbortController();
  let stopped = false;

  serverProcess = spawn(server.command, server.args, {
    cwd: server.cwd,
    env: {
      ...process.env,
      PORT: String(port),
      ECHOFORM_STATIC_DIR: join(resourcesRoot, "dist"),
      ECHOFORM_STATE_DIR: stateRoot,
      ABLEGIT_STATE_DIR: legacyStateRoot,
    },
    stdio: "inherit",
  });

  const child = serverProcess;
  const handleServerStop = (reason) => {
    if (stopped) {
      return;
    }
    stopped = true;
    serverReady = false;
    if (serverProcess === child) {
      serverProcess = null;
    }
    launchAbort.abort(reason);
    scheduleServerRestart(reason);
  };

  child.once("error", (error) => {
    handleServerStop(error);
  });

  child.once("exit", (code, signal) => {
    handleServerStop(new Error(describeServerStop(code, signal)));
  });

  try {
    await waitForServer(launchAbort.signal);
    if (stopped || serverProcess !== child) {
      return waitForHealthyServer();
    }
    serverReady = true;
    serverRestartAttempt = 0;
    notifyServerReady();
  } catch (error) {
    if (!(stopped || isQuitting)) {
      serverReady = false;
      if (serverProcess === child) {
        serverProcess = null;
      }
      child.kill("SIGTERM");
      scheduleServerRestart(error);
    }
  } finally {
    serverLaunchInFlight = false;
  }

  return waitForHealthyServer();
}

function createWindow() {
  if (mainWindow) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, "icon.png"),
    title: "Echoform",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f1014",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      sandbox: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  return mainWindow;
}

const loadingHtml = join(__dirname, "loading.html");

async function showWindow() {
  const window = createWindow();
  const currentUrl = window.webContents.getURL();
  const isShowingApp = currentUrl === `${baseUrl}/`;

  if (isShowingApp) {
    window.show();
    window.focus();
    return;
  }

  // Show the loading screen immediately so the window is visible
  await window.loadFile(loadingHtml);
  window.show();
  window.focus();

  // Wait for the server, then load the real app
  await startServer();
  await window.loadURL(baseUrl);
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
  if (tray) {
    return tray;
  }

  const trayMenu = Menu.buildFromTemplate([
    {
      label: "Open Echoform",
      click: () => {
        void showWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  const trayIconPath = join(__dirname, "iconTemplate.png");
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip("Echoform");
  tray.on("click", toggleWindow);
  tray.on("right-click", () => {
    tray?.popUpContextMenu(trayMenu);
  });

  return tray;
}

ipcMain.handle("echoform:pick-folder", async () => {
  const parentWindow = mainWindow ?? BrowserWindow.getFocusedWindow() ?? null;
  const result = await dialog.showOpenDialog(parentWindow, {
    title: "Choose a folder for Echoform to watch",
    buttonLabel: "Watch Folder",
    defaultPath: app.getPath("music"),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0] ?? null;
});

async function bootstrap() {
  createTray();
  createWindow();
  await showWindow();
}

const hasLock = app.requestSingleInstanceLock();

if (hasLock) {
  app.on("second-instance", () => {
    void showWindow();
  });

  app.whenReady().then(() => {
    void bootstrap().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      app.show();
      app.focus({ steal: true });
      dialog.showErrorBox("Echoform failed to start", message);
      app.quit();
    });
  });
} else {
  app.quit();
}

app.on("activate", () => {
  void showWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  clearServerRestartTimer();
  if (useExternalServer || !serverProcess) {
    return;
  }

  serverProcess.kill("SIGTERM");
});
