"use client";
import { useEffect, useState } from "react";
import { api, type Features } from "./api";

let cache: Features | null = null;

/** Which server features are configured, fetched once per session. */
export function useFeatures(): Features | null {
  const [f, setF] = useState<Features | null>(cache);
  useEffect(() => {
    if (cache) return;
    api.features().then((x) => setF((cache = x))).catch(() => undefined);
  }, []);
  return f;
}
