import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from '../api/client';

const ACCESS_KEY = 'papertrade.access';
const REFRESH_KEY = 'papertrade.refresh';

export const secureTokenStore: TokenStore = {
  getAccess: () => SecureStore.getItemAsync(ACCESS_KEY),
  getRefresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  async set(tokens) {
    await SecureStore.setItemAsync(ACCESS_KEY, tokens.access);
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh);
  },
  async clear() {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
