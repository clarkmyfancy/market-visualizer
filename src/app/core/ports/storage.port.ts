import { Injectable } from '@angular/core';

export const STORAGE_KEYS = {
  RANGE: 'range',
  THEME: 'theme',
  EXPERIMENT_MODE: 'experiment-mode',
} as const;

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

@Injectable({ providedIn: 'root' })
export class StoragePort {
  getItem(key: StorageKey): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: StorageKey, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }
}
