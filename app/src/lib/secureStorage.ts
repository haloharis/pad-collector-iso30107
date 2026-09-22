import * as SecureStore from 'expo-secure-store';

// SecureStore values are limited to ~2 KB, a Supabase session can exceed that,
// so values are split into chunks.
const CHUNK = 1800;
const countKey = (k: string) => `${k}.n`;
const chunkKey = (k: string, i: number) => `${k}.${i}`;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = await SecureStore.getItemAsync(countKey(key));
    if (!n) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(n); i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await secureStorage.removeItem(key);
    const n = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    await SecureStore.setItemAsync(countKey(key), String(n));
  },
  async removeItem(key: string): Promise<void> {
    const n = await SecureStore.getItemAsync(countKey(key));
    for (let i = 0; i < Number(n ?? 0); i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
