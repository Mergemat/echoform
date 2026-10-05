import {
  ArrowRight,
  CheckCircle,
  ClockCounterClockwise,
  FloppyDisk,
  FolderSimple,
  GitBranch,
  ListMagnifyingGlass,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { sendDaemonCommand } from "@/lib/daemon-client";
import { useOnboardingStore } from "@/lib/onboarding-store";
import { posthog } from "@/lib/posthog";
import { useStore } from "@/lib/store";
import { cn, plural, shortenPath } from "@/lib/utils";

const PROMISES = [
  {
    icon: FloppyDisk,
    text: "Every time you save in Ableton, Echoform stores a full copy of the project, samples included, outside your project folder.",
  },
  {
    icon: ListMagnifyingGlass,
    text: "See what changed between saves: tracks, devices, clips, tempo.",
  },
  {
    icon: GitBranch,
    text: "Continue from any earlier checkpoint as a separate copy. Your current project is never overwritten.",
  },
];

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex w-full max-w-md flex-col">
      <Logo className="size-10 text-foreground" />
      <h1 className="mt-6 font-semibold text-[26px] tracking-tight">
        Every Ableton save, kept.
      </h1>
      <p className="mt-2 text-[14px] text-muted-foreground leading-relaxed">
        Echoform quietly records a checkpoint each time you save, so you can
        experiment freely and always get back to an earlier version.
      </p>

      <ul className="mt-8 space-y-4">
        {PROMISES.map(({ icon: Icon, text }) => (
          <li className="flex gap-3" key={text}>
            <Icon className="mt-0.5 shrink-0 text-success" size={18} />
            <span className="text-[13px] leading-relaxed">{text}</span>
          </li>
        ))}
      </ul>

      <p className="mt-8 flex gap-3 rounded-lg border border-border bg-card p-3 text-[12px] text-muted-foreground leading-relaxed">
        <ClockCounterClockwise className="mt-0.5 shrink-0" size={16} />
        Everything stays on this Mac. Echoform is version history, not a backup:
        keep backing up your drive as usual.
      </p>

      <Button className="mt-8 self-start" onClick={onNext} size="lg">
        Choose project folders
        <ArrowRight size={14} />
      </Button>
    </div>
  );
}

function PickFolderStep({ onDone }: { onDone: () => void }) {
  const rootSuggestions = useStore((s) => s.rootSuggestions);
  const rootSuggestionsLoaded = useStore((s) => s.rootSuggestionsLoaded);
  const roots = useStore((s) => s.roots);
  const projects = useStore((s) => s.projects);
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!rootSuggestionsLoaded) {
      sendDaemonCommand({ type: "discover-root-suggestions" });
    }
  }, [rootSuggestionsLoaded]);

  const isWatched = (path: string) => roots.some((root) => root.path === path);

  const watchPath = (path: string, source: "picker" | "suggestion") => {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }
    setPendingPaths((paths) => [...paths, trimmed]);
    posthog.capture("root_added", { context: "onboarding", source });
    sendDaemonCommand({ path: trimmed, type: "add-root" }).finally(() => {
      setPendingPaths((paths) => paths.filter((p) => p !== trimmed));
    });
  };

  const handlePickFolder = async () => {
    if (!window.echoform?.pickFolder) {
      toast.error("The folder picker is only available in the desktop app.");
      return;
    }
    try {
      const selectedPath = await window.echoform.pickFolder();
      if (selectedPath) {
        watchPath(selectedPath, "picker");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't open folder picker"
      );
    }
  };

  const scanning = pendingPaths.length > 0;
  const otherRoots = roots.filter(
    (root) => !rootSuggestions.some((s) => s.path === root.path)
  );

  return (
    <div className="flex w-full max-w-md flex-col">
      <h1 className="font-semibold text-[22px] tracking-tight">
        Where are your Ableton projects?
      </h1>
      <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
        Pick the folder you keep projects in. Echoform finds every project
        inside it, including ones you create later. Nothing in these folders is
        moved or changed.
      </p>

      <div className="mt-6 space-y-1.5">
        {!rootSuggestionsLoaded && rootSuggestions.length === 0 && (
          <div className="rounded-lg border border-border border-dashed px-4 py-3 text-[12px] text-muted-foreground">
            Looking for folders with Ableton projects…
          </div>
        )}
        {[
          ...rootSuggestions,
          ...otherRoots.map((root) => ({ path: root.path, projectCount: -1 })),
        ].map((suggestion) => {
          const watched = isWatched(suggestion.path);
          const pending = pendingPaths.includes(suggestion.path);
          return (
            <div
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5",
                watched ? "border-success/30 bg-success/5" : "border-border"
              )}
              key={suggestion.path}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px]">
                  {shortenPath(suggestion.path)}
                </div>
                {suggestion.projectCount >= 0 && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {plural(suggestion.projectCount, "project")} found
                  </div>
                )}
              </div>
              {watched ? (
                <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-success">
                  <CheckCircle size={14} weight="fill" />
                  Watching
                </span>
              ) : (
                <Button
                  disabled={pending}
                  onClick={() => watchPath(suggestion.path, "suggestion")}
                  size="sm"
                  variant="secondary"
                >
                  {pending ? "Adding…" : "Watch"}
                </Button>
              )}
            </div>
          );
        })}
        <Button
          className="w-full"
          onClick={() => void handlePickFolder()}
          variant="outline"
        >
          <FolderSimple size={15} />
          Choose another folder…
        </Button>
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <span className="text-[12px] text-muted-foreground" role="status">
          {scanning
            ? "Scanning for projects…"
            : roots.length > 0
              ? `${plural(projects.length, "project")} found in ${plural(roots.length, "folder")}`
              : ""}
        </span>
        <div className="flex items-center gap-2">
          {roots.length === 0 && (
            <Button onClick={onDone} variant="ghost">
              Skip for now
            </Button>
          )}
          <Button disabled={roots.length === 0 || scanning} onClick={onDone}>
            Continue
            <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function WelcomeOnboarding() {
  const step = useOnboardingStore((s) => s.step);
  const setStep = useOnboardingStore((s) => s.setStep);
  const complete = useOnboardingStore((s) => s.complete);

  useEffect(() => {
    posthog.capture("onboarding_started");
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-y-auto bg-background px-8 py-12">
      <div
        className="fade-in slide-in-from-bottom-2 flex w-full animate-in justify-center duration-300"
        key={step}
      >
        {step === "welcome" ? (
          <WelcomeStep onNext={() => setStep("pick-folder")} />
        ) : (
          <PickFolderStep
            onDone={() => {
              posthog.capture("onboarding_completed");
              complete();
            }}
          />
        )}
      </div>
    </div>
  );
}
