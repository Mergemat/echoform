import { useEffect, useState } from "react";

interface UpdateInfo {
  url: string;
  version: string;
}

export function useAppUpdate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Pull: check if an update was already detected before we mounted
    void window.echoform?.getUpdateInfo?.().then((info) => {
      if (info) {
        setUpdate(info);
      }
    });

    // Push: listen for future update detections
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
