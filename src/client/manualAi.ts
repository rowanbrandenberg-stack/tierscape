"use client";
import { create } from "zustand";

/**
 * Manual mode: until the API keys are in, Tierscape hands the exact prompt
 * and files to the contractor, who runs them in their own Claude or ChatGPT
 * and pastes the answer back. Same prompts, same answer shape.
 */
export type ManualTarget = "claude" | "chatgpt";

export interface ManualRequest {
  id: number;
  target: ManualTarget;
  title: string;
  prompt: string;
  files: { name: string; blob: Blob }[];
  answer: "json" | "image";
  /** Checks a pasted answer. Return an error message to keep the dialog open. */
  check?: (text: string) => string | null;
  resolve: (v: string | Blob) => void;
  reject: (e: Error) => void;
}

interface State {
  req: ManualRequest | null;
}

export const useManualAi = create<State>()(() => ({ req: null }));

let seq = 0;

export class ManualCancelled extends Error {
  constructor() {
    super("Cancelled.");
  }
}

export function askManually(r: Omit<ManualRequest, "id" | "resolve" | "reject">): Promise<string | Blob> {
  return new Promise((resolve, reject) => {
    useManualAi.getState().req?.reject(new ManualCancelled());
    useManualAi.setState({ req: { ...r, id: ++seq, resolve, reject } });
  });
}

export function closeManual() {
  useManualAi.setState({ req: null });
}
