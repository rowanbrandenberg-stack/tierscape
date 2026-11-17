"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultSettings, type Pricing, type Profile, type Settings } from "@/lib/settings";

interface SettingsState extends Settings {
  setProfile: (p: Partial<Profile>) => void;
  setPricing: (fn: (p: Pricing) => void) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings(),
      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      setPricing: (fn) =>
        set((s) => {
          const next = structuredClone(s.pricing);
          fn(next);
          return { pricing: next };
        }),
      reset: () => set(defaultSettings()),
    }),
    {
      name: "tierscape.settings",
      version: 1,
      // Saved settings from older versions lack newer profile fields, so fill them from the defaults.
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<Settings>;
        return { ...current, ...s, profile: { ...current.profile, ...(s.profile ?? {}) }, pricing: { ...current.pricing, ...(s.pricing ?? {}) } };
      },
    },
  ),
);
