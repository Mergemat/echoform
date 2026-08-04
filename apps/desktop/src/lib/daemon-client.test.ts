import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockWebSocket {
  static readonly CLOSED = 3;
  static readonly CLOSING = 2;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static closeSynchronously = true;
  static instances: MockWebSocket[] = [];

  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (MockWebSocket.closeSynchronously) {
      this.onclose?.();
    }
  }

  finishClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  send(payload: string) {
    this.sent.push(payload);
  }
}

describe("daemon command acknowledgements", () => {
  beforeEach(() => {
    MockWebSocket.closeSynchronously = true;
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(async () => {
    const { stopDaemonClient } = await import("./daemon-client");
    stopDaemonClient();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("rejects explicitly without sending when Echoform is offline", async () => {
    const { sendDaemonCommand } = await import("./daemon-client");

    await expect(
      sendDaemonCommand({ type: "sync-roots" })
    ).rejects.toMatchObject({
      code: "offline",
      message: expect.stringContaining("offline"),
      requestId: null,
    });
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("correlates out-of-order acknowledgements and errors by request ID", async () => {
    const { sendDaemonCommand, startDaemonClient } = await import(
      "./daemon-client"
    );
    startDaemonClient();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const ws = MockWebSocket.instances[0]!;
    ws.open();

    const first = sendDaemonCommand({ type: "sync-roots" });
    const second = sendDaemonCommand({ type: "discover-projects" });
    const [firstWire, secondWire] = ws.sent.map((payload) =>
      JSON.parse(payload)
    );

    expect(firstWire.requestId).toEqual(expect.any(String));
    expect(secondWire.requestId).not.toBe(firstWire.requestId);

    ws.receive({ requestId: secondWire.requestId, type: "command-ack" });
    await expect(second).resolves.toEqual({ requestId: secondWire.requestId });

    ws.receive({
      code: "scan-failed",
      message: "Root scan failed",
      requestId: firstWire.requestId,
      type: "command-error",
    });
    await expect(first).rejects.toMatchObject({
      code: "server-error",
      message: "Root scan failed",
      requestId: firstWire.requestId,
    });
  });

  it("ignores a stale socket closing after a replacement is connected", async () => {
    MockWebSocket.closeSynchronously = false;
    const {
      sendDaemonCommand,
      startDaemonClient,
      stopDaemonClient,
      subscribeConnection,
    } = await import("./daemon-client");
    const connectionStates: boolean[] = [];
    subscribeConnection((connected) => connectionStates.push(connected));

    startDaemonClient();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const staleSocket = MockWebSocket.instances[0]!;
    staleSocket.open();

    stopDaemonClient();
    startDaemonClient();
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const currentSocket = MockWebSocket.instances[1]!;
    currentSocket.open();

    const command = sendDaemonCommand({ type: "sync-roots" });
    const wireCommand = JSON.parse(currentSocket.sent[0]!);
    staleSocket.finishClose();
    currentSocket.receive({
      requestId: wireCommand.requestId,
      type: "command-ack",
    });

    await expect(command).resolves.toEqual({
      requestId: wireCommand.requestId,
    });
    expect(connectionStates.at(-1)).toBe(true);
  });
});
