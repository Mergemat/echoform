import { create } from "zustand";
import { persist } from "zustand/middleware";

export type OnboardingStep =
  | "welcome"
  | "pick-folder"
  | "how-it-works"
  | "done";

interface OnboardingStore {
  complete: () => void;
  reset: () => void;
  setStep: (step: OnboardingStep) => void;
  step: OnboardingStep;
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set) => ({
      step: "welcome",
      setStep: (step) => set({ step }),
      complete: () => set({ step: "done" }),
      reset: () => set({ step: "welcome" }),
    }),
    {
      name: "echoform-onboarding",
    }
  )
);
