"use client";
import { useEffect, useState } from "react";

/** True after the first client render, so persisted stores never cause a hydration mismatch. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}
