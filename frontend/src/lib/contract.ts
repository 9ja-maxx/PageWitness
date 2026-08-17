import { TransactionStatus, ExecutionResult } from "genlayer-js/types";
import type { GenLayerClient, TransactionHash } from "genlayer-js/types";
import { getReadClient } from "./genlayer";
import { CONTRACT_ADDRESS } from "../config";
import { describeError } from "./format";

export interface Attestation {
  id: string;
  requester: string;
  url: string;
  question: string;
  claim_present: boolean;
  exact_text: string;
  confidence: "high" | "medium" | "low" | string;
  caveats: string;
  screenshot_hash: string;
  screenshot_b64: string;
  created_at: string;
  status: string;
  stored_screenshot: boolean;
}

function getContractAddr(): `0x${string}` {
  if (!CONTRACT_ADDRESS) throw new Error("VITE_CONTRACT_ADDRESS is not set in environment.");
  return CONTRACT_ADDRESS;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resilient rate-limit retry logic using exponential backoff. */
async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      const isRateLimit =
        msg.includes("rate limit") ||
        msg.includes("exceeds defined limit") ||
        msg.includes("429");
      if (!isRateLimit || i === attempts - 1) throw e;
      await sleep(1000 * (i + 1) + Math.random() * 500);
    }
  }
  throw lastError;
}

async function callReadContract<T>(functionName: string, args: unknown[]): Promise<T> {
  return retryWithBackoff(() =>
    getReadClient().readContract({
      address: getContractAddr(),
      functionName,
      args: args as never,
    }) as Promise<T>,
  );
}

// --- Contract Read Operations ---

export async function fetchFee(): Promise<bigint> {
  return BigInt(await callReadContract<string>("get_fee", []));
}

export async function fetchCount(): Promise<number> {
  return Number(await callReadContract<string>("get_attestation_count", []));
}

export async function fetchRecent(limit = 25): Promise<Attestation[]> {
  const result = await callReadContract<{ total: string; attestations: Attestation[] }>("get_recent", [limit]);
  return result.attestations ?? [];
}

export async function fetchByRequester(requester: string): Promise<Attestation[]> {
  const result = await callReadContract<{ requester: string; attestations: Attestation[] }>(
    "get_attestations_by",
    [requester],
  );
  return result.attestations ?? [];
}

export async function fetchAttestation(id: string | number): Promise<Attestation> {
  return callReadContract<Attestation>("get_attestation", [Number(id)]);
}

export async function verifyScreenshotData(id: string | number, screenshotB64: string): Promise<boolean> {
  return callReadContract<boolean>("verify_screenshot_data", [Number(id), screenshotB64]);
}

// --- Contract Write Operations ---

export interface WriteRequestResult {
  txHash: string;
  success: boolean;
}

export async function executeAttestationRequest(
  client: GenLayerClient<any>,
  url: string,
  question: string,
  storeScreenshot: boolean,
  fee: bigint,
  onStatusUpdate?: (status: "initiating" | "consensus" | "finalized") => void,
): Promise<WriteRequestResult> {
  onStatusUpdate?.("initiating");
  
  const txHash = (await client.writeContract({
    address: getContractAddr(),
    functionName: "request_attestation",
    args: [url, question, storeScreenshot],
    value: fee,
  })) as unknown as TransactionHash;

  onStatusUpdate?.("consensus");
  
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    retries: 250,
    interval: 3500,
  });

  onStatusUpdate?.("finalized");
  
  const receiptTyped = receipt as {
    txExecutionResultName?: string;
    failureReason?: unknown;
  };
  
  const success =
    receiptTyped.txExecutionResultName === ExecutionResult.FINISHED_WITH_RETURN;

  if (!success) {
    throw new Error(
      describeError(receiptTyped.failureReason) ||
        "Attestation failed: Validators could not establish semantic consensus on page contents.",
    );
  }
  return { txHash: String(txHash), success };
}
