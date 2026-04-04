import { create } from 'zustand';
import type { ValueStream } from '@/types';
import { apiClient } from '@/api/client';

interface ProcessState {
  valueStreams: ValueStream[];
  loading: boolean;
  error: string | null;
  fetchValueStreams: () => Promise<void>;
  createValueStream: (data: Partial<ValueStream>) => Promise<void>;
  updateValueStream: (id: string, data: Partial<ValueStream>) => Promise<void>;
  deleteValueStream: (id: string) => Promise<void>;
}

export const useProcessStore = create<ProcessState>()((set) => ({
  valueStreams: [],
  loading: false,
  error: null,

  fetchValueStreams: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiClient.get<ValueStream[]>('/value-streams');
      set({ valueStreams: data, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch value streams',
        loading: false,
      });
    }
  },

  createValueStream: async (data) => {
    set({ loading: true, error: null });
    try {
      const created = await apiClient.post<ValueStream>('/value-streams', data);
      set((state) => ({
        valueStreams: [...state.valueStreams, created],
        loading: false,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create value stream',
        loading: false,
      });
    }
  },

  updateValueStream: async (id, data) => {
    set({ loading: true, error: null });
    try {
      const updated = await apiClient.put<ValueStream>(`/value-streams/${id}`, data);
      set((state) => ({
        valueStreams: state.valueStreams.map((vs) => (vs.id === id ? updated : vs)),
        loading: false,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to update value stream',
        loading: false,
      });
    }
  },

  deleteValueStream: async (id) => {
    set({ loading: true, error: null });
    try {
      await apiClient.delete(`/value-streams/${id}`);
      set((state) => ({
        valueStreams: state.valueStreams.filter((vs) => vs.id !== id),
        loading: false,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to delete value stream',
        loading: false,
      });
    }
  },
}));
