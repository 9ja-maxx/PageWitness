import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWalletAuth } from "./wallet";
import { executeAttestationRequest } from "./lib/contract";
import { formatGEN, describeError } from "./lib/format";
import {
  Send,
  AlertTriangle,
  Clock,
  Cpu,
  CheckCircle,
} from "lucide-react";

const SUGGESTED_TEMPLATES = [
  "Does this page claim that the token supply is capped at 21,000,000?",
  "Does this page state a guaranteed annual percentage yield (APY)?",
  "Does this page list a security audit by a recognized auditing firm?",
  "Does this page specify the team or founder vesting timeline?",
];

type AttestationPhase = "idle" | "initiating" | "consensus" | "finalized" | "error";

export function NewAttestation({
  fee,
  onCreated,
}: {
  fee: bigint | null;
  onCreated: () => void;
}) {
  const { ready, authenticated, login, getClient } = useWalletAuth();
  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [storeScreenshot, setStoreScreenshot] = useState(false);
  const [phase, setPhase] = useState<AttestationPhase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const isProcessing = phase === "initiating" || phase === "consensus";
  const isFormValid =
    ready && authenticated && url.trim() && question.trim() && fee != null && !isProcessing;

  async function handleFormSubmit() {
    setErrorMsg(null);
    setTxHash(null);
    try {
      const client = await getClient();
      const cleanUrl = url.trim();
      const cleanQuestion = question.trim();
      
      const result = await executeAttestationRequest(
        client,
        cleanUrl,
        cleanQuestion,
        storeScreenshot,
        fee ?? 0n,
        (currentPhase) => setPhase(currentPhase),
      );
      
      setTxHash(result.txHash);
      if (result.success) {
        setPhase("finalized");
        setUrl("");
        setQuestion("");
        onCreated();
      } else {
        setPhase("error");
        setErrorMsg("Attestation failed: Consensus could not resolve a valid result.");
      }
    } catch (err) {
      setPhase("error");
      setErrorMsg(describeError(err));
    }
  }

  return (
    <motion.div
      className="form-card"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="form-header">
        <div>
          <h3>Create Page Attestation</h3>
          <p className="muted">Independently audited by GenLayer AI Consensus</p>
        </div>
        {fee != null && (
          <span className="fee-badge">Fee: {formatGEN(fee)} GEN</span>
        )}
      </div>

      <div className="form-body">
        <div className="form-field">
          <label>Webpage URL</label>
          <input
            type="url"
            className="text-input"
            placeholder="https://example.com/tokenomics"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isProcessing}
          />
        </div>

        <div className="form-field">
          <label>Assertion to Verify (Yes/No Question)</label>
          <textarea
            className="textarea-input"
            placeholder="e.g. Does this page explicitly state that the token audit was successful?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isProcessing}
          />
          <div className="template-chips">
            {SUGGESTED_TEMPLATES.map((tmpl) => (
              <button
                key={tmpl}
                type="button"
                className="chip-btn"
                onClick={() => setQuestion(tmpl)}
                disabled={isProcessing}
              >
                {tmpl}
              </button>
            ))}
          </div>
        </div>

        <div className="form-field checkbox-field">
          <label className="checkbox-container">
            <input
              type="checkbox"
              checked={storeScreenshot}
              onChange={(e) => setStoreScreenshot(e.target.checked)}
              disabled={isProcessing}
            />
            <span className="checkmark" />
            <span className="label-text">
              <strong>Store visual screenshot in contract state</strong>
              <span className="subtext">
                Only enable if you need the full screenshot saved permanently on-chain. Bypassing it optimizes gas.
              </span>
            </span>
          </label>
        </div>

        {!authenticated ? (
          <button className="submit-btn primary-btn" onClick={login} disabled={!ready}>
            Connect Wallet to Attest
          </button>
        ) : (
          <button
            className="submit-btn primary-btn"
            onClick={handleFormSubmit}
            disabled={!isFormValid}
          >
            {isProcessing ? <span className="btn-spinner" /> : <><Send size={14} /><span>Request Attestation</span></>}
          </button>
        )}

        <AnimatePresence>
          {phase !== "idle" && (
            <motion.div
              className="progress-steps-box"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <ul className="stepper">
                <li className={getStepStatus(phase, "initiating")}>
                  <div className="step-ico-box"><Clock size={12} /></div>
                  <span>Initiating transaction & gas payment</span>
                </li>
                <li className={getStepStatus(phase, "consensus")}>
                  <div className="step-ico-box"><Cpu size={12} /></div>
                  <span>Validators rendering & running semantic consensus</span>
                </li>
                <li className={getStepStatus(phase, "finalized")}>
                  <div className="step-ico-box"><CheckCircle size={12} /></div>
                  <span>Attestation record finalized on-chain</span>
                </li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {phase === "error" && errorMsg && (
          <div className="error-alert">
            <AlertTriangle size={16} className="alert-ico" />
            <div>
              <strong>Adjudication Failed</strong>
              <p>{errorMsg}</p>
            </div>
          </div>
        )}

        {txHash && (
          <div className="tx-helper">
            <span>Tx Hash: </span>
            <span className="mono-hash">{txHash}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function getStepStatus(phase: AttestationPhase, step: "initiating" | "consensus" | "finalized"): string {
  const stepsOrder: AttestationPhase[] = ["initiating", "consensus", "finalized"];
  const currentIdx = stepsOrder.indexOf(phase);
  const stepIdx = stepsOrder.indexOf(step);
  
  if (phase === "finalized" || currentIdx > stepIdx) return "step-done";
  if (currentIdx === stepIdx) return "step-active";
  return "step-idle";
}
