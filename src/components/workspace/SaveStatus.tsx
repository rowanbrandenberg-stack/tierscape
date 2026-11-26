"use client";
import Link from "next/link";
import { useAccount } from "@/client/account";
import s from "./Workspace.module.css";

type Tone = "ok" | "busy" | "local" | "warn";

/**
 * Says plainly where this job is saved. The browser copy is always written
 * first; the account copy only exists once someone is signed in. Site photos
 * never leave the device, so that is said too.
 */
export function SaveStatus({ sample, localSaved, hasPhotos }: { sample: boolean; localSaved: boolean; hasPhotos: boolean }) {
  const me = useAccount((x) => x.me);
  const cloud = useAccount((x) => x.cloud);
  const sync = useAccount((x) => x.sync);
  const note = useAccount((x) => x.syncNote);

  let tone: Tone;
  let text: string;
  let detail: React.ReactNode = null;

  if (sample) {
    tone = "local";
    text = "Sample job, saved in this browser";
    detail = "It is never uploaded or shared. Start a job from a photo or an address for real work.";
  } else if (!localSaved) {
    tone = "busy";
    text = "Saving…";
  } else if (cloud === "off") {
    tone = "local";
    text = "Saved in this browser only";
    detail = me?.accounts && !me.signedIn ? (
      <>
        Clearing browser data deletes it. <Link className="link" href="/signin?next=/account">Sign in</Link> to keep it in your account.
      </>
    ) : (
      note ?? "Clearing browser data deletes it. Download a copy any time from Account."
    );
  } else if (cloud === "loading") {
    tone = "busy";
    text = "Saved in this browser, connecting to your account…";
  } else if (sync === "pending" || sync === "saving") {
    tone = "busy";
    text = "Saved in this browser, uploading to your account…";
  } else if (sync === "offline") {
    tone = "warn";
    text = "Saved in this browser. Offline, uploads when you reconnect";
  } else if (sync === "error") {
    tone = "warn";
    text = "Saved in this browser only";
    detail = note ?? "Your account did not accept the last change.";
  } else {
    tone = "ok";
    text = "Saved to your account";
  }

  const photos = hasPhotos && !sample ? "Site photos stay on this device and are not uploaded." : null;

  return (
    <p className={s.save} data-tone={tone} role="status" aria-live="polite">
      <span className={s.dot} aria-hidden="true" />
      <span>
        <strong>{text}</strong>
        {(detail || photos) && (
          <span className={s.saveDetail}>
            {detail} {photos}
          </span>
        )}
      </span>
    </p>
  );
}
