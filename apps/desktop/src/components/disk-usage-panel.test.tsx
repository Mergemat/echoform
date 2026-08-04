import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiskUsage } from "@/lib/types";
import { DiskUsagePanel } from "./disk-usage-panel";

vi.mock("@/lib/posthog", () => ({
  posthog: { capture: vi.fn() },
}));

const usage: DiskUsage = {
  autoSaveCount: 8,
  blobCount: 4,
  blobStorageBytes: 4096,
  dedupSavings: 2048,
  eligibleAutoSaveCount: 3,
  largestAutoSaveBytes: 2048,
  manifestCount: 10,
  manualSaveCount: 2,
  oldestAutoSaveAt: "2026-07-01T10:00:00.000Z",
  projectId: "project-1",
  saves: [],
  totalSaveCount: 10,
  totalSnapshotBytes: 6144,
};

describe("storage cleanup confirmation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          json: async () => usage,
          ok: true,
        })
        .mockResolvedValueOnce({
          json: async () => ({ deletedCount: 3 }),
          ok: true,
        })
        .mockResolvedValueOnce({
          json: async () => ({ ...usage, eligibleAutoSaveCount: 0 }),
          ok: true,
        })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not compact checkpoints until the user confirms the impact", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    render(<DiskUsagePanel projectId="project-1" />);

    await user.click(screen.getByRole("button", { name: "Storage" }));
    await screen.findByText("Retention compaction");
    await user.click(
      screen.getByRole("button", { name: "Compact checkpoints" })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Permanently remove historical automatic checkpoints?")
    ).toBeVisible();
    expect(screen.getByText(/up to 3 automatic checkpoints/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/projects/project-1/compact-storage",
      { method: "POST" }
    );
  });

  it("discards usage and confirmation state when the selected project changes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const nextUsage = {
      ...usage,
      blobStorageBytes: 8192,
      eligibleAutoSaveCount: 1,
      projectId: "project-2",
    };
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ json: async () => usage, ok: true } as Response)
      .mockResolvedValueOnce({
        json: async () => nextUsage,
        ok: true,
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ deletedCount: 1 }),
        ok: true,
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ ...nextUsage, eligibleAutoSaveCount: 0 }),
        ok: true,
      } as Response);

    const view = render(<DiskUsagePanel projectId="project-1" />);
    await user.click(screen.getByRole("button", { name: "Storage" }));
    await screen.findByText("Retention compaction");
    await user.click(
      screen.getByRole("button", { name: "Compact checkpoints" })
    );
    expect(screen.getByText(/up to 3 automatic checkpoints/i)).toBeVisible();

    view.rerender(<DiskUsagePanel projectId="project-2" />);
    await user.click(screen.getByRole("button", { name: "Storage" }));
    await screen.findAllByText("8 KB");
    expect(screen.queryByText(/up to 3 auto-checkpoints/i)).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Compact checkpoints" })
    );
    expect(screen.getByText(/up to 1 automatic checkpoint/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Confirm removal" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-2/compact-storage",
        { method: "POST" }
      )
    );
  });
});
