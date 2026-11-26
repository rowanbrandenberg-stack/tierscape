"use client";
import { useState } from "react";
import { NewJob } from "./NewJob";
import { NewPhotoJob } from "./NewPhotoJob";
import s from "./home.module.css";

/** Two ways in: a photo and a request, or an address to plan on the aerial. Both end in the same proposal. */
export function StartJob() {
  const [mode, setMode] = useState<"photo" | "address">("photo");
  return (
    <div>
      <div className={`seg ${s.startSwitch}`} role="group" aria-label="How to start the job">
        <button type="button" aria-pressed={mode === "photo"} onClick={() => setMode("photo")}>From a photo</button>
        <button type="button" aria-pressed={mode === "address"} onClick={() => setMode("address")}>From an address</button>
      </div>
      {mode === "photo" ? <NewPhotoJob /> : <NewJob />}
    </div>
  );
}
