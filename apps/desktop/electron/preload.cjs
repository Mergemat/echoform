"use strict";

function readAdditionalArgument(argv, name) {
  const prefix = `--${name}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  if (!match) {
    return;
  }

  const value = match.slice(prefix.length);
  return value || undefined;
}

function resolvePreloadConfig(argv = process.argv, env = process.env) {
  return {
    apiBaseUrl:
      readAdditionalArgument(argv, "echoform-api-base-url") ||
      env.ECHOFORM_API_URL ||
      undefined,
    appVersion:
      readAdditionalArgument(argv, "echoform-app-version") ||
      env.npm_package_version ||
      undefined,
    sessionBootstrapToken:
      readAdditionalArgument(argv, "echoform-session-bootstrap-token") ||
      env.ECHOFORM_SESSION_BOOTSTRAP_TOKEN ||
      undefined,
  };
}

function exposeEchoformApi(electron, preloadConfig = resolvePreloadConfig()) {
  const bridge = electron?.contextBridge;
  const renderer = electron?.ipcRenderer;
  if (!bridge?.exposeInMainWorld) {
    return;
  }

  if (!renderer) {
    return;
  }

  bridge.exposeInMainWorld("echoform", {
    apiBaseUrl: preloadConfig.apiBaseUrl,
    getUpdateInfo: () => renderer.invoke("echoform:get-update-info"),
    onUpdateAvailable: (callback) => {
      const handler = (_event, info) => callback(info);
      renderer.on("echoform:update-available", handler);
      return () =>
        renderer.removeListener("echoform:update-available", handler);
    },
    openUpdate: (url) => renderer.invoke("echoform:open-update", url),
    pickFolder: () => renderer.invoke("echoform:pick-folder"),
    revealPath: (path) => renderer.invoke("echoform:reveal-path", path),
    runtime: {
      appVersion: preloadConfig.appVersion,
      arch: process.arch,
      electronVersion: process.versions.electron,
      platform: process.platform,
    },
    sessionBootstrapToken: preloadConfig.sessionBootstrapToken,
  });
}

// Only touch the Electron module inside Electron. Requiring it from plain Node
// (unit tests) resolves the binary path and can trigger a binary download.
if (process.versions.electron) {
  exposeEchoformApi(require("electron"));
}

module.exports = {
  exposeEchoformApi,
  resolvePreloadConfig,
};
