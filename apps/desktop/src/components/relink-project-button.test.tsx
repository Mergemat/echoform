import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelinkProjectButton } from "./relink-project-button";

const { sendDaemonCommand } = vi.hoisted(() => ({
  sendDaemonCommand: vi.fn(),
}));

vi.mock("@/lib/daemon-client", () => ({ sendDaemonCommand }));

describe("RelinkProjectButton", () => {
  beforeEach(() => {
    sendDaemonCommand.mockReset();
    sendDaemonCommand.mockResolvedValue({ requestId: "request-1" });
    window.echoform = {
      pickFolder: vi.fn().mockResolvedValue("/Music/Moved Demo"),
    };
  });

  afterEach(() => {
    window.echoform = undefined;
  });

  it("relinks the selected missing project to a verified folder", async () => {
    const user = userEvent.setup();
    render(<RelinkProjectButton projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "Locate project" }));

    expect(window.echoform?.pickFolder).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(sendDaemonCommand).toHaveBeenCalledWith(
        {
          projectId: "project-1",
          projectPath: "/Music/Moved Demo",
          type: "relink-project",
        },
        { reportError: false }
      )
    );
  });

  it("shows an actionable error when the native folder picker is unavailable", async () => {
    const user = userEvent.setup();
    window.echoform = undefined;
    render(<RelinkProjectButton projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "Locate project" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Folder picker unavailable"
    );
    expect(sendDaemonCommand).not.toHaveBeenCalled();
  });
});
