declare global {
  interface Window {
    echoform?: {
      apiBaseUrl?: string;
      pickFolder?: () => Promise<string | null>;
    };
  }
}

export {};
