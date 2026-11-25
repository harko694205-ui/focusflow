import { create } from 'zustand';
import type { ID } from '@/domain/types';

type EditorState = { mode: 'create'; categoryId?: ID } | { mode: 'edit'; id: ID } | null;

/** Which exam the editor dialog shows. */
export const useExamEditor = create<{ editor: EditorState; open: (e: NonNullable<EditorState>) => void; close: () => void }>((set) => ({
  editor: null,
  open: (editor) => set({ editor }),
  close: () => set({ editor: null }),
}));
