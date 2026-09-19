// Credential storage: Keychain / Keystore through expo-secure-store on devices. The web build (a dev
// and QA target, not shipped) falls back to localStorage — there is no secure store in a browser.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type { KeyValueStore } from "./client";

export const secureStore: KeyValueStore =
  Platform.OS === "web"
    ? {
        async get(k) {
          return globalThis.localStorage?.getItem(k) ?? null;
        },
        async set(k, v) {
          globalThis.localStorage?.setItem(k, v);
        },
        async del(k) {
          globalThis.localStorage?.removeItem(k);
        },
      }
    : {
        get: (k) => SecureStore.getItemAsync(k),
        set: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
        del: (k) => SecureStore.deleteItemAsync(k),
      };
