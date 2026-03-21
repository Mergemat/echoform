import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar";
import { Timeline } from "@/components/timeline";
import { SaveDetail } from "@/components/save-detail";
import { ProjectHeader } from "@/components/project-header";
import { Toasts } from "@/components/toasts";

export function App() {
  const connect = useStore((s) => s.connect);
  const connected = useStore((s) => s.connected);
  const selectedSaveId = useStore((s) => s.selectedSaveId);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0c0c0e] text-white flex">
      {/* Sidebar */}
      <div className="w-[220px] shrink-0">
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <ProjectHeader />

        {/* Timeline area */}
        <div className="flex-1 min-h-0 flex">
          {/* Timeline */}
          <div className="flex-1 min-w-0">
            <Timeline />
          </div>

          {/* Detail panel - slides in when a save is selected */}
          {selectedSaveId && (
            <div className="w-[300px] shrink-0 border-l border-white/[0.06] bg-white/[0.01]">
              <SaveDetail />
            </div>
          )}
        </div>
      </div>

      {/* Connection indicator */}
      {!connected && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 bg-red-500/10 text-red-300 text-[11px] px-3 py-1.5 rounded-full border border-red-500/20 backdrop-blur-sm z-50">
          Connecting to server...
        </div>
      )}

      <Toasts />
    </div>
  );
}

export default App;
