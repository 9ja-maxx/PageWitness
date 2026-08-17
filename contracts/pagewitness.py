# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""
PageWitness — Consensus-Backed Web Content Attestation Engine

This contract allows users to verify what a specific web page shows at a given moment.
A user submits a URL, a yes/no question, and an option to save the screenshot. The contract
coordinates a network of independent GenLayer validators to render the page, extract visual
evidence using a vision LLM, and reach consensus on the outcome.

Architectural Improvements over legacy designs:
1. Resilient Consensus Model: Rather than comparing LLM descriptions character-for-character
   (which fails under validator greyboxing) or screenshots byte-for-byte (which fails due to
   antialiasing, clocks, ads, or layout rendering shifts), PageWitness uses GenLayer's
   Equivalence Principle (EP) to semantically match the extracted evidence.
2. Optimized On-Chain Storage: Full screenshot base64 images can be excluded from persistent
   state storage by setting `store_screenshot=False`. The screenshot remains auditable
   since the sha256 hash is always stored on-chain, and the base64 content is passed in
   transaction receipt data, saving massive on-chain gas costs.
"""

from genlayer import *

import json
import hashlib
import base64
import typing
from dataclasses import dataclass

# Error classification prefixes to manage consensus outcomes gracefully.
# This prevents external network anomalies from triggering validator slashing.
ERROR_EXPECTED = "[EXPECTED]"    # Standard client-input/business logic revert
ERROR_EXTERNAL = "[EXTERNAL]"    # Target website issues (e.g. 404, 403, Cloudflare)
ERROR_TRANSIENT = "[TRANSIENT]"  # Network glitches or temporary server downtime
ERROR_LLM = "[LLM_ERROR]"        # Vision LLM failure or schema mismatch


@allow_storage
@dataclass
class Attestation:
    requester: Address
    url: str
    question: str
    claim_present: bool
    exact_text: str          # Semantic text snippet extracted from the page
    confidence: str          # "high" | "medium" | "low"
    caveats: str             # Qualifications, dynamic content warnings, or assumptions
    screenshot_hash: str     # SHA-256 of the screenshot bytes for audit integrity
    screenshot_b64: str      # Base64 screenshot (only stored if store_screenshot is True)
    created_at: str          # Deterministic ISO timestamp of the transaction
    status: str              # Status flag ("finalized")
    stored_screenshot: bool  # Flag indicating if the screenshot was saved in storage


class PageWitness(gl.Contract):
    owner: Address
    fee_per_request: u256
    request_counter: u256
    attestations: TreeMap[u256, Attestation]
    by_requester: TreeMap[Address, DynArray[u256]]

    def __init__(self, fee_per_request: u256):
        self.owner = gl.message.sender_address
        self.fee_per_request = fee_per_request
        self.request_counter = u256(0)

    def _now(self) -> str:
        # Returns the deterministic block timestamp provided by the GenVM host.
        return gl.message_raw["datetime"]

    @gl.public.write.payable
    def request_attestation(self, url: str, question: str, store_screenshot: bool = False) -> u256:
        """
        Request a webpage attestation. Requires payment of `fee_per_request` in GEN.
        Triggers a non-deterministic execution block to render the page, analyze it,
        and run comparative validator consensus.
        """
        # Validate inputs and fee payments.
        if gl.message.value < self.fee_per_request:
            raise gl.vm.UserError(
                f"{ERROR_EXPECTED} Insufficient fee: requires {self.fee_per_request} wei"
            )
        if not url.startswith("http://") and not url.startswith("https://"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} URL protocol must be HTTP or HTTPS")
        if len(question.strip()) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Question cannot be empty")

        # Construct the instructions for the vision-capable LLM.
        prompt = self._build_prompt(url, question)

        # Leader path: Render page, take screenshot, analyze with LLM.
        def leader_fn() -> dict:
            return _evaluate_page(url, prompt)

        # Validator path: Independently verify the leader's verdict semantically.
        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                # If the leader crashed/errored, verify if the error is deterministic.
                return _handle_leader_error(leaders_res, lambda: _evaluate_page(url, prompt))

            leader_data = leaders_res.calldata
            my_data = _evaluate_page(url, prompt)

            # 1. Strict boolean check: Validators must agree on the core yes/no verdict.
            if bool(my_data["claim_present"]) != bool(leader_data["claim_present"]):
                return False

            # 2. Bind agreed verdict/evidence to exact screenshot bytes by verifying leader's screenshot hash.
            try:
                leader_screenshot_b64 = leader_data.get("screenshot_b64", "")
                leader_screenshot_bytes = base64.b64decode(leader_screenshot_b64)
                computed_hash = hashlib.sha256(leader_screenshot_bytes).hexdigest()
                if computed_hash != leader_data.get("screenshot_hash"):
                    return False
            except Exception:
                return False

            # Ensure validator's own screenshot hash is also present as a safety check
            if not my_data.get("screenshot_hash"):
                return False

            # 3. Semantic comparison: Use the Equivalence Principle to compare the textual findings.
            # This allows validators running different models (under greyboxing) to formulate
            # their rationale differently while agreeing on the substance.
            leader_summary = json.dumps({
                "exact_text": leader_data.get("exact_text", ""),
                "confidence": leader_data.get("confidence", "low"),
                "caveats": leader_data.get("caveats", "")
            })
            my_summary = json.dumps({
                "exact_text": my_data.get("exact_text", ""),
                "confidence": my_data.get("confidence", "low"),
                "caveats": my_data.get("caveats", "")
            })

            compare_prompt = (
                f"You are a verification consensus agent. Compare these two webpage claim extractions.\n"
                f"Leader summary: {leader_summary}\n"
                f"Validator summary: {my_summary}\n\n"
                f"Decide if they extract equivalent facts, supporting text, and confidence assessments. "
                f"Minor phrasing, casing, or punctuation differences are allowed, but they must not contradict each other.\n"
                f"Respond strictly in JSON:\n"
                f"{{\"equivalent\": true | false}}"
            )
            raw_compare = gl.nondet.exec_prompt(compare_prompt, response_format="json")
            compare_data = _clean_response(raw_compare)
            return bool(compare_data.get("equivalent", False))

        # Execute consensus.
        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        # Persist the attestation record on-chain.
        attestation_id = self.request_counter
        self.request_counter = u256(int(self.request_counter) + 1)

        # Optimization: Only store the screenshot in state if the requester paid and requested it.
        # Otherwise, the screenshot b64 remains in transaction data but is not written to state storage.
        saved_b64 = str(result.get("screenshot_b64", "")) if store_screenshot else ""

        record = Attestation(
            requester=gl.message.sender_address,
            url=url,
            question=question,
            claim_present=bool(result["claim_present"]),
            exact_text=str(result.get("exact_text", "")),
            confidence=str(result.get("confidence", "low")),
            caveats=str(result.get("caveats", "")),
            screenshot_hash=str(result.get("screenshot_hash", "")),
            screenshot_b64=saved_b64,
            created_at=self._now(),
            status="finalized",
            stored_screenshot=store_screenshot,
        )

        self.attestations[attestation_id] = record
        self.by_requester.get_or_insert_default(
            gl.message.sender_address
        ).append(attestation_id)

        return attestation_id

    @gl.public.write
    def update_fee(self, new_fee: u256) -> None:
        """Owner-only utility to adjust the attestation fee."""
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unauthorized: Only owner can update the fee")
        self.fee_per_request = new_fee

    @gl.public.write
    def withdraw(self, recipient: str) -> None:
        """Owner-only utility to withdraw contract balances."""
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unauthorized: Only owner can withdraw")
        balance = self.balance
        if balance == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} No balance available for withdrawal")
        gl.chain.Account(Address(recipient)).emit_transfer(value=u256(int(balance)))

    # --- View Methods ---

    @gl.public.view
    def get_fee(self) -> str:
        return str(self.fee_per_request)

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.view
    def get_attestation_count(self) -> str:
        return str(self.request_counter)

    @gl.public.view
    def get_attestation(self, attestation_id: u256) -> dict:
        if attestation_id not in self.attestations:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Record not found for ID: {attestation_id}")
        return self._serialize(attestation_id, self.attestations[attestation_id])

    @gl.public.view
    def verify_screenshot_data(self, attestation_id: u256, screenshot_b64: str) -> bool:
        """
        Recoverable proof path: Verify offline screenshot bytes against the stored on-chain hash.
        This enables verifying audit validity even when store_screenshot was disabled.
        """
        if attestation_id not in self.attestations:
            return False
        a = self.attestations[attestation_id]
        try:
            screenshot_bytes = base64.b64decode(screenshot_b64)
            computed_hash = hashlib.sha256(screenshot_bytes).hexdigest()
            return computed_hash == a.screenshot_hash
        except Exception:
            return False

    @gl.public.view
    def get_attestations_by(self, requester: str) -> dict:
        addr = Address(requester)
        records: list = []
        if addr in self.by_requester:
            for aid in self.by_requester[addr]:
                records.append(self._serialize(aid, self.attestations[aid]))
        return {"requester": addr.as_hex, "attestations": records}

    @gl.public.view
    def get_recent(self, limit: u256) -> dict:
        """Fetch the most recent attestations, capped by the limit."""
        total = int(self.request_counter)
        n = min(int(limit), total)
        records: list = []
        i = total - 1
        while i >= 0 and len(records) < n:
            records.append(self._serialize(u256(i), self.attestations[u256(i)]))
            i -= 1
        return {"total": str(total), "attestations": records}

    def _serialize(self, attestation_id: u256, a: Attestation) -> dict:
        return {
            "id": str(attestation_id),
            "requester": a.requester.as_hex,
            "url": a.url,
            "question": a.question,
            "claim_present": a.claim_present,
            "exact_text": a.exact_text,
            "confidence": a.confidence,
            "caveats": a.caveats,
            "screenshot_hash": a.screenshot_hash,
            "screenshot_b64": a.screenshot_b64,
            "created_at": a.created_at,
            "status": a.status,
            "stored_screenshot": a.stored_screenshot,
        }

    def _build_prompt(self, url: str, question: str) -> str:
        return f"""You are an objective, neutral web-content attestation agent.
Analyze the provided screenshot of the rendered webpage at {url}.
Your task is to determine whether the page VISIBLY SHOWS or STATES the claim described in the question.

QUESTION: {question}

Do not evaluate if the claim is factually true in the real world. Focus only on what is printed on the screen.
Respond STRICTLY in JSON format with the following fields:
{{
  "claim_present": true | false,
  "exact_text": "the exact text visible on the page that confirms or denies the claim",
  "confidence": "high" | "medium" | "low",
  "caveats": "any notes on dynamic elements, animations, or wording ambiguities"
}}"""


# --- Out-of-Storage Module Helpers ---

def _evaluate_page(url: str, prompt: str) -> dict:
    """Render page in browser, capture screenshot, run LLM interpretation, normalize."""
    # Render with generous wait time to let animations and hydration complete.
    screenshot = gl.nondet.web.render(url, mode="screenshot", wait_after_loaded="2000ms")

    # Run the prompt with the screenshot image attached.
    raw_res = gl.nondet.exec_prompt(prompt, response_format="json", image=screenshot)
    data = _clean_response(raw_res)

    # Compute SHA-256 for audit tracking.
    shot_bytes = bytes(screenshot.raw)
    shot_hash = hashlib.sha256(shot_bytes).hexdigest()
    shot_b64 = base64.b64encode(shot_bytes).decode("ascii")

    confidence = str(data.get("confidence", "low")).strip().lower()
    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    return {
        "claim_present": _parse_bool_strictly(data.get("claim_present")),
        "exact_text": str(data.get("exact_text", ""))[:2000],
        "confidence": confidence,
        "caveats": str(data.get("caveats", ""))[:1000],
        "screenshot_hash": shot_hash,
        "screenshot_b64": shot_b64,
    }


def _clean_response(raw: typing.Any) -> dict:
    """Coerces LLM output into a dictionary defensively."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            start = raw.find("{")
            end = raw.rfind("}")
            if start != -1 and end != -1:
                return json.loads(raw[start:end+1])
        except Exception:
            pass
    raise gl.vm.UserError(f"{ERROR_LLM} Invalid LLM format: expected JSON")


# Valid boolean literals for strict verification.
_TRUE_WORDS = {"true", "yes", "1", "t", "y"}
_FALSE_WORDS = {"false", "no", "0", "f", "n"}


def _parse_bool_strictly(val: typing.Any) -> bool:
    """Parses boolean decisions strictly to prevent python's type coercion rules
    from flipping false/empty values to True."""
    if isinstance(val, bool):
        return val
    if val is None:
        raise gl.vm.UserError(f"{ERROR_LLM} Missing boolean field 'claim_present'")
    if isinstance(val, int):
        if val == 1:
            return True
        if val == 0:
            return False
        raise gl.vm.UserError(f"{ERROR_LLM} Invalid integer for boolean: {val}")
    if isinstance(val, str):
        cleaned = val.strip().lower()
        if cleaned in _TRUE_WORDS:
            return True
        if cleaned in _FALSE_WORDS:
            return False
    raise gl.vm.UserError(f"{ERROR_LLM} Ambiguous boolean representation: {val}")


def _handle_leader_error(leaders_res: gl.vm.Result, re_eval: typing.Callable[[], dict]) -> bool:
    """Compare failure exceptions between leader and validator to verify determinism."""
    leader_msg = getattr(leaders_res, "message", "") or ""
    try:
        re_eval()
        # Validator succeeded but leader failed -> disagree
        return False
    except gl.vm.UserError as e:
        my_msg = e.message if hasattr(e, "message") else str(e)
        if my_msg.startswith(ERROR_EXPECTED) or my_msg.startswith(ERROR_EXTERNAL):
            return my_msg == leader_msg
        if my_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
            # Both failed on a transient network/RPC error -> agreement
            return True
        return False
    except Exception:
        return False
