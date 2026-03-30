import {
  ArrowRight,
  CheckCircle,
  FolderSimple,
  FolderSimplePlus,
  GitFork,
  MusicNotes,
  Waveform,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { useOnboardingStore } from "@/lib/onboarding-store";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// ── Helpers ─────────────────────────────────────────────────────────

function shortenPath(p: string): string {
  let s = p;
  const parts = s.split("/");
  if (parts.length >= 3 && parts[1] === "Users") {
    const home = `/Users/${parts[2]}`;
    if (s.startsWith(`${home}/`)) {
      s = `~${s.slice(home.length)}`;
    }
  }
  s = s.replace("~/Library/Mobile Documents/com~apple~CloudDocs", "~/iCloud");
  return s;
}

// ── Step 1: Welcome ─────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative">
        <div className="absolute -inset-6 rounded-full bg-white/[0.03] blur-2xl" />
        <Logo className="relative size-14 text-white/80" />
      </div>

      <h1 className="mt-6 font-semibold text-[28px] text-white/95 tracking-tight">
        Welcome to Echoform
      </h1>
      <p className="mt-2 max-w-sm text-[15px] text-white/35 leading-relaxed">
        Automatic version history for your Ableton projects. Every change saved,
        nothing lost.
      </p>

      <div className="mt-10 flex flex-col gap-4 text-left">
        {[
          {
            title: "Point at your folders",
            desc: "Echoform finds every Ableton project inside.",
          },
          {
            title: "Work like you always do",
            desc: "Changes are captured silently in the background.",
          },
          {
            title: "Go back anytime",
            desc: "Browse history, compare saves, or revisit earlier versions.",
          },
        ].map((item, i) => (
          <div className="flex items-start gap-3" key={item.title}>
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-medium text-[11px] text-white/30">
              {i + 1}
            </div>
            <div>
              <div className="font-medium text-[13px] text-white/60">
                {item.title}
              </div>
              <div className="mt-0.5 text-[12px] text-white/20">
                {item.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button
        className="mt-10 gap-2 rounded-xl px-7 py-5 text-sm"
        onClick={onNext}
        size="lg"
        type="button"
      >
        Get started
        <ArrowRight className="text-white/50" size={14} />
      </Button>
    </div>
  );
}

// ── Step 2: Pick a folder ───────────────────────────────────────────

function PickFolderStep() {
  const rootSuggestions = useStore((s) => s.rootSuggestions);
  const rootSuggestionsLoaded = useStore((s) => s.rootSuggestionsLoaded);
  const roots = useStore((s) => s.roots);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addedPath, setAddedPath] = useState<string | null>(null);
  const suggestionsLoading = !rootSuggestionsLoaded;

  // Trigger suggestion discovery on mount
  useEffect(() => {
    if (rootSuggestionsLoaded) {
      return;
    }
    fetchTimerRef.current = setTimeout(() => {
      sendDaemonCommand({ type: "discover-root-suggestions" });
    }, 150);
    return () => {
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current);
        fetchTimerRef.current = null;
      }
    };
  }, [rootSuggestionsLoaded]);

  const watchPath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }
    setAddedPath(trimmed);
    sendDaemonCommand({ type: "add-root", path: trimmed });
    sendDaemonCommand({ type: "discover-root-suggestions" });
  };

  const handlePickFolder = async () => {
    if (!window.echoform?.pickFolder) {
      toast.error("Folder picker is only available in the desktop app.");
      return;
    }
    try {
      const selectedPath = await window.echoform.pickFolder();
      if (!selectedPath) {
        return;
      }
      watchPath(selectedPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open folder picker";
      toast.error(message);
    }
  };

  const hasAddedRoot = roots.length > 0;

  return (
    <div className="flex w-full max-w-md flex-col items-center text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06]">
        <FolderSimplePlus className="text-white/50" size={24} />
      </div>
      <h2 className="mt-5 font-semibold text-white/90 text-xl tracking-tight">
        Choose a folder to watch
      </h2>
      <p className="mt-2 text-[13px] text-white/30 leading-relaxed">
        Pick a folder that contains your Ableton projects.
        <br />
        Echoform finds all .als files inside automatically.
      </p>
      {/* Primary action: folder picker */}
      <Button
        className="mt-7 gap-2 rounded-xl px-6 py-5 text-sm"
        onClick={() => void handlePickFolder()}
        size="lg"
        type="button"
      >
        <FolderSimple size={18} />
        Browse for folder
      </Button>
      {/* Suggested folders — always rendered to avoid layout shift */}
      <div className="mt-8 w-full text-left">
        <div className="mb-3 font-medium text-[11px] text-white/20 uppercase tracking-widest">
          Suggested folders
        </div>
        <div className="space-y-1.5">
          {suggestionsLoading && rootSuggestions.length === 0 ? (
            <div className="rounded-lg border border-white/[0.06] border-dashed px-4 py-3.5 text-center text-[12px] text-white/20">
              Scanning for music folders...
            </div>
          ) : rootSuggestions.length === 0 ? (
            <div className="rounded-lg border border-white/[0.06] border-dashed px-4 py-3.5 text-center text-[12px] text-white/20">
              No Ableton folders found — use Browse above.
            </div>
          ) : (
            rootSuggestions.map((suggestion) => {
              const isAdded =
                addedPath === suggestion.path ||
                roots.some((r) => r.path === suggestion.path);

              return (
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-all duration-200",
                    isAdded
                      ? "border-emerald-500/20 bg-emerald-500/[0.05]"
                      : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
                  )}
                  key={suggestion.path}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-white/70">
                      {shortenPath(suggestion.path)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/25">
                      {suggestion.projectCount} project
                      {suggestion.projectCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  {isAdded ? (
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-emerald-400/70">
                      <CheckCircle size={14} weight="fill" />
                      Added
                    </div>
                  ) : (
                    <Button
                      className="shrink-0 rounded-lg text-[11px]"
                      onClick={() => watchPath(suggestion.path)}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Watch
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Confirmation that a folder was added */}
      {hasAddedRoot && (
        <div className="mt-6 text-[12px] text-emerald-400/60">
          <CheckCircle
            className="mr-1 inline-block -translate-y-px"
            size={13}
            weight="fill"
          />
          Folder added — Echoform is now scanning your projects.
        </div>
      )}
    </div>
  );
}

// ── Step 3: How it works ────────────────────────────────────────────

function HowItWorksStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex w-full max-w-md flex-col items-center text-center">
      <h2 className="font-semibold text-white/90 text-xl tracking-tight">
        Here's what you'll see
      </h2>
      <p className="mt-2 text-[13px] text-white/30 leading-relaxed">
        A quick look at the three parts of Echoform.
      </p>

      <div className="mt-8 w-full space-y-3 text-left">
        {[
          {
            icon: <Waveform className="text-white/40" size={18} />,
            title: "Timeline",
            desc: "Every time you hit Save in Ableton, a new entry appears here. Click one to see exactly what changed — tracks, tempo, sounds.",
          },
          {
            icon: <MusicNotes className="text-white/40" size={18} />,
            title: "Tabs",
            desc: "If a project has multiple .als files, each gets its own tab. Switch between them without leaving Echoform.",
          },
          {
            icon: <GitFork className="text-white/40" size={18} />,
            title: "Versions",
            desc: "Want to try a different direction? Create a version — a separate copy you can work on freely. Your original stays untouched.",
          },
        ].map((item) => (
          <div
            className="flex gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5"
            key={item.title}
          >
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
              {item.icon}
            </div>
            <div>
              <div className="font-medium text-[13px] text-white/60">
                {item.title}
              </div>
              <div className="mt-0.5 text-[12px] text-white/25 leading-relaxed">
                {item.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button
        className="mt-8 gap-2 rounded-xl px-7 py-5 text-sm"
        onClick={onNext}
        size="lg"
        type="button"
      >
        Let's go
        <ArrowRight className="text-white/50" size={14} />
      </Button>
    </div>
  );
}

// ── Main Onboarding Container ───────────────────────────────────────

export function WelcomeOnboarding() {
  const step = useOnboardingStore((s) => s.step);
  const setStep = useOnboardingStore((s) => s.setStep);
  const complete = useOnboardingStore((s) => s.complete);
  const roots = useStore((s) => s.roots);
  const projects = useStore((s) => s.projects);
  const [transitioning, setTransitioning] = useState(false);

  // Auto-advance to "how-it-works" once a root is added and projects are discovered
  useEffect(() => {
    if (step !== "pick-folder") {
      return;
    }
    if (roots.length === 0) {
      return;
    }
    if (projects.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      setTransitioning(true);
      setTimeout(() => {
        setTransitioning(false);
        setStep("how-it-works");
      }, 400);
    }, 1200);
    return () => clearTimeout(timer);
  }, [step, roots.length, projects.length, setStep]);

  return (
    <div
      className={cn(
        "flex h-screen w-screen items-center justify-center bg-background transition-opacity duration-400",
        transitioning ? "opacity-0" : "opacity-100"
      )}
    >
      <div
        className={cn(
          "flex max-w-lg flex-col items-center px-8",
          "fade-in slide-in-from-bottom-3 animate-in fill-mode-both duration-500"
        )}
        key={step}
      >
        {step === "welcome" && (
          <WelcomeStep onNext={() => setStep("pick-folder")} />
        )}
        {step === "pick-folder" && <PickFolderStep />}
        {step === "how-it-works" && <HowItWorksStep onNext={complete} />}
      </div>

      {/* Step indicator */}
      <div className="fixed bottom-8 flex items-center gap-2">
        {(["welcome", "pick-folder", "how-it-works"] as const).map((s) => (
          <div
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              step === s ? "w-6 bg-white/30" : "w-1.5 bg-white/10"
            )}
            key={s}
          />
        ))}
      </div>
    </div>
  );
}
