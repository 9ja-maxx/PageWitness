// UI formatting utilities for PageWitness

export function formatGEN(wei: bigint | string | number): string {
  const w = BigInt(wei);
  const val = Number(w) / 1e18;
  return val.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function shortAddr(addr: string | undefined | null, size = 4): string {
  if (!addr) return "";
  if (addr.length <= size * 2 + 2) return addr;
  return `${addr.slice(0, size + 2)}...${addr.slice(-size)}`;
}

export function timeAgo(dateStr: string): string {
  try {
    const past = new Date(dateStr.endsWith("Z") ? dateStr : `${dateStr}Z`);
    if (isNaN(past.getTime())) return dateStr;
    const diffMs = Date.now() - past.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  } catch {
    return dateStr;
  }
}

export function hostOf(url: string): string {
  try {
    const p = new URL(url);
    return p.hostname.replace("www.", "");
  } catch {
    return url;
  }
}

export function describeError(err: unknown): string {
  if (!err) return "Unknown error occurred.";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  
  // Decipher GenLayer-specific RPC return messages
  const maybeReceipt = err as {
    message?: string;
    details?: string;
    failureReason?: {
      message?: string;
    };
  };
  if (maybeReceipt.failureReason?.message) {
    return maybeReceipt.failureReason.message;
  }
  if (maybeReceipt.message) {
    return maybeReceipt.message;
  }
  if (maybeReceipt.details) {
    return maybeReceipt.details;
  }
  return JSON.stringify(err);
}
