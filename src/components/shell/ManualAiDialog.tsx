"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { closeManual, ManualCancelled, useManualAi } from "@/client/manualAi";
import s from "./ManualAiDialog.module.css";

const APPS = {
  claude: { name: "Claude", url: "https://claude.ai/new" },
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/" },
};

/** The bridge to the contractor's own Claude or ChatGPT while the API keys are not set. */
export function ManualAiDialog() {
  const req = useManualAi((x) => x.req);
  const dlg = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urls = useMemo(() => (req ? req.files.map((f) => URL.createObjectURL(f.blob)) : []), [req]);

  useEffect(() => {
    setText("");
    setErr(null);
    setCopied(false);
    if (req && !dlg.current?.open) dlg.current?.showModal();
    if (!req && dlg.current?.open) dlg.current.close();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [req, urls]);

  if (!req) return <dialog ref={dlg} className={s.dlg} />;
  const app = APPS[req.target];

  function cancel() {
    req!.reject(new ManualCancelled());
    closeManual();
  }

  function submit() {
    if (!text.trim()) return setErr(`Paste ${app.name}'s answer first.`);
    const problem = req!.check?.(text) ?? null;
    if (problem) return setErr(problem);
    req!.resolve(text);
    closeManual();
  }

  function image(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setErr("Choose the image file ChatGPT made.");
    req!.resolve(f);
    closeManual();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(req!.prompt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog ref={dlg} className={s.dlg} onCancel={(e) => { e.preventDefault(); cancel(); }} aria-labelledby="manual-h">
      <div className={s.body}>
        <div className="spread">
          <h2 id="manual-h" className="head">{req.title}</h2>
          <button className="link" onClick={cancel}>Cancel</button>
        </div>
        <p className="small muted">Manual test: TierScape is not connected to an AI service, so this step runs in your own {app.name} account. Three steps.</p>

        <ol className={s.steps}>
          {req.files.length > 0 && (
            <li>
              <strong>Save {req.files.length === 1 ? "this file" : "these files"}</strong>
              <div className="row">
                {req.files.map((f, i) => (
                  <a key={f.name} className="btn sm" href={urls[i]} download={f.name}>Download {f.name}</a>
                ))}
              </div>
            </li>
          )}
          <li>
            <strong>Open {app.name}{req.files.length ? ", attach the files" : ""} and paste the prompt</strong>
            <textarea className={`input ${s.prompt}`} readOnly value={req.prompt} rows={6} onFocus={(e) => e.currentTarget.select()} aria-label="Prompt" />
            <div className="row">
              <button className="btn sm solid" onClick={copy}>{copied ? "Copied" : "Copy prompt"}</button>
              <a className="btn sm quiet" href={app.url} target="_blank" rel="noreferrer">Open {app.name} ↗</a>
            </div>
          </li>
          <li>
            {req.answer === "json" ? (
              <>
                <strong>Paste {app.name}&apos;s whole answer here</strong>
                <textarea className={`input ${s.answer}`} rows={6} value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} placeholder={`Paste the reply from ${app.name}`} aria-label="Answer" />
                <div className="row">
                  <button className="btn sm solid" onClick={submit}>Use this answer</button>
                </div>
              </>
            ) : (
              <>
                <strong>Save the image {app.name} made, then choose it here</strong>
                <label className="btn sm solid" style={{ alignSelf: "flex-start" }}>
                  Choose image
                  <input type="file" accept="image/*" hidden onChange={(e) => image(e.target.files?.[0])} />
                </label>
              </>
            )}
            {err && <p className="warn" role="alert">{err}</p>}
          </li>
        </ol>
      </div>
    </dialog>
  );
}
