import { useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  PRIVY_APP_ID,
  CONTRACT_ADDRESS,
  FAUCET_URL,
  EXPLORER_BASE,
} from "./config";
import {
  fetchFee,
  fetchCount,
  fetchRecent,
  fetchByRequester,
  type Attestation,
} from "./lib/contract";
import { shortAddr, describeError, formatGEN } from "./lib/format";
import {
  StatsCard,
  AttestationRowTable,
  AttestationDetailViewer,
} from "./components";
import { NewAttestation } from "./NewAttestation";
import { WalletStatusButton, useWalletAuth } from "./wallet";
import {
  ShieldCheck,
  Globe,
  Database,
  Coins,
  RefreshCw,
  AlertTriangle,
  Github,
  Twitter,
  Eye,
  Info,
} from "lucide-react";

const GITHUB_REPO = "https://github.com/9ja_maxx/PageWitness";

export default function App() {
  const [activeTab, setActiveTab] = useState<"global" | "personal">("global");
  const [fee, setFee] = useState<bigint | null>(null);
  const [count, setCount] = useState<number>(0);
  const [recentAttestations, setRecentAttestations] = useState<Attestation[]>([]);
  const [selectedAttestation, setSelectedAttestation] = useState<Attestation | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isPrivyEnabled = Boolean(PRIVY_APP_ID);
  const isContractConfigured = Boolean(CONTRACT_ADDRESS);

  const refreshData = useCallback(async () => {
    if (!isContractConfigured) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      // sequential reads to avoid RPC rate limit
      const contractFee = await fetchFee();
      setFee(contractFee);
      const totalCount = await fetchCount();
      setCount(totalCount);
      const recentList = await fetchRecent(25);
      setRecentAttestations(recentList);
    } catch (e) {
      console.error("Failed to load contract state:", e);
      setErrorMessage(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [isContractConfigured]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const validatedCount = recentAttestations.filter((a) => a.claim_present).length;

  return (
    <div className="site-wrapper">
      <nav className="navbar">
        <div className="container navbar-inner">
          <div className="brand">
            <div className="brand-icon-box">
              <Eye size={18} />
            </div>
            <span className="brand-title">PageWitness</span>
          </div>

          <div className="nav-actions">
            <div className="view-selector">
              <button
                className={`view-btn ${activeTab === "global" ? "active" : ""}`}
                onClick={() => setActiveTab("global")}
              >
                Global registry
              </button>
              <button
                className={`view-btn ${activeTab === "personal" ? "active" : ""}`}
                onClick={() => setActiveTab("personal")}
              >
                My Audits
              </button>
            </div>

            <button
              className="view-btn"
              onClick={refreshData}
              disabled={loading}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              <span>Sync</span>
            </button>

            {isPrivyEnabled && <WalletStatusButton />}
            
            <a href={GITHUB_REPO} target="_blank" rel="noreferrer" className="social-icon">
              <Github size={18} />
            </a>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="container">
          <span className="hero-tag">
            <ShieldCheck size={12} style={{ color: "#a855f7" }} />
            <span>AI-Driven Web Verification Protocol</span>
          </span>
          <h1>
            Decentralized Web Proofs with <span className="highlight">Semantic Consensus</span>
          </h1>
          <p>
            Prove visual contents and published claims on public webpages. Powered by
            GenLayer browser rendering and vision LLM validators.
          </p>
        </div>
      </header>

      <main className="container" style={{ flex: 1 }}>
        {errorMessage && (
          <div className="warn-banner warn-banner-red">
            <AlertTriangle size={16} />
            <span>
              <strong>RPC Connection Issue:</strong> {errorMessage}
            </span>
          </div>
        )}

        {!isContractConfigured && (
          <div className="warn-banner warn-banner-orange">
            <Info size={16} />
            <span>
              <strong>Contract setup needed:</strong> Add `VITE_CONTRACT_ADDRESS` to your `frontend/.env` variables.
            </span>
          </div>
        )}

        {!isPrivyEnabled && (
          <div className="warn-banner warn-banner-orange">
            <Info size={16} />
            <span>
              <strong>Authentication bypassed:</strong> `VITE_PRIVY_APP_ID` is missing. PageWitness dashboard is running in read-only mode.
            </span>
          </div>
        )}

        <section className="stats-grid">
          <StatsCard
            label="Total Audits Finalized"
            countTo={count}
            icon={<Database size={16} />}
            index={0}
          />
          <StatsCard
            label="Attestation Fee"
            value={fee != null ? `${formatGEN(fee)} GEN` : "0 GEN"}
            icon={<Coins size={16} />}
            index={1}
          />
          <StatsCard
            label="Attested (Recent)"
            value={`${validatedCount} / ${recentAttestations.length}`}
            icon={<ShieldCheck size={16} />}
            index={2}
          />
          <StatsCard
            label="Consensus Core"
            value="Bradbury Net"
            icon={<Globe size={16} />}
            index={3}
          />
        </section>

        <div className="dashboard-layout">
          <div className="main-column">
            {activeTab === "global" ? (
              <div className="panel-card">
                <div className="panel-header">
                  <h2>Recent Attestations feed</h2>
                </div>
                <AttestationRowTable
                  rows={recentAttestations}
                  onSelect={setSelectedAttestation}
                  selectedId={selectedAttestation?.id ?? null}
                />
              </div>
            ) : (
              <PersonalAttestationsFeed
                onSelect={setSelectedAttestation}
                selectedId={selectedAttestation?.id ?? null}
              />
            )}
          </div>

          <div className="side-column">
            {isPrivyEnabled ? (
              <NewAttestation fee={fee} onCreated={refreshData} />
            ) : (
              <SetupInstructionsCard />
            )}

            <AnimatePresence>
              {selectedAttestation && (
                <AttestationDetailViewer
                  a={selectedAttestation}
                  onClose={() => setSelectedAttestation(null)}
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-links">
            <span>PageWitness © 2026</span>
            {isContractConfigured && (
              <>
                <span>·</span>
                <a
                  href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono-text"
                >
                  Contract: {shortAddr(CONTRACT_ADDRESS, 6)}
                </a>
              </>
            )}
            <span>·</span>
            <a href={FAUCET_URL} target="_blank" rel="noreferrer">
              Testnet Faucet
            </a>
          </div>
          <div className="social-links">
            <a href={GITHUB_REPO} target="_blank" rel="noreferrer" className="social-icon">
              <Github size={16} />
            </a>
            <a href="https://x.com" target="_blank" rel="noreferrer" className="social-icon">
              <Twitter size={16} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SetupInstructionsCard() {
  return (
    <div className="panel-card">
      <div className="panel-header" style={{ marginBottom: 12 }}>
        <h2>Configure Credentials</h2>
      </div>
      <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.8 }}>
        <p style={{ marginBottom: 12 }}>
          To unlock the transaction submitter interface and initiate new attestations:
        </p>
        <ol style={{ paddingLeft: 18 }}>
          <li>
            Set <code className="mono-text">VITE_PRIVY_APP_ID</code> and{" "}
            <code className="mono-text">VITE_CONTRACT_ADDRESS</code> in{" "}
            <code className="mono-text">frontend/.env</code>.
          </li>
          <li>Acquire testnet GEN tokens from the GenLayer faucet.</li>
          <li>Connect your wallet, enter a target URL, and submit.</li>
        </ol>
      </div>
    </div>
  );
}

function PersonalAttestationsFeed({
  onSelect,
  selectedId,
}: {
  onSelect: (a: Attestation) => void;
  selectedId: string | null;
}) {
  const { authenticated, address, login } = useWalletAuth();
  const [personalRows, setPersonalRows] = useState<Attestation[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  useEffect(() => {
    if (!address) return;
    setLoadingRows(true);
    fetchByRequester(address)
      .then(setPersonalRows)
      .catch((e) => console.error("Error loading personal audits:", e))
      .finally(() => setLoadingRows(false));
  }, [address]);

  if (!authenticated || !address) {
    return (
      <div className="panel-card">
        <div className="empty-state">
          <ShieldCheck size={36} className="empty-ico" />
          <h3>Connect Wallet</h3>
          <p className="muted" style={{ marginBottom: 16 }}>
            Sign in to view your requested attestations registry.
          </p>
          <button className="submit-btn primary-btn" onClick={login} style={{ maxWidth: 200, margin: "0 auto" }}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div>
          <h2>My Audits Registry</h2>
          <span className="muted-subtitle mono-text" style={{ fontSize: 11 }}>
            {address}
          </span>
        </div>
        {loadingRows && <span className="btn-spinner" style={{ borderColor: "#a855f7" }} />}
      </div>
      <AttestationRowTable
        rows={personalRows}
        onSelect={onSelect}
        selectedId={selectedId}
      />
    </div>
  );
}
