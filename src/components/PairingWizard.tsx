import { memo, useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  mode: "initiator" | "responder";
  peerDeviceId: string;
  peerDeviceName: string;
  code?: string;
  onClose: () => void;
}

type Step = "showing-code" | "entering-code" | "verifying" | "success" | "error";

export default memo(function PairingWizard({ mode, peerDeviceId, peerDeviceName, code, onClose }: Props) {
  const [step, setStep] = useState<Step>(mode === "initiator" ? "showing-code" : "entering-code");
  const [inputCode, setInputCode] = useState("");
  const [progress, setProgress] = useState("Waiting for other device...");
  const [errorMsg, setErrorMsg] = useState("");
  const [pairedName, setPairedName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "responder") setTimeout(() => inputRef.current?.focus(), 100);
  }, [mode]);

  useEffect(() => {
    const unsubs: Promise<() => void>[] = [];
    unsubs.push(listen<{ step: string }>("pair-progress", e => setProgress(e.payload.step)));
    unsubs.push(listen<{ device_id: string; device_name: string }>("pair-complete", e => {
      setPairedName(e.payload.device_name);
      setStep("success");
    }));
    unsubs.push(listen<{ message: string }>("pair-error", e => {
      setErrorMsg(e.payload.message);
      setStep("error");
    }));
    return () => { unsubs.forEach(p => p.then(fn => fn())); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submitCode = useCallback(async () => {
    if (inputCode.length !== 6) return;
    setStep("verifying");
    setProgress("Verifying code...");
    try {
      await invoke("enter_pairing_code", { peerId: peerDeviceId, code: inputCode });
    } catch (e: any) {
      setErrorMsg(String(e));
      setStep("error");
    }
  }, [inputCode, peerDeviceId]);

  return (
    <div className="pair-overlay" onClick={onClose}>
      <div className="pair-wizard" onClick={e => e.stopPropagation()}>
        <div className="pair-header">
          <span className="pair-header-title">
            {step === "success" ? "Paired!" : step === "error" ? "Pairing Failed" : "Pair Device"}
          </span>
          <button className="pair-close-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="pair-body">
          {step === "showing-code" && (
            <>
              <p className="pair-instruction">
                Enter this code on <strong>{peerDeviceName || "the other device"}</strong>:
              </p>
              <div className="pair-code-display">
                {code?.split("").map((digit, i) => (
                  <span key={i} className="pair-code-digit">{digit}</span>
                ))}
              </div>
              <p className="pair-status">{progress}</p>
            </>
          )}

          {step === "entering-code" && (
            <>
              <p className="pair-instruction">
                <strong>{peerDeviceName || "A device"}</strong> wants to pair.
                Enter the 6-digit code shown on that device:
              </p>
              <input
                ref={inputRef}
                className="pair-code-input"
                value={inputCode}
                onChange={e => setInputCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={e => { if (e.key === "Enter") submitCode(); }}
                placeholder="000000"
                maxLength={6}
                spellCheck={false}
                autoFocus
              />
              <button className="pair-submit-btn" onClick={submitCode} disabled={inputCode.length !== 6}>
                Verify
              </button>
            </>
          )}

          {step === "verifying" && (
            <>
              <div className="pair-spinner" />
              <p className="pair-status">{progress}</p>
            </>
          )}

          {step === "success" && (
            <>
              <div className="pair-success-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="22" stroke="var(--accent)" strokeWidth="2.5" />
                  <path d="M14 24L21 31L34 18" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p className="pair-instruction">Successfully paired with <strong>{pairedName}</strong></p>
              <button className="pair-submit-btn" onClick={onClose}>Done</button>
            </>
          )}

          {step === "error" && (
            <>
              <div className="pair-error-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="22" stroke="#ef4444" strokeWidth="2.5" />
                  <path d="M16 16L32 32M32 16L16 32" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </div>
              <p className="pair-instruction pair-error-text">{errorMsg}</p>
              <button className="pair-submit-btn" onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
