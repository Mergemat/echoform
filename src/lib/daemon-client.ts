import type { WsCommand, WsEvent } from "@/lib/types";

type EventListener = (event: WsEvent) => void;
type ConnectionListener = (connected: boolean) => void;

const API_URL = "";
const RECONNECT_DELAY_MS = 2000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

const eventListeners = new Set<EventListener>();
const connectionListeners = new Set<ConnectionListener>();

function emitConnected(connected: boolean) {
  for (const listener of connectionListeners) {
    listener(connected);
  }
}

function emitEvent(event: WsEvent) {
  for (const listener of eventListeners) {
    listener(event);
  }
}

function getWsUrl() {
  const locationLike =
    typeof window === "undefined"
      ? { protocol: "http:", host: "localhost" }
      : window.location;
  const wsProtocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${locationLike.host}/ws`;
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!running || reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectDaemonClient();
  }, RECONNECT_DELAY_MS);
}

async function connectDaemonClient() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/session`);
    if (!res.ok) {
      throw new Error("Session bootstrap failed");
    }
  } catch {
    emitConnected(false);
    scheduleReconnect();
    return;
  }

  const ws = new WebSocket(getWsUrl());
  socket = ws;

  ws.onopen = () => {
    clearReconnectTimer();
    emitConnected(true);
  };

  ws.onclose = () => {
    if (socket === ws) {
      socket = null;
    }
    emitConnected(false);
    scheduleReconnect();
  };

  ws.onmessage = (event) => {
    emitEvent(JSON.parse(event.data) as WsEvent);
  };
}

export function startDaemonClient() {
  running = true;
  void connectDaemonClient();
}

export function stopDaemonClient() {
  running = false;
  clearReconnectTimer();
  const current = socket;
  socket = null;
  if (current && current.readyState < WebSocket.CLOSING) {
    current.close();
  }
  emitConnected(false);
}

export function subscribeDaemonEvents(listener: EventListener) {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function subscribeConnection(listener: ConnectionListener) {
  connectionListeners.add(listener);
  listener(socket?.readyState === WebSocket.OPEN);
  return () => connectionListeners.delete(listener);
}

export function sendDaemonCommand(command: WsCommand) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(command));
  }
}
