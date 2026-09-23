// The signed-in person and their current workspace. One MahaamClient per app (singleton below).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { MahaamClient, MfaRequired } from "@/api/client";
import { api, type Api } from "@/api/endpoints";
import { secureStore } from "@/api/store";
import type { User, Workspace } from "@/api/types";
import { apiUrl } from "@/config";

let lost: (() => void) | null = null;

/**
 * This phone's token name, as the devices list shows it ("Mahaam for iOS — iPhone 17 Pro"): every
 * phone used to be "Mahaam mobile", so a list could not tell them apart or mark this one.
 */
export const DEVICE_NAME = `Mahaam for ${Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "web"} — ${Device.modelName ?? Device.deviceName ?? "phone"}`;

export const client = new MahaamClient({
  baseUrl: apiUrl,
  deviceName: DEVICE_NAME,
  store: secureStore,
  setCsrfCookie:
    Platform.OS === "web"
      ? (v) => {
          document.cookie = `togo_csrf=${v}; path=/; SameSite=Strict`;
        }
      : undefined,
  onSessionLost: () => lost?.(),
});

export const mahaam: Api = api(client);

const WS_KEY = "mahaam.workspace.obj";

type Status = "loading" | "signedOut" | "signedIn";

interface SessionCtx {
  status: Status;
  user: User | null;
  workspace: Workspace | null;
  notice: string | null;
  /** Resolves "mfa" with the challenge when the account has two-factor on. */
  signIn(email: string, password: string): Promise<{ mfa?: string }>;
  completeMfa(challenge: string, answer: { code: string } | { recovery_code: string }): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  /**
   * A passwordless sign-in (lib/social.ts: Apple, or a provider in the browser). Resolves "mfa"
   * with the challenge when the account has two-factor on, and {} when the person cancelled.
   */
  signInSocial(run: () => Promise<User | null>): Promise<{ mfa?: string; canceled?: boolean }>;
  signOut(): Promise<void>;
  chooseWorkspace(ws: Workspace | null): Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ok = await client.restore();
      const raw = await AsyncStorage.getItem(WS_KEY);
      if (ok) {
        setUser(client.user);
        setWorkspace(raw && client.workspace ? (JSON.parse(raw) as Workspace) : null);
        setStatus("signedIn");
      } else setStatus("signedOut");
    })();
  }, []);

  const reset = useCallback(async () => {
    await AsyncStorage.removeItem(WS_KEY);
    qc.clear();
    setUser(null);
    setWorkspace(null);
    setStatus("signedOut");
  }, [qc]);

  useEffect(() => {
    lost = () => {
      setNotice("sessionLost");
      void reset();
    };
    return () => {
      lost = null;
    };
  }, [reset]);

  const value = useMemo<SessionCtx>(
    () => ({
      status,
      user,
      workspace,
      notice,
      async signIn(email, password) {
        try {
          const u = await client.login(email.trim(), password);
          setNotice(null);
          setUser(u);
          setStatus("signedIn");
          return {};
        } catch (e) {
          if (e instanceof MfaRequired) return { mfa: e.challenge };
          throw e;
        }
      },
      async signInSocial(run) {
        try {
          const u = await run();
          if (!u) return { canceled: true };
          setNotice(null);
          setUser(u);
          setStatus("signedIn");
          return {};
        } catch (e) {
          if (e instanceof MfaRequired) return { mfa: e.challenge };
          throw e;
        }
      },
      async completeMfa(challenge, answer) {
        const u = await client.completeMfa(challenge, answer);
        setNotice(null);
        setUser(u);
        setStatus("signedIn");
      },
      async register(name, email, password) {
        const u = await client.register(name.trim(), email.trim(), password);
        // The server's sign-up takes only email and password: the name (and the phone's time zone)
        // go on the profile straight after. A failure here must not undo the new account.
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        await mahaam.me.update({ name: name.trim(), ...(timezone ? { timezone } : {}) }).catch(() => undefined);
        setNotice(null);
        setUser(u);
        setStatus("signedIn");
      },
      async signOut() {
        // Revokes this device's token on the server, not just locally.
        await client.signOut();
        await reset();
      },
      async chooseWorkspace(ws) {
        await client.setWorkspace(ws?.id ?? null);
        if (ws) await AsyncStorage.setItem(WS_KEY, JSON.stringify(ws));
        else await AsyncStorage.removeItem(WS_KEY);
        setWorkspace(ws);
      },
    }),
    [status, user, workspace, notice, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** A customer in this workspace (the portal) rather than staff (projects, time, issues). */
export const isCustomer = (w: Pick<Workspace, "role"> | null | undefined) => w?.role === "client";

/** The current workspace's experience: "customer" shows the portal shell, "staff" the team shell. */
export function useExperience(): "staff" | "customer" | null {
  const { workspace } = useSession();
  return workspace ? (isCustomer(workspace) ? "customer" : "staff") : null;
}
