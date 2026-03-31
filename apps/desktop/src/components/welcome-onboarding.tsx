import {
  ArrowRight,
  CaretUpDown,
  Check,
  CheckCircle,
  FolderSimple,
  FolderSimplePlus,
  GitFork,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { useOnboardingStore } from "@/lib/onboarding-store";
import { posthog } from "@/lib/posthog";
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
        onClick={() => {
          posthog.capture("onboarding_step_completed", { step: "welcome" });
          onNext();
        }}
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
    posthog.capture("onboarding_folder_added", { source: "suggestion" });
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
      posthog.capture("onboarding_folder_added", { source: "picker" });
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

const TIMELINE_ENTRIES = [
  {
    time: "2:41 PM",
    label: "Added bass track",
    head: true,
    auto: false,
    chips: [
      { text: "+Bass", color: "emerald" as const },
      { text: "~Mixer", color: "amber" as const },
    ],
  },
  {
    time: "2:38 PM",
    label: "Adjusted EQ on drums",
    head: false,
    auto: false,
    chips: [{ text: "~Drums", color: "amber" as const }],
  },
  {
    time: "2:30 PM",
    label: "Auto-snapshot",
    head: false,
    auto: true,
    chips: [],
  },
  {
    time: "2:12 PM",
    label: "New vocal take",
    head: false,
    auto: false,
    chips: [
      { text: "+Vocals", color: "emerald" as const },
      { text: "-Scratch", color: "red" as const },
    ],
  },
];

const CHIP_STYLES = {
  emerald: "text-emerald-400/80 bg-emerald-400/10 border-emerald-400/15",
  amber: "text-amber-400/80 bg-amber-400/10 border-amber-400/15",
  red: "text-red-400/80 bg-red-400/10 border-red-400/15",
};

function MockTimeline() {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      {TIMELINE_ENTRIES.map((entry, i) => (
        <div
          className={cn(
            "relative flex items-center gap-2.5 py-3 pr-4 pl-4",
            i === 0
              ? "border-white/50 border-l-2 bg-white/[0.06]"
              : "border-transparent border-l-2"
          )}
          key={entry.time}
        >
          {/* Vertical branch line */}
          <div
            className="absolute top-0 bottom-0 left-[22px] w-px bg-white/[0.05]"
            style={
              i === 0
                ? { top: "50%", backgroundColor: "rgba(255,255,255,0.05)" }
                : i === TIMELINE_ENTRIES.length - 1
                  ? { bottom: "50%" }
                  : undefined
            }
          />

          {/* Dot */}
          <div
            className={cn(
              "relative z-10 size-2 shrink-0 rounded-full ring-2",
              i === 0
                ? "bg-white ring-white/20"
                : entry.head
                  ? "bg-emerald-400 ring-emerald-400/20"
                  : entry.auto
                    ? "bg-white/15 ring-white/[0.04]"
                    : "bg-white/40 ring-white/10"
            )}
          />

          {/* Content */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-[13px] leading-tight",
                  i === 0 ? "font-medium text-white/90" : "text-white/55"
                )}
              >
                {entry.label}
              </span>
              {!entry.auto && (
                <span className="shrink-0 rounded border-transparent bg-emerald-400/8 px-1 py-0 text-[10px] text-emerald-400/60 uppercase leading-tight tracking-widest">
                  saved
                </span>
              )}
            </div>
            {entry.chips.length > 0 && (
              <div className="flex items-center gap-1">
                {entry.chips.map((chip) => (
                  <span
                    className={cn(
                      "rounded border px-1 py-0 font-mono text-[10px] leading-tight",
                      CHIP_STYLES[chip.color]
                    )}
                    key={chip.text}
                  >
                    {chip.text}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Time */}
          <span className="shrink-0 text-[11px] text-white/20 tabular-nums">
            {entry.time}
          </span>
        </div>
      ))}
    </div>
  );
}

function MockTabs() {
  const tabs = [
    { name: "Summer Beat.als", saves: 24, active: true, current: true },
    {
      name: "Summer Beat (vocal mix).als",
      saves: 8,
      active: false,
      current: false,
    },
  ];

  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-white/[0.06] border-b px-3">
        {tabs.map((tab) => (
          <div
            className={cn(
              "relative flex items-center gap-1.5 whitespace-nowrap px-4 py-3 text-[13px]",
              tab.active ? "text-white/85" : "text-white/30"
            )}
            key={tab.name}
          >
            {tab.current && (
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-400/70" />
            )}
            <span className="font-medium">{tab.name}</span>
            <span className="text-[11px] text-white/20 tabular-nums">
              {tab.saves}
            </span>
            {tab.active && (
              <span className="absolute right-3 bottom-0 left-3 h-[2px] rounded-full bg-white/40" />
            )}
          </div>
        ))}
      </div>

      {/* Fake timeline entries beneath */}
      <div className="px-4 py-3">
        {[
          { label: "Latest save", dim: false },
          { label: "Earlier today", dim: true },
          { label: "Yesterday", dim: true },
        ].map((row) => (
          <div className="flex items-center gap-2.5 py-2" key={row.label}>
            <div
              className={cn(
                "size-2 shrink-0 rounded-full ring-2",
                row.dim
                  ? "bg-white/15 ring-white/[0.04]"
                  : "bg-emerald-400 ring-emerald-400/20"
              )}
            />
            <span
              className={cn(
                "text-[13px]",
                row.dim ? "text-white/30" : "text-white/55"
              )}
            >
              {row.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockVersions() {
  const branches = [
    { name: "Main", depth: 0, saves: 24, current: true, active: true },
    { name: "Experiment", depth: 1, saves: 6, current: false, active: false },
    { name: "Lo-fi remix", depth: 1, saves: 3, current: false, active: false },
  ];

  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      {/* Version selector header */}
      <div className="flex items-center justify-between border-white/[0.06] border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-white/[0.06]">
            <GitFork className="text-white/40" size={13} />
          </div>
          <div>
            <span className="block font-medium text-[13px] text-white/75">
              Main
            </span>
            <span className="block text-[10px] text-emerald-400/60 uppercase tracking-wider">
              current
            </span>
          </div>
        </div>
        <CaretUpDown className="text-white/25" size={12} />
      </div>

      {/* Branch list */}
      <div className="p-1.5">
        <div className="px-2 py-1.5 font-medium text-[10px] text-white/25 uppercase tracking-[0.14em]">
          Versions
        </div>
        {branches.map((branch) => (
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-2",
              branch.active ? "bg-white/[0.08] text-white/90" : "text-white/50"
            )}
            key={branch.name}
            style={{ paddingLeft: `${8 + branch.depth * 16}px` }}
          >
            {branch.depth > 0 && (
              <span className="shrink-0 text-[10px] text-white/15">
                &#x2514;
              </span>
            )}
            <span className="flex-1 text-[13px]">{branch.name}</span>
            <span className="shrink-0 text-[10px] text-white/20 tabular-nums">
              {branch.saves}
            </span>
            {branch.current && (
              <div className="size-1.5 shrink-0 rounded-full bg-emerald-400/70 ring-2 ring-emerald-400/20" />
            )}
            {branch.active && (
              <Check
                className="shrink-0 text-white/40"
                size={12}
                weight="bold"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const HOW_IT_WORKS_STEPS = [
  {
    title: "Timeline",
    desc: "Every save in Ableton creates an entry. Click any to see what changed.",
    mockup: MockTimeline,
  },
  {
    title: "Tabs",
    desc: "Multiple .als files in one project each get their own tab.",
    mockup: MockTabs,
  },
  {
    title: "Versions",
    desc: "Try a different direction without losing your original. Branch off freely.",
    mockup: MockVersions,
  },
];

function HowItWorksStep({ onNext }: { onNext: () => void }) {
  const [subStep, setSubStep] = useState(0);
  const current = HOW_IT_WORKS_STEPS[subStep];
  const isLast = subStep === HOW_IT_WORKS_STEPS.length - 1;
  const Mockup = current.mockup;

  return (
    <div className="flex w-full max-w-md flex-col items-center text-center">
      {/* Sub-step indicator */}
      <div className="mb-6 flex items-center gap-1.5">
        {HOW_IT_WORKS_STEPS.map((s) => (
          <div
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              s.title === current.title
                ? "w-5 bg-white/30"
                : "w-1.5 bg-white/10"
            )}
            key={s.title}
          />
        ))}
      </div>

      {/* Title + description */}
      <div
        className="fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-400"
        key={`text-${subStep}`}
      >
        <h2 className="font-semibold text-white/90 text-xl tracking-tight">
          {current.title}
        </h2>
        <p className="mt-2 text-[13px] text-white/30 leading-relaxed">
          {current.desc}
        </p>
      </div>

      {/* Mockup */}
      <div
        className="fade-in slide-in-from-bottom-3 mt-6 w-full animate-in fill-mode-both duration-500"
        key={`mockup-${subStep}`}
        style={{ animationDelay: "80ms" }}
      >
        <Mockup />
      </div>

      {/* Navigation */}
      <Button
        className="mt-8 gap-2 rounded-xl px-7 py-5 text-sm"
        onClick={() => {
          if (isLast) {
            posthog.capture("onboarding_completed");
            onNext();
          } else {
            setSubStep((s) => s + 1);
          }
        }}
        size="lg"
        type="button"
      >
        {isLast ? "Let's go" : "Next"}
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
