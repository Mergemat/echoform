declare global {
  interface Window {
    echoform?: {
      apiBaseUrl?: string;
      pickFolder?: () => Promise<string | null>;
      onUpdateAvailable?: (
        callback: (info: { version: string; url: string }) => void
      ) => () => void;
      openUpdate?: (url: string) => Promise<void>;
    };
  }
}

export {};
