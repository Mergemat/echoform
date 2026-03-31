import { useEffect, useState } from "react";

interface UpdateInfo {
  url: string;
  version: string;
}

export function useAppUpdate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const cleanup = window.echoform?.onUpdateAvailable?.((info) => {
      setUpdate(info);
    });
    return () => cleanup?.();
  }, []);

  return {
    updateAvailable: update !== null,
    version: update?.version ?? null,
    url: update?.url ?? null,
    openUpdate: () => {
      if (update?.url) {
        void window.echoform?.openUpdate?.(update.url);
      }
    },
  };
}
