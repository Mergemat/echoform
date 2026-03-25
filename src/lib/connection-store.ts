import { create } from 'zustand';

type ConnectionStore = {
  connected: boolean;
  setConnected: (connected: boolean) => void;
};

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));
