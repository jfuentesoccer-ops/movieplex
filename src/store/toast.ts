import { create } from 'zustand';

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };

type ToastState = {
  toasts: Toast[];
  show: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],
  show: (text, kind = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismiss(id), 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, kind?: Toast['kind']) => useToast.getState().show(text, kind);
