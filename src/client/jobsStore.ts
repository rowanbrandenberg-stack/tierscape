"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Job } from "@/lib/types";

/** Saved jobs. Photo image data is kept out of here (see photoStore). */
interface JobsState {
  jobs: Record<string, Job>;
  save: (job: Job) => void;
  remove: (id: string) => void;
}

const strip = (job: Job): Job => ({ ...job, photos: job.photos.map((p) => ({ ...p, dataUrl: null })) });

export const useJobs = create<JobsState>()(
  persist(
    (set) => ({
      jobs: {},
      save: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: strip({ ...job, updatedAt: new Date().toISOString() }) } })),
      remove: (id) =>
        set((s) => {
          const jobs = { ...s.jobs };
          delete jobs[id];
          return { jobs };
        }),
    }),
    { name: "tierscape.jobs", version: 1 },
  ),
);
