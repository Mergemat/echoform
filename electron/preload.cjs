"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echoform", {
  apiBaseUrl: process.env.ECHOFORM_API_URL || undefined,
  pickFolder: () => ipcRenderer.invoke("echoform:pick-folder"),
});
