"use client";
import { useEffect, useState } from "react";
import { browserDb } from "@/client/supabase";
import s from "./Account.module.css";

/** Email link sign in: no passwords to keep. The first sign in creates your company. */
export function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error")) setMsg("That sign in link did not work. It may have expired. Send a new one.");
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const db = browserDb();
    if (!db) return setMsg("Sign in is not set up yet.");
    setState("sending");
    setMsg(null);
    const next = new URLSearchParams(window.location.search).get("next") ?? "/account";
    const { error } = await db.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (error) {
      setState("error");
      setMsg(error.message.includes("rate") ? "Too many sign in emails just now. Wait a minute and try again." : "Could not send the link. Check the address and try again.");
    } else setState("sent");
  }

  return (
    <main className={s.page}>
      <section className={s.signin}>
        <p className="label">Sign in</p>
        <h1 className={s.title}>Your jobs, on every device.</h1>
        {state === "sent" ? (
          <p>Check <strong>{email}</strong> for a sign in link. It opens TierScape signed in. The jobs already in this browser come with you.</p>
        ) : (
          <form className="stack" onSubmit={send}>
            <label className="field">
              <span className="label">Work email</span>
              <input className="input big" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcompany.com" />
            </label>
            <button className="btn solid" disabled={state === "sending" || !email.includes("@")}>{state === "sending" ? "Sending" : "Email me a sign in link"}</button>
            <p className="small">No password. First time here? This creates your company account, and you become its owner.</p>
          </form>
        )}
        {msg && <p className="warn" role="alert">{msg}</p>}
      </section>
    </main>
  );
}
