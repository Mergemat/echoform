import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          type="button"
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cn(
            "animate-in slide-in-from-right fade-in rounded-lg px-4 py-2.5 text-xs font-medium shadow-lg backdrop-blur-sm transition-all",
            "border border-white/[0.06] cursor-pointer",
            t.type === "success" && "bg-emerald-500/15 text-emerald-300",
            t.type === "error" && "bg-red-500/15 text-red-300",
            t.type === "info" && "bg-white/[0.08] text-white/70",
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
