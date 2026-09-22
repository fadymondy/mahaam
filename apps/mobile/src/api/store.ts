// Credential storage: Keychain / Keystore through expo-secure-store on devices.
//
// The web build has no secure store, so it reports secure:false and the client then refuses to
// persist the password there — it previously went into localStorage in cleartext, readable by
// any XSS.
//
// That is now the fallback rather than the normal path. Sign-in swaps the 24h JWT for a personal
// access token (client.ts upgradeToAccessToken), which deletes the stored credentials outright:
// a PAT does not expire, so nothing needs a password to silently re-login, and it can be revoked
// from the server if a device is lost. The password is only ever kept when that swap fails —
// against a server too old to expose /api/auth/tokens — and even then only where the OS can
// protect it.
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
