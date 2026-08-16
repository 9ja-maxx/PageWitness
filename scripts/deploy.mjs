// PageWitness Smart Contract Deployment Script
//
// Deploys the PageWitness Intelligent Contract to Testnet Bradbury using genlayer-js.
// Requires:
//   - ACCOUNT_PRIVATE_KEY in .env (Bradbury address with test GEN)
//   - Optional: FEE_WEI in .env (fee per attestation in wei; default 0)
//
// Usage:
//   npm install
//   npm run deploy

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function exitWithError(message) {
  console.error(`\n✗ Error: ${message}\n`);
  process.exit(1);
}

const privateKey = process.env.ACCOUNT_PRIVATE_KEY;
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  exitWithError("ACCOUNT_PRIVATE_KEY is missing or invalid in .env (must be 0x + 64 hex characters).");
}

const feeWei = BigInt(process.env.FEE_WEI ?? "0");

const account = createAccount(privateKey);
const client = createClient({ chain: testnetBradbury, account });

const contractCodePath = path.join(ROOT, "contracts/pagewitness.py");
const code = new Uint8Array(readFileSync(contractCodePath));

console.log("Initiating PageWitness deployment to GenLayer Testnet Bradbury...");
console.log(`  Deployer Account: ${account.address}`);
console.log(`  Attestation Fee:  ${feeWei} wei`);

try {
  // If the client requires initializing the smart contract consensus layer
  if (typeof client.initializeConsensusSmartContract === "function") {
    await client.initializeConsensusSmartContract();
  }

  console.log("Submitting deployment transaction...");
  const txHash = await client.deployContract({ code, args: [feeWei] });
  console.log(`  Transaction Hash: ${txHash}`);

  console.log("Waiting for block finalization...");
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: "FINALIZED",
    retries: 200,
  });

  const deployedAddress =
    receipt?.txDataDecoded?.contractAddress ??
    receipt?.data?.contract_address ??
    null;

  if (!deployedAddress) {
    exitWithError(
      "Contract deployment finalized but no address was returned. Transaction receipt details:\n" +
        JSON.stringify(receipt, null, 2),
    );
  }

  console.log(`\n✓ Deployment Successful!`);
  console.log(`  Contract Address: ${deployedAddress}`);
  console.log(`  Explorer Link:    https://explorer-bradbury.genlayer.com/address/${deployedAddress}`);
  console.log(`\nAction required: Add this to your frontend/.env config file:`);
  console.log(`  VITE_CONTRACT_ADDRESS=${deployedAddress}\n`);
} catch (error) {
  exitWithError(`Deployment failed with exception: ${error instanceof Error ? error.message : String(error)}`);
}
