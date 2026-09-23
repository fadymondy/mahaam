// API methods owned by the account feature. Spread into makeApi (api.ts); the keys join the IPC allowlist.
//
// The account lives outside any workspace (/api/me/*, /api/auth/tokens), so none of these send
// X-Workspace-ID. Devices are the person's personal access tokens: every desktop, phone and browser
// extension that signed in holds one, named after the device.
import { hostname } from "node:os";
import { basename } from "node:path";
import { ApiError, type MahaamClient } from "@mahaam/client";

import type { components } from "../../../shared/src/openapi";

type S = components["schemas"];
type Clean<T> = Omit<T, "$schema">;

export type Profile = Clean<S["Profile"]>;
export type ProfilePatch = Clean<S["ProfilePatch"]>;
export type TwoFAState = Clean<S["TwoFAState"]>;

export interface Device {
  id: string;
  name: string;
  created_at: string;
  /** "" or null: never expires. */
  expires_at: string | null;
  /** The token this app is signed in with. */
  current: boolean;
  kind: "desktop" | "mobile" | "extension" | "browser" | "other";
}

// The name session.ts mints this device's token under (keep the two in step). Only used to tell
// which row in the list is this device.
const deviceName = () =>
  `Mahaam for ${process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "Windows" : "Linux"} — ${hostname()}` +
  (process.env.MAHAAM_USER_DATA ? ` (${basename(process.env.MAHAAM_USER_DATA)})` : "");

function kindOf(name: string): Device["kind"] {
  const n = name.toLowerCase();
  if (/mobile|iphone|ipad|android|ios/.test(n)) return "mobile";
  if (/extension/.test(n)) return "extension";
  if (/mac|windows|linux|desktop|tray/.test(n)) return "desktop";
  if (/browser|chrome|firefox|safari|edge/.test(n)) return "browser";
  return "other";
}

export function accountApi(c: MahaamClient) {
  return {
    profile: () => c.request<Profile>("GET", "/api/me/profile"),
    updateProfile: (patch: ProfilePatch) => {
      // Only the three fields the endpoint takes cross over; the server validates the values.
      const body: ProfilePatch = {};
      if (typeof patch?.name === "string") body.name = patch.name.slice(0, 120);
      if (typeof patch?.timezone === "string") body.timezone = patch.timezone.slice(0, 64);
      if (patch?.locale === "en" || patch?.locale === "ar" || patch?.locale === "") body.locale = patch.locale;
      return c.request<Profile>("PATCH", "/api/me/profile", { body });
    },
    twoFA: () => c.request<TwoFAState>("GET", "/api/me/2fa"),

    devices: async (): Promise<Device[]> => {
      const mine = deviceName();
      const list = (await c.accessTokens()) ?? [];
      return list
        .map((t) => ({
          id: t.id,
          name: t.name,
          created_at: t.created_at,
          expires_at: t.expires_at || null,
          current: t.name === mine,
          kind: kindOf(t.name),
        }))
        .sort((a, b) => Number(b.current) - Number(a.current) || b.created_at.localeCompare(a.created_at));
    },
    /** Revokes another device. This one signs out instead (which also revokes its token). */
    revokeDevice: async (id: string) => {
      const list = (await c.accessTokens()) ?? [];
      const t = list.find((x) => x.id === String(id));
      if (!t) throw new ApiError(404, "device not found");
      if (t.name === deviceName()) throw new ApiError(409, "this is the device you are using: sign out instead");
      await c.revokeAccessToken(t.id);
    },
  };
}
