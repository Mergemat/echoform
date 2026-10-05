import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OnboardingStep = "welcome" | "pick-folder" | "done";

interface OnboardingStore {
  complete: () => void;
  reset: () => void;
  setStep: (step: OnboardingStep) => void;
  step: OnboardingStep;
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      complete: () => set({ step: "done" }),
      reset: () => set({ step: "welcome" }),
      setStep: (step) => set({ step }),
      step: "welcome",
    }),
    {
      // v0 had a third "how-it-works" step; resume those users at folder setup.
      migrate: (persisted) => {
        const state = persisted as { step?: string } | undefined;
        return {
          step: state?.step === "how-it-works" ? "pick-folder" : state?.step,
        } as OnboardingStore;
      },
      name: "echoform-onboarding",
      version: 1,
    }
  )
);
