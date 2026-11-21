"use client";
import { create } from "zustand";
import type { Access } from "@/lib/billing/core";
import type { Cadence, PlanKey } from "@/lib/billing/plans";

export interface Me {
  accounts: boolean;
  checkout: boolean;
  founding: { limit: number; remaining: number | null };
  signedIn: boolean;
  email?: string | null;
  role?: string | null;
  canManageBilling?: boolean;
  company?: { id: string; name: string; trialStartedAt: number | null; hold: string | null } | null;
  access?: Access;
  subscription?: { plan: PlanKey; cadence: Cadence; status: string; periodEnd: number; cancelAtPeriodEnd: boolean; founding: { paidPeriods: number; left: number } | null } | null;
  nextCharge?: { at: number; amount: number } | null;
  foundingUsed?: boolean;
  usage?: { images: { used: number; allowance: number; resetsAt: number | null } };
}

/**
 * Where the account copy of jobs stands. `off` means nothing is uploaded: not
 * signed in, or accounts are not connected. The browser copy is always saved.
 */
export type CloudState = "off" | "loading" | "ready";
export type SyncState = "idle" | "pending" | "saving" | "saved" | "offline" | "error";

interface State {
  me: Me | null;
  /** Last cloud save problem, shown quietly so local work is never lost. */
  syncNote: string | null;
  cloud: CloudState;
  sync: SyncState;
  /** When the last upload to the account succeeded. */
  syncedAt: number | null;
  /** True once the first account check has answered, even if it failed. */
  checked: boolean;
  refresh: () => Promise<Me | null>;
}

export const useAccount = create<State>()((set) => ({
  me: null,
  syncNote: null,
  cloud: "off",
  sync: "idle",
  syncedAt: null,
  checked: false,
  refresh: async () => {
    const me = (await fetch("/api/account/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as Me | null;
    set({ me, checked: true });
    return me;
  },
}));
