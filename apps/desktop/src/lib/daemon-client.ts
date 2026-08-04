import type { DaemonCommandInput, WsCommand, WsEvent } from "@/lib/types";

type EventListener = (event: WsEvent) => void;
type ConnectionListener = (connected: boolean) => void;
type CommandFailureListener = (failure: {
  commandType: string;
  error: DaemonCommandError;
}) => void;

const API_URL =
  typeof window === "undefined" ? "" : (window.echoform?.apiBaseUrl ?? "");
const SESSION_BOOTSTRAP_TOKEN =
  typeof window === "undefined"
    ? ""
    : (window.echoform?.sessionBootstrapToken ?? "");
const RECONNECT_DELAY_MS = 2000;
const COMMAND_TIMEOUT_MS = 15_000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let clientGeneration = 0;

const eventListeners = new Set<EventListener>();
const connectionListeners = new Set<ConnectionListener>();
const commandFailureListeners = new Set<CommandFailureListener>();
const pendingCommands = new Map<
  string,
  {
    reject: (error: DaemonCommandError) => void;
    commandType: string;
    reportError: boolean;
    resolve: (result: DaemonCommandResult) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

export type DaemonCommandErrorCode =
  | "offline"
  | "disconnected"
  | "timeout"
  | "server-error";

export class DaemonCommandError extends Error {
  readonly code: DaemonCommandErrorCode;
  readonly requestId: string | null;

  constructor(
    message: string,
    code: DaemonCommandErrorCode,
    requestId: string | null = null
  ) {
    super(message);
    this.name = "DaemonCommandError";
    this.code = code;
    this.requestId = requestId;
  }
}

export interface DaemonCommandResult {
  requestId: string;
}

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

function emitCommandFailure(commandType: string, error: DaemonCommandError) {
  for (const listener of commandFailureListeners) {
    listener({ commandType, error });
  }
}

function createRequestId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `command-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function rejectPendingCommands(code: "disconnected", message: string) {
  for (const [requestId, pending] of pendingCommands) {
    clearTimeout(pending.timer);
    const error = new DaemonCommandError(message, code, requestId);
    if (pending.reportError) {
      emitCommandFailure(pending.commandType, error);
    }
    pending.reject(error);
  }
  pendingCommands.clear();
}

function settleCommand(event: WsEvent): boolean {
  if (event.type !== "command-ack" && event.type !== "command-error") {
    return false;
  }

  const pending = pendingCommands.get(event.requestId);
  if (!pending) {
    return true;
  }

  clearTimeout(pending.timer);
  pendingCommands.delete(event.requestId);
  if (event.type === "command-ack") {
    pending.resolve({ requestId: event.requestId });
  } else {
    const error = new DaemonCommandError(
      event.message,
      "server-error",
      event.requestId
    );
    if (pending.reportError) {
      emitCommandFailure(pending.commandType, error);
    }
    pending.reject(error);
  }
  return true;
}

function getWsUrl() {
  if (API_URL) {
    const base = new URL(API_URL);
    const protocol = base.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${base.host}/ws`;
  }

  const locationLike =
    typeof window === "undefined"
      ? { host: "localhost", protocol: "http:" }
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

function scheduleReconnect(generation: number) {
  if (!running || reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectDaemonClient(generation);
  }, RECONNECT_DELAY_MS);
}

function getBootstrapHeaders(): HeadersInit | undefined {
  if (!SESSION_BOOTSTRAP_TOKEN) {
    return;
  }
  return {
    "X-Echoform-Session-Bootstrap": SESSION_BOOTSTRAP_TOKEN,
  };
}

async function connectDaemonClient(generation: number) {
  if (!(running && generation === clientGeneration)) {
    return;
  }
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/session`, {
      credentials: API_URL ? "include" : "same-origin",
      headers: getBootstrapHeaders(),
    });
    if (!res.ok) {
      throw new Error("Session bootstrap failed");
    }
  } catch {
    if (!(running && generation === clientGeneration)) {
      return;
    }
    emitConnected(false);
    scheduleReconnect(generation);
    return;
  }

  if (!(running && generation === clientGeneration)) {
    return;
  }

  const ws = new WebSocket(getWsUrl());
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) {
      return;
    }
    clearReconnectTimer();
    emitConnected(true);
  };

  ws.onclose = () => {
    if (socket !== ws) {
      return;
    }
    socket = null;
    emitConnected(false);
    rejectPendingCommands(
      "disconnected",
      "The connection to Echoform was lost before the action finished."
    );
    scheduleReconnect(generation);
  };

  ws.onmessage = (event) => {
    if (socket !== ws) {
      return;
    }
    const daemonEvent = JSON.parse(event.data) as WsEvent;
    if (!settleCommand(daemonEvent)) {
      emitEvent(daemonEvent as WsEvent);
    }
  };
}

export function startDaemonClient() {
  if (running) {
    return;
  }
  running = true;
  clientGeneration += 1;
  void connectDaemonClient(clientGeneration);
}

export function stopDaemonClient() {
  running = false;
  clientGeneration += 1;
  clearReconnectTimer();
  const current = socket;
  socket = null;
  if (current && current.readyState < WebSocket.CLOSING) {
    current.close();
  }
  rejectPendingCommands(
    "disconnected",
    "Echoform stopped before the action finished."
  );
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

export function subscribeCommandFailures(listener: CommandFailureListener) {
  commandFailureListeners.add(listener);
  return () => commandFailureListeners.delete(listener);
}

export function sendDaemonCommand(
  command: DaemonCommandInput,
  options: { reportError?: boolean } = {}
): Promise<DaemonCommandResult> {
  if (socket?.readyState !== WebSocket.OPEN) {
    const error = new DaemonCommandError(
      "Echoform is offline. Reconnect before trying this action again.",
      "offline"
    );
    if (options.reportError !== false) {
      emitCommandFailure(command.type, error);
    }
    const offlinePromise = Promise.reject(error);
    void offlinePromise.catch(() => undefined);
    return offlinePromise;
  }

  const requestId = createRequestId();
  const daemonCommand = { ...command, requestId } as WsCommand;

  const commandPromise = new Promise<DaemonCommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(requestId);
      const error = new DaemonCommandError(
        "Echoform did not confirm the action. Please try again.",
        "timeout",
        requestId
      );
      if (options.reportError !== false) {
        emitCommandFailure(command.type, error);
      }
      reject(error);
    }, COMMAND_TIMEOUT_MS);

    pendingCommands.set(requestId, {
      commandType: command.type,
      reject,
      reportError: options.reportError !== false,
      resolve,
      timer,
    });
    try {
      socket?.send(JSON.stringify(daemonCommand));
    } catch (error) {
      clearTimeout(timer);
      pendingCommands.delete(requestId);
      const commandError = new DaemonCommandError(
        error instanceof Error
          ? error.message
          : "Echoform could not send the action.",
        "disconnected",
        requestId
      );
      if (options.reportError !== false) {
        emitCommandFailure(command.type, commandError);
      }
      reject(commandError);
    }
  });
  // UI call sites may intentionally fire background discovery/sync commands.
  // They still report through subscribeCommandFailures without creating an
  // unhandled rejection; callers that await retain the original rejection.
  void commandPromise.catch(() => undefined);
  return commandPromise;
}
