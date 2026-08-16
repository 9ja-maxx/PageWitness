import { randomBytes } from "node:crypto";
import { createAccount } from "genlayer-js";

const pk = "0x" + randomBytes(32).toString("hex");
const account = createAccount(pk);

console.log("Generated Wallet:");
console.log(`Private Key: ${pk}`);
console.log(`Address:     ${account.address}`);
