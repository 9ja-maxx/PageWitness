import { useEffect, useRef, useState } from "react";
import { motion, useInView, animate } from "framer-motion";
import { type Attestation, verifyScreenshotData } from "./lib/contract";
import { shortAddr, timeAgo, hostOf } from "./lib/format";
import { EXPLORER_BASE, CONTRACT_ADDRESS } from "./config";
import {
  Shield,
  ShieldAlert,
  Clock,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  Hash,
  FileCode,
  Image as ImageIcon,
} from "lucide-react";
import confetti from "canvas-confetti";

export function ClaimStatusBadge({ present }: { present: boolean }) {
  return present ? (
    <span className="badge badge-success">
      <Shield size={12} className="ico" />
      <span>Shown</span>
    </span>
  ) : (
    <span className="badge badge-error">
      <ShieldAlert size={12} className="ico" />
      <span>Not Shown</span>
    </span>
  );
}

export function ConfidenceScoreBadge({ level }: { level: string }) {
  const lvl = (level || "low").toLowerCase();
  let cls = "badge-neutral";
  if (lvl === "high") cls = "badge-success";
  if (lvl === "medium") cls = "badge-warning";
  return <span className={`badge ${cls}`}>{lvl}</span>;
}

function SmoothCountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const controls = animate(0, value, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setCurrent(Math.round(latest)),
    });
    return () => controls.stop();
  }, [isInView, value]);

  return <span ref={ref}>{current}</span>;
}

export function StatsCard({
  label,
  value,
  icon,
  countTo,
  index = 0,
}: {
  label: string;
  value?: React.ReactNode;
  icon?: React.ReactNode;
  countTo?: number;
  index?: number;
}) {
  return (
    <motion.div
      className="stats-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
    >
      <div className="card-header">
        <span className="stats-label">{label}</span>
        <span className="stats-icon-wrapper">{icon}</span>
      </div>
      <div className="stats-value">
        {countTo != null ? <SmoothCountUp value={countTo} /> : value}
      </div>
    </motion.div>
  );
}

export function AttestationRowTable({
  rows,
  onSelect,
  selectedId,
}: {
  rows: Attestation[];
  onSelect: (a: Attestation) => void;
  selectedId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <Clock size={36} className="empty-ico" />
        <h3>No attestations record found</h3>
        <p className="muted">Submit your first webpage URL above to kick off consensus.</p>
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="witness-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Target Website</th>
            <th>Question/Claim</th>
            <th>Consensus Result</th>
            <th>Confidence</th>
            <th>Finalized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <motion.tr
              key={row.id}
              className={`table-row ${selectedId === row.id ? "selected" : ""}`}
              onClick={() => onSelect(row)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(idx * 0.04, 0.5) }}
            >
              <td className="mono-cell">#{row.id}</td>
              <td className="domain-cell" title={row.url}>
                {hostOf(row.url)}
              </td>
              <td className="claim-cell" title={row.question}>
                {row.question}
              </td>
              <td>
                <ClaimStatusBadge present={row.claim_present} />
              </td>
              <td>
                <ConfidenceScoreBadge level={row.confidence} />
              </td>
              <td className="time-cell">{timeAgo(row.created_at)}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttestationDetailViewer({
  a,
  onClose,
}: {
  a: Attestation;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [offlineScreenshotB64, setOfflineScreenshotB64] = useState<string | null>(null);
  const [offlineVerificationStatus, setOfflineVerificationStatus] = useState<"idle" | "verifying" | "success" | "fail">("idle");
  const [integrityStatus, setIntegrityStatus] = useState<"verifying" | "success" | "fail" | "no_capture">(
    "verifying",
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOfflineVerificationStatus("verifying");
    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result as string;
      const base64Data = result.split(",")[1];
      setOfflineScreenshotB64(base64Data);
      
      try {
        const isValid = await verifyScreenshotData(a.id, base64Data);
        if (isValid) {
          setOfflineVerificationStatus("success");
          confetti({
            particleCount: 60,
            spread: 70,
            origin: { y: 0.8 },
            colors: ["#a855f7", "#3b82f6", "#10b981"],
          });
        } else {
          setOfflineVerificationStatus("fail");
        }
      } catch (err) {
        console.error("Error calling verify_screenshot_data:", err);
        setOfflineVerificationStatus("fail");
      }
    };
    reader.readAsDataURL(file);
  };
  
  const hasScreenshot = Boolean(a.screenshot_b64);
  const screenshotSource = hasScreenshot ? `data:image/png;base64,${a.screenshot_b64}` : null;

  useEffect(() => {
    if (!a.stored_screenshot || !hasScreenshot) {
      setIntegrityStatus("no_capture");
      return;
    }
    
    let active = true;
    setIntegrityStatus("verifying");
    
    async function checkHashIntegrity() {
      try {
        const binaryString = atob(a.screenshot_b64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
        const hex = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        
        if (!active) return;
        
        if (hex === a.screenshot_hash) {
          setIntegrityStatus("success");
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.8 },
            colors: ["#a855f7", "#3b82f6", "#10b981"],
          });
        } else {
          setIntegrityStatus("fail");
        }
      } catch {
        if (active) setIntegrityStatus("fail");
      }
    }
    
    checkHashIntegrity();
    return () => {
      active = false;
    };
  }, [a.screenshot_b64, a.screenshot_hash, a.stored_screenshot, hasScreenshot]);

  const copyLink = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#/attestation/${a.id}`;
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      className="detail-panel"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: "spring", stiffness: 350, damping: 30 }}
    >
      <div className="detail-header">
        <div>
          <h3>Attestation Audit #{a.id}</h3>
          <span className="muted-subtitle">Stored Block Record</span>
        </div>
        <button className="close-btn" onClick={onClose}>Close</button>
      </div>

      <div className="detail-body">
        <div className="verdict-banner">
          <div className="verdict-badges">
            <ClaimStatusBadge present={a.claim_present} />
            <ConfidenceScoreBadge level={a.confidence} />
            <span className="badge badge-final">finalized</span>
          </div>
          <div className="timestamp-tag">
            <Clock size={12} className="ico" />
            <span>{a.created_at}</span>
          </div>
        </div>

        <div className="audit-section">
          <h4>Question Evaluated</h4>
          <p className="claim-text">"{a.question}"</p>
        </div>

        <div className="audit-section">
          <h4>Target URL</h4>
          <a href={a.url} target="_blank" rel="noreferrer" className="target-link">
            {a.url}
            <ExternalLink size={12} className="ico" />
          </a>
        </div>

        <div className="audit-section">
          <h4>Semantic Evidence Extracted</h4>
          <blockquote className="evidence-quote">
            {a.exact_text || <span className="muted">No explicit text extracted.</span>}
          </blockquote>
        </div>

        {a.caveats && (
          <div className="audit-section">
            <h4>Validator Caveats</h4>
            <div className="caveat-box">
              <AlertCircle size={14} className="warn-ico" />
              <span>{a.caveats}</span>
            </div>
          </div>
        )}

        <div className="audit-section split-grid">
          <div>
            <h4>Audit Integrity Hash</h4>
            <div className="hash-container">
              <Hash size={14} className="hash-ico" />
              <span className="mono-text" title={a.screenshot_hash}>
                {shortAddr(a.screenshot_hash, 10)}
              </span>
            </div>
          </div>
          <div>
            <h4>Requester Address</h4>
            <span className="mono-text">{shortAddr(a.requester, 6)}</span>
          </div>
        </div>

        <div className="audit-section">
          <h4>Visual Evidence Capture</h4>
          {a.stored_screenshot && screenshotSource ? (
            <div className="screenshot-box">
              <img src={screenshotSource} alt="Consensus screenshot capture" />
              <div className="integrity-footer">
                {integrityStatus === "verifying" && (
                  <span className="integrity-status pending">Verifying audit integrity...</span>
                )}
                {integrityStatus === "success" && (
                  <span className="integrity-status success">
                    ✓ Integrity Verified (SHA-256 matches chain state)
                  </span>
                )}
                {integrityStatus === "fail" && (
                  <span className="integrity-status fail">
                    ✗ Mismatch: Local capture differs from stored hash
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="no-screenshot-message">
              <ImageIcon size={20} className="muted-icon" />
              <span className="muted">
                {a.stored_screenshot
                  ? "Screenshot was requested but data is missing."
                  : "Screenshot storage was bypassed for this transaction to optimize gas."}
              </span>
              {!a.stored_screenshot && (
                <div className="offline-verify-box" style={{ marginTop: 12, width: "100%", borderTop: "1px solid var(--card-border)", paddingTop: 12 }}>
                  <p style={{ fontSize: 12, marginBottom: 8, color: "var(--text-low)" }}>
                    Have the offline PNG screenshot? Verify it on-chain:
                  </p>
                  <input
                    type="file"
                    accept="image/png"
                    onChange={handleFileUpload}
                    style={{ display: "none" }}
                    id="offline-screenshot-upload"
                  />
                  <label
                    htmlFor="offline-screenshot-upload"
                    className="action-btn share-btn"
                    style={{ cursor: "pointer", display: "inline-flex", width: "auto", padding: "6px 12px", fontSize: 12 }}
                  >
                    Choose PNG File
                  </label>
                  {offlineVerificationStatus === "verifying" && (
                    <p className="integrity-status pending" style={{ marginTop: 8, fontSize: 12 }}>Verifying on-chain...</p>
                  )}
                  {offlineVerificationStatus === "success" && (
                    <div style={{ marginTop: 8 }}>
                      <p className="integrity-status success" style={{ fontSize: 12, fontWeight: "bold" }}>
                        ✓ Recoverable Proof Verified On-Chain!
                      </p>
                      {offlineScreenshotB64 && (
                        <div className="screenshot-box" style={{ marginTop: 8 }}>
                          <img src={`data:image/png;base64,${offlineScreenshotB64}`} alt="Verified offline screenshot" />
                        </div>
                      )}
                    </div>
                  )}
                  {offlineVerificationStatus === "fail" && (
                    <p className="integrity-status fail" style={{ marginTop: 8, fontSize: 12 }}>
                      ✗ Verification Failed: Screenshot does not match stored hash.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="detail-actions">
          <button className="action-btn share-btn" onClick={copyLink}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? "Copied" : "Copy Link"}</span>
          </button>
          <a
            href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="action-btn explorer-btn"
          >
            <FileCode size={14} />
            <span>Open Explorer</span>
          </a>
        </div>
      </div>
    </motion.div>
  );
}
