"""
Direct-Mode Unit Tests for PageWitness Intelligent Contract
"""

import json
import base64
import hashlib

CONTRACT = "contracts/pagewitness.py"
FEE = 1_000_000_000_000_000  # 0.001 GEN in wei

VERDICT_JSON = json.dumps({
    "claim_present": True,
    "exact_text": "Capped supply is 21,000,000.",
    "confidence": "high",
    "caveats": "none"
})


def _mock_eval(direct_vm, llm_json=VERDICT_JSON, compare_result="true"):
    """Register mocks for the web rendering, vision LLM, and semantic comparison."""
    direct_vm.clear_mocks()
    # Mock browser render: returns a dummy HTML body
    direct_vm.mock_web(r".*", {"status": 200, "body": "<html>proof</html>"})
    # Mock vision LLM prompt
    direct_vm.mock_llm(r".*attestation agent.*", llm_json)
    # Mock comparative equivalence prompt
    direct_vm.mock_llm(r".*equivalent facts.*", compare_result)


def _hex(addr) -> str:
    """Normalize address format to 0x-hex."""
    if isinstance(addr, (bytes, bytearray)):
        return "0x" + bytes(addr).hex()
    if hasattr(addr, "as_hex"):
        return addr.as_hex
    return str(addr)


# --- Basic Contract Tests ---

def test_initial_state(direct_vm, direct_deploy, direct_owner):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    assert c.get_fee() == str(FEE)
    assert c.get_attestation_count() == "0"
    assert c.get_owner().lower() == _hex(direct_owner).lower()


def test_update_fee_owner_only(direct_vm, direct_deploy, direct_bob):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Unauthorized"):
        c.update_fee(5)


def test_update_fee_by_owner(direct_vm, direct_deploy):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    c.update_fee(42)
    assert c.get_fee() == "42"


def test_withdraw_owner_only(direct_vm, direct_deploy, direct_bob):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Unauthorized"):
        c.withdraw(_hex(direct_bob))


# --- Fee and Input Validation ---

def test_insufficient_fee_reverts(direct_vm, direct_deploy):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.value = FEE - 1
    with direct_vm.expect_revert("Insufficient fee"):
        c.request_attestation("https://example.com", "Shows supply?")


def test_bad_url_reverts(direct_vm, direct_deploy):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.value = FEE
    with direct_vm.expect_revert("URL protocol"):
        c.request_attestation("ftp://example.com", "q?")


def test_empty_question_reverts(direct_vm, direct_deploy):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.value = FEE
    with direct_vm.expect_revert("Question cannot be empty"):
        c.request_attestation("https://example.com", "   ")


# --- Attestation Storage and Screenshot Options ---

def test_request_attestation_with_screenshot(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = FEE

    # Request attestation WITH screenshot storage option enabled
    aid = c.request_attestation("https://example.com/audit", "Shows supply?", True)
    assert str(aid) == "0"
    assert c.get_attestation_count() == "1"

    rec = c.get_attestation(0)
    assert rec["claim_present"] is True
    assert rec["confidence"] == "high"
    assert rec["url"] == "https://example.com/audit"
    assert rec["status"] == "finalized"
    assert rec["stored_screenshot"] is True
    
    # Verify screenshot is present in state storage and matches the hash
    assert len(rec["screenshot_hash"]) == 64
    assert len(rec["screenshot_b64"]) > 0
    assert (
        hashlib.sha256(base64.b64decode(rec["screenshot_b64"])).hexdigest()
        == rec["screenshot_hash"]
    )


def test_request_attestation_without_screenshot(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = FEE

    # Request attestation WITHOUT screenshot storage option (store_screenshot=False)
    aid = c.request_attestation("https://example.com/audit", "Shows supply?", False)
    assert str(aid) == "0"

    rec = c.get_attestation(0)
    assert rec["claim_present"] is True
    assert rec["stored_screenshot"] is False
    # Hash is still stored for audit validation
    assert len(rec["screenshot_hash"]) == 64
    # b64 storage is empty to save state gas
    assert rec["screenshot_b64"] == ""


def test_by_requester_and_recent(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = FEE
    c.request_attestation("https://a.com", "q1?")
    c.request_attestation("https://b.com", "q2?")

    mine = c.get_attestations_by(_hex(direct_alice))
    assert len(mine["attestations"]) == 2

    recent = c.get_recent(1)
    assert recent["total"] == "2"
    assert len(recent["attestations"]) == 1
    assert recent["attestations"][0]["id"] == "1"


# --- Validator Consensus Agreement & Disagreement ---

def test_validator_agrees(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = FEE
    c.request_attestation("https://example.com", "Shows supply?")
    
    # Run validator with identical mocks and positive semantic comparison
    assert direct_vm.run_validator() is True


def test_validator_disagrees_on_flipped_verdict(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    _mock_eval(direct_vm)
    direct_vm.sender = direct_alice
    direct_vm.value = FEE
    c.request_attestation("https://example.com", "Shows supply?")

    # Validator sees a page where claim is NOT present -> disagree
    _mock_eval(
        direct_vm,
        llm_json=json.dumps({
            "claim_present": False,
            "exact_text": "",
            "confidence": "high",
            "caveats": ""
        })
    )
    assert direct_vm.run_validator() is False


# --- Strict Boolean Coercion Checks ---

def test_strict_boolean_parsing(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    # Test strict false spelling "no"
    _mock_eval(
        direct_vm,
        llm_json=json.dumps({
            "claim_present": "no",
            "exact_text": "",
            "confidence": "high",
            "caveats": ""
        })
    )
    direct_vm.sender = direct_alice
    direct_vm.value = FEE
    c.request_attestation("https://example.com", "Shows supply?")
    
    rec = c.get_attestation(0)
    assert rec["claim_present"] is False


def test_invalid_boolean_coercion_reverts(direct_vm, direct_deploy, direct_alice):
    c = direct_deploy(CONTRACT, FEE, sdk_version="v0.2.1")
    # LLM returns a non-standard value "maybe" for a boolean choice -> revert
    _mock_eval(
        direct_vm,
        llm_json=json.dumps({
            "claim_present": "maybe",
            "exact_text": "",
            "confidence": "high",
            "caveats": ""
        })
    )
    direct_vm.sender = direct_alice
    direct_vm.value = FEE
    with direct_vm.expect_revert("Ambiguous boolean"):
        c.request_attestation("https://example.com", "Shows supply?")
