// The signed-in person: profile, two-factor state, email verification.
import { useQuery } from "@tanstack/react-query";

import { mahaam, useSession } from "@/lib/session";

export const accountKeys = {
  profile: (user: string) => ["me", user, "profile"] as const,
  twoFA: (user: string) => ["me", user, "2fa"] as const,
  verify: (user: string) => ["me", user, "verify"] as const,
};

export function useProfile() {
  const { user, status } = useSession();
  return useQuery({ queryKey: accountKeys.profile(user?.id ?? ""), queryFn: mahaam.me.profile, enabled: status === "signedIn" && !!user });
}

export function useTwoFA() {
  const { user, status } = useSession();
  return useQuery({ queryKey: accountKeys.twoFA(user?.id ?? ""), queryFn: mahaam.me.twoFA, enabled: status === "signedIn" && !!user });
}

export function useVerifyState() {
  const { user, status } = useSession();
  return useQuery({ queryKey: accountKeys.verify(user?.id ?? ""), queryFn: mahaam.me.verifyState, enabled: status === "signedIn" && !!user });
}
