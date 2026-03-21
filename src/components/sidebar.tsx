import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";
import { Eye, EyeSlash, Plus, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function ProjectItem({ project, selected }: { project: Project; selected: boolean }) {
  const selectProject = useStore((s) => s.selectProject);
  const send = useStore((s) => s.send);
  const currentIdea = project.ideas.find((i) => i.id === project.currentIdeaId);

  return (
    <button
      type="button"
      onClick={() => selectProject(project.id)}
      className={cn(
        "group w-full text-left px-3 py-2.5 transition-colors rounded-md",
        selected
          ? "bg-white/[0.08] text-white"
          : "text-white/50 hover:text-white/70 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium">{project.name}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            send({ type: "toggle-watching", projectId: project.id, watching: !project.watching });
          }}
          className={cn(
            "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded",
            project.watching ? "text-emerald-400" : "text-white/30",
          )}
          title={project.watching ? "Watching" : "Not watching"}
        >
          {project.watching ? <Eye size={14} /> : <EyeSlash size={14} />}
        </button>
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-white/30">
        <span>{project.saves.length} saves</span>
        <span className="text-white/15">|</span>
        <span>{currentIdea?.name ?? "Main"}</span>
        {project.saves.length > 0 && (
          <>
            <span className="text-white/15">|</span>
            <span>{formatSize(project.saves.at(-1)!.metadata.sizeBytes)}</span>
          </>
        )}
      </div>
    </button>
  );
}

export function Sidebar() {
  const projects = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const send = useStore((s) => s.send);
  const discoveredProjects = useStore((s) => s.discoveredProjects);
  const [showDiscover, setShowDiscover] = useState(false);

  return (
    <aside className="flex flex-col h-full border-r border-white/[0.06] bg-white/[0.02]">
      {/* Header */}
      <div className="px-3 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <h1 className="text-[15px] font-semibold text-white/90 tracking-tight">Ablegit</h1>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                send({ type: "discover-projects" });
                setShowDiscover(true);
              }}
              className="p-1 rounded text-white/30 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
              title="Find projects"
            >
              <MagnifyingGlass size={14} />
            </button>
          </div>
        </div>
        <p className="text-[11px] text-white/25 mt-1">auto-versioning for ableton</p>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {projects.map((p) => (
          <ProjectItem key={p.id} project={p} selected={p.id === selectedProjectId} />
        ))}
        {projects.length === 0 && (
          <div className="px-3 py-8 text-center text-[12px] text-white/20">
            No projects tracked yet.
            <br />
            Click the search icon to find Ableton projects.
          </div>
        )}
      </div>

      {/* Discover panel */}
      {showDiscover && (
        <div className="border-t border-white/[0.06] max-h-[40vh] overflow-y-auto">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] text-white/40 font-medium uppercase tracking-wider">
              Discovered
            </span>
            <button
              type="button"
              onClick={() => setShowDiscover(false)}
              className="text-[11px] text-white/30 hover:text-white/50"
            >
              Close
            </button>
          </div>
          <div className="px-1.5 pb-2 space-y-0.5">
            {discoveredProjects.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-white/20 text-center">
                Scanning...
              </div>
            )}
            {discoveredProjects.map((dp) => (
              <div
                key={dp.path}
                className="flex items-center justify-between px-3 py-2 rounded-md text-[12px]"
              >
                <div className="min-w-0">
                  <div className={cn("truncate", dp.tracked ? "text-white/30" : "text-white/60")}>
                    {dp.name}
                  </div>
                  <div className="text-[10px] text-white/15 truncate">{dp.setFiles.length} .als files</div>
                </div>
                {dp.tracked ? (
                  <span className="text-[10px] text-white/20 shrink-0 ml-2">Tracked</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => send({ type: "track-project", projectPath: dp.path, name: dp.name })}
                    className="shrink-0 ml-2 p-1 rounded text-white/30 hover:text-emerald-400 hover:bg-white/[0.06] transition-colors"
                    title="Track this project"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
