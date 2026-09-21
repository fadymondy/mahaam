// Credential storage: Keychain / Keystore through expo-secure-store on devices.
//
// The web build has no secure store, so it reports secure:false and the client then refuses to
// persist the password there — it previously went into localStorage in cleartext, readable by
// any XSS. The cost is that silent re-login does not work on web: when the 24h JWT expires the
// user signs in again. The real fix is server-side refresh tokens, after which no client needs
// to keep a password at all.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type { KeyValueStore } from "./client";

export const secureStore: KeyValueStore =
  Platform.OS === "web"
    ? {
        secure: false,
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
        secure: true,
        get: (k) => SecureStore.getItemAsync(k),
        set: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
        del: (k) => SecureStore.deleteItemAsync(k),
      };
