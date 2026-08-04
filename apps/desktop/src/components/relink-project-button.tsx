import { CircleNotch, FolderOpen } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";

export function RelinkProjectButton({ projectId }: { projectId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [relinking, setRelinking] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleRelink = async () => {
    if (!window.echoform?.pickFolder) {
      setError("Folder picker unavailable in this environment.");
      return;
    }

    setError(null);
    setSuccess(false);
    try {
      const projectPath = await window.echoform.pickFolder();
      if (!projectPath) {
        return;
      }
      setRelinking(true);
      await sendDaemonCommand(
        { projectId, projectPath, type: "relink-project" },
        { reportError: false }
      );
      setSuccess(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Echoform could not relink this project."
      );
    } finally {
      setRelinking(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        disabled={relinking}
        onClick={() => void handleRelink()}
        size="sm"
        type="button"
        variant="outline"
      >
        {relinking ? (
          <CircleNotch className="animate-spin" size={14} />
        ) : (
          <FolderOpen size={14} />
        )}
        {relinking ? "Verifying project..." : "Locate project"}
      </Button>
      {error && (
        <div className="text-red-200/85 text-xs" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="text-emerald-200/80 text-xs" role="status">
          Project relinked. Restoring file actions...
        </div>
      )}
    </div>
  );
}
