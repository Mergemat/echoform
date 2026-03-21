import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { Sidebar } from '@/components/sidebar';
import { Timeline } from '@/components/timeline';
import { ProjectHeader } from '@/components/project-header';
import { Toasts } from '@/components/toasts';

export function App() {
  const connect = useStore((s) => s.connect);
  const connected = useStore((s) => s.connected);

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

        {/* Timeline takes full width */}
        <div className="flex-1 min-h-0">
          <Timeline />
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
