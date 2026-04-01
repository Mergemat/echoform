declare global {
  interface Window {
    echoform?: {
      apiBaseUrl?: string;
      runtime?: {
        appVersion?: string;
        arch: string;
        electronVersion: string;
        platform: string;
      };
      sessionBootstrapToken?: string;
      pickFolder?: () => Promise<string | null>;
      getUpdateInfo?: () => Promise<{
        version: string;
        url: string;
      } | null>;
      onUpdateAvailable?: (
        callback: (info: { version: string; url: string }) => void
      ) => () => void;
      openUpdate?: (url: string) => Promise<void>;
    };
  }
}

export {};
