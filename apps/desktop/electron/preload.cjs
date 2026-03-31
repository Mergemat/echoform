"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echoform", {
  apiBaseUrl: process.env.ECHOFORM_API_URL || undefined,
  pickFolder: () => ipcRenderer.invoke("echoform:pick-folder"),
  onUpdateAvailable: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on("echoform:update-available", handler);
    return () =>
      ipcRenderer.removeListener("echoform:update-available", handler);
  },
  openUpdate: (url) => ipcRenderer.invoke("echoform:open-update", url),
});
