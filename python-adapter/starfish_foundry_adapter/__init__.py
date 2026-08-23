"""
starfish_foundry_adapter -- the Starfish governance adapter for Azure AI Foundry Agent Service.

Wraps the "receive function_call -> execute -> submit function_call_output" loop that Foundry's
custom function-calling pattern requires the calling application to implement (Foundry itself never
executes your functions -- see docs/design/azure.md Sec 1). Every proposed call is routed through the
Starfish sidecar's existing wire protocol (packages/sdk/src/serve.ts / client.ts) before it runs.

This mirrors packages/sdk/src/client.ts's makeSidecarRunner() protocol exactly: bearer-token auth,
the x-starfish-wire handshake header, and the same /v1/decide, /v1/decisions, /v1/decisions/{id}
endpoint shapes -- so the sidecar does not need to know or care which language is calling it.

Deployment assumption (see docs/design/azure.md Sec 3): the sidecar's serve.ts binds loopback-only by
design (127.0.0.1) -- this is a deliberate security-by-construction choice, not an oversight. That means
this adapter and the sidecar MUST run in the same pod / same Container Apps revision (a true sidecar
container, colocated network namespace), reachable at 127.0.0.1. Do not attempt to route this adapter to
a sidecar on a different host or pod -- it will be rejected by serve.ts's loopback + Host-header checks
by design, and weakening that check is a security-relevant change that needs its own review, not a
config tweak.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

WIRE_VERSION = 1  # must match packages/sdk/src/serve.ts's WIRE_VERSION exactly

FOUNDRY_RUN_EXPIRY_SECONDS = 600.0  # Foundry's own run-expiry window, confirmed against current Microsoft
# docs (checked 2026-08-03, not assumed): "Runs expire 10 minutes after creation. Submit your tool outputs
# before they expire." -- and, critically: "The 10-minute run expiration applies to total elapsed time,
# not individual function execution." The clock starts at RUN CREATION, not at whichever function_call
# happens to need approval. See GovernedFoundryExecutor.handle()'s run_created_at parameter -- this is the
# real reason it exists, found on review (IMPLEMENTATION_PLAN.md Sec 6s).
RUN_EXPIRY_SAFETY_MARGIN_SECONDS = 30.0  # headroom for actually submitting function_call_output back to
# Foundry after a verdict lands, plus general clock/latency slop between this process and Foundry's own
# run-expiry clock. NOT itself sourced from Microsoft's docs -- a deliberately conservative placeholder;
# tighten (or justify) once this has run against a real Foundry resource and the real submission latency
# is known.


class StarfishUnreachable(Exception):
    """Raised when the sidecar cannot be reached at all. Callers MUST treat this as a deny, never as
    allow -- fail-closed is the one invariant every layer of Starfish holds, and the adapter is not
    exempt just because it's new code in a new language."""


@dataclass
class Decision:
    allow: bool
    ask: bool
    reason: str


@dataclass
class StarfishSidecarClient:
    """Thin HTTP client for one governed root's sidecar endpoint. One instance per (root, actor)."""

    base_url: str  # e.g. "http://127.0.0.1:8787" -- MUST be loopback, see module docstring
    token: str
    timeout_seconds: float = 5.0

    def _call(self, method: str, path: str, body: Optional[dict] = None) -> tuple[int, dict]:
        url = self.base_url.rstrip("/") + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "content-type": "application/json",
                "x-starfish-wire": str(WIRE_VERSION),
                "authorization": f"Bearer {self.token}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return e.code, {}
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            raise StarfishUnreachable(str(e)) from e

    def decide(self, call: dict, boundary: dict) -> Decision:
        """POST /v1/decide -- the synchronous gate. Fail-closed: any transport error is a deny, never
        an allow, matching client.ts's makeSidecarRunner().decide()."""
        try:
            status, body = self._call("POST", "/v1/decide", {"call": call, "boundary": boundary})
        except StarfishUnreachable as e:
            return Decision(allow=False, ask=False, reason=f"fail-closed: sidecar unreachable ({e})")
        if status != 200:
            return Decision(allow=False, ask=False, reason=f"fail-closed: sidecar returned {status}")
        return Decision(allow=bool(body.get("allow")), ask=bool(body.get("ask")), reason=str(body.get("reason", "")))

    def file_decision(self, actor: str, tool: str, target: str, reason: str, risk_tier: str = "high") -> str:
        """POST /v1/decisions -- park an 'ask' for operator approval. Returns the decision id."""
        status, body = self._call(
            "POST",
            "/v1/decisions",
            {"decision": {"actor": actor, "tool": tool, "target": target, "reason": reason, "riskTier": risk_tier}},
        )
        if status != 200:
            raise RuntimeError(f"failed to file decision: HTTP {status} {body}")
        return str(body.get("id", ""))

    def poll_decision(self, decision_id: str) -> str:
        """GET /v1/decisions/{id} -- 'pending' | 'approved' | 'denied' | 'unknown'."""
        status, body = self._call("GET", f"/v1/decisions/{decision_id}")
        if status != 200:
            return "unknown"
        return str(body.get("status", "unknown"))

    def resolve_decision(self, decision_id: str, verdict: str, resolver_token: "StarfishSidecarClient") -> tuple[bool, str]:
        """POST /v1/decisions/{id} using a DIFFERENT identity's token than the one that filed it --
        the sidecar enforces proposer != approver server-side regardless, but the adapter should never
        even construct a call that could look like self-approval.

        `verdict` MUST be exactly "approve" or "deny". Found the hard way tonight, not by inspection
        (IMPLEMENTATION_PLAN.md Sec 6k): serve.ts's wire protocol is `verdict === 'deny' ? 'deny' :
        'approve'` -- ANY string other than the literal "deny" is silently treated as an APPROVAL, with
        no error, no rejection, nothing in the 200 OK response to distinguish it from a real approval.
        A caller who writes "denied" (plain, natural English, and exactly the string this project's own
        early .NET test code used) silently GRANTS the request instead of refusing it -- the precise
        opposite of the fail-closed principle this adapter otherwise holds everywhere else. Validated
        client-side here rather than trusting every caller, including future code in this same
        codebase, to get the exact string right.
        """
        if verdict not in ("approve", "deny"):
            raise ValueError(
                f"resolve_decision: verdict must be exactly 'approve' or 'deny', got {verdict!r} -- "
                "refusing client-side rather than risking a silent unintended grant (the sidecar's "
                "wire protocol treats any non-'deny' string as an approval)"
            )
        status, body = resolver_token._call("POST", f"/v1/decisions/{decision_id}", {"verdict": verdict})
        return bool(body.get("ok")), str(body.get("reason", ""))


@dataclass
class FoundryFunctionCall:
    """Shape returned by Foundry's `responses.create()` for a function-call item (see Learn: function
    calling). Only the fields the adapter needs are modeled here."""

    call_id: str
    name: str
    arguments: dict


@dataclass
class GovernedFoundryExecutor:
    """
    The actual integration surface a Foundry customer's app code uses: swap-in replacement for the raw
    "execute the function yourself" step in the function-calling loop (docs/design/azure.md Sec 3
    diagram). One instance per governed agent/root.

    executors: name -> callable(arguments: dict) -> Any. The REAL function logic; this class does not
    know or care what the functions do, only whether they're allowed to run.
    boundary: the BoundarySet passed to the PDP (visibility/write roots) -- see governance-core's
    boundary.ts for the exact shape; kept as a plain dict here since the adapter doesn't depend on
    governance-core's TS types.
    agent_id: the proposer identity recorded on every call -- must never equal the approver identity
    used to resolve an 'ask' (proposer != approver is enforced server-side, but keep this straight in
    your own code too).
    poll_interval_seconds / max_wait_seconds: how the adapter waits on an 'ask'. Foundry runs expire
    10 minutes after creation (Learn: function calling) -- max_wait_seconds MUST stay comfortably under
    that, and the caller MUST have a plan for "still pending when we gave up" (surface it as a distinct
    outcome, not silently deny or silently allow).

    IMPORTANT, found on review (IMPLEMENTATION_PLAN.md Sec 6s): "comfortably under Foundry's 10-minute
    window" is only actually true if the ask-wait starts near the beginning of the run's lifetime.
    Foundry's 10-minute expiry is total elapsed time SINCE RUN CREATION, not per function call, per
    Microsoft's own docs ("The 10-minute run expiration applies to total elapsed time, not individual
    function execution"). A run that's already 6 minutes into a multi-step conversation by the time a
    mid-run tool call needs approval has only ~4 minutes of REAL budget left, no matter what
    max_wait_seconds says -- a fixed max_wait_seconds has no way to know that on its own. Pass
    `run_created_at` to handle() (below) whenever it's available (Foundry's run object exposes
    `created_at`) so the actual wait gets capped to what's genuinely left of the run's real budget,
    not blindly to max_wait_seconds.
    """

    sidecar: StarfishSidecarClient
    executors: dict[str, Callable[[dict], Any]]
    boundary: dict
    agent_id: str = "foundry-agent"
    poll_interval_seconds: float = 1.0
    max_wait_seconds: float = 480.0  # a ceiling, NOT a guarantee of staying under Foundry's 10-minute
    # window on its own -- see the class docstring's run_created_at note and handle()'s own docstring.

    def handle(self, fc: FoundryFunctionCall, run_created_at: Optional[float] = None) -> dict:
        """Returns a Foundry `function_call_output` item: {type, call_id, output}. Never raises for a
        governance denial -- a denial is a normal, auditable outcome, not an application error.

        run_created_at: epoch seconds (time.time()-compatible) of when the FOUNDRY RUN this call belongs
        to was created -- NOT when this particular function_call arrived. When provided, the actual wait
        on an 'ask' is capped to whatever's genuinely left of Foundry's 10-minute run-expiry budget (minus
        RUN_EXPIRY_SAFETY_MARGIN_SECONDS), never to more than max_wait_seconds either way. When omitted
        (the only behavior before this was added), max_wait_seconds is used as-is -- which is exactly the
        gap this parameter exists to close for any call that isn't near the start of its run: omitting it
        is a real risk, not a neutral default, since the adapter would otherwise wait right up to
        max_wait_seconds even when the run itself has little or no time left, guaranteeing the eventual
        function_call_output submission gets rejected as expired regardless of what verdict lands.
        """
        call = {"agentId": self.agent_id, "tool": fc.name, "input": fc.arguments}
        decision = self.sidecar.decide(call, self.boundary)

        if decision.ask:
            effective_max_wait = self.max_wait_seconds
            if run_created_at is not None:
                elapsed = time.time() - run_created_at
                remaining_budget = FOUNDRY_RUN_EXPIRY_SECONDS - elapsed - RUN_EXPIRY_SAFETY_MARGIN_SECONDS
                effective_max_wait = max(0.0, min(self.max_wait_seconds, remaining_budget))

            path = str(fc.arguments.get("path", fc.name))
            try:
                decision_id = self.sidecar.file_decision(
                    actor=self.agent_id, tool=fc.name, target=path, reason=decision.reason
                )
            except Exception as e:  # noqa: BLE001 -- deliberately broad, see comment below
                # Found on review: file_decision() raises RuntimeError on a non-200 response, and nothing
                # here caught it -- meaning a transient failure filing the decision (the sidecar was
                # reachable enough for decide() to return 'ask', but /v1/decisions itself errored) would
                # propagate as an unhandled exception out of handle(), breaking this class's OWN documented
                # contract ("Never raises for a governance denial -- a denial is a normal, auditable
                # outcome, not an application error"). Fail-closed here too, matching every other sidecar
                # failure mode in this adapter (decide()'s own transport-error handling, above), rather
                # than letting this one path be the exception to fail-closed.
                return self._refusal(fc, f"fail-closed: could not file the ask for operator review ({e})")

            if effective_max_wait <= 0:
                # The run's own budget is already exhausted (or within the safety margin) before this
                # adapter even started waiting -- polling at all would be pointless, since Foundry will
                # reject the eventual function_call_output as expired regardless of what verdict lands.
                # Fails closed immediately with a distinct, honest reason instead of looping zero times
                # and reporting a slightly misleading "still pending after 0.0s". The decision is filed
                # either way (above), so an operator can still see and reason about what was asked.
                return self._refusal(
                    fc,
                    f"no time left to wait for approval: this Foundry run is already past its safe budget "
                    f"under the {FOUNDRY_RUN_EXPIRY_SECONDS:.0f}s run-expiry window (decision {decision_id} "
                    "filed for operator visibility regardless)",
                )

            deadline = time.monotonic() + effective_max_wait
            status = "pending"
            timed_out = True
            while time.monotonic() < deadline:
                status = self.sidecar.poll_decision(decision_id)
                if status != "pending":
                    timed_out = False
                    break
                time.sleep(self.poll_interval_seconds)
            if status == "approved":
                return self._execute(fc)
            if status == "denied":
                return self._refusal(fc, f"operator denied: {decision.reason}")
            if not timed_out:
                # Found tonight: the loop can exit early with a non-"pending", non-"approved",
                # non-"denied" status (poll_decision returns "unknown" on any transport error or
                # non-200 response -- e.g. a transient sidecar blip, or a genuinely malformed
                # response). The OLD code here fell through to the timeout message unconditionally,
                # which would falsely claim "still pending after {max_wait_seconds}s" even when the
                # loop broke on the very first poll because of an actual error, not because time ran
                # out -- misleading for anyone debugging why a call was denied. Now reported as its
                # own distinct outcome instead of being folded into "timed out."
                return self._refusal(fc, f"approval status could not be determined (decision {decision_id}): sidecar returned status={status!r}")
            # Still pending when we stopped waiting -- a distinct outcome, not a silent deny.
            return self._refusal(fc, f"approval still pending after {effective_max_wait}s (decision {decision_id})")

        if not decision.allow:
            return self._refusal(fc, decision.reason)

        return self._execute(fc)

    def _execute(self, fc: FoundryFunctionCall) -> dict:
        fn = self.executors.get(fc.name)
        if fn is None:
            return self._refusal(fc, f"no executor registered for tool '{fc.name}'")
        try:
            result = fn(fc.arguments)
        except Exception as e:  # noqa: BLE001 -- deliberately broad: any execution error becomes a
            # governed, auditable refusal rather than an unhandled exception bubbling into the agent loop.
            return self._refusal(fc, f"execution error: {e}")
        return {"type": "function_call_output", "call_id": fc.call_id, "output": json.dumps(result)}

    def _refusal(self, fc: FoundryFunctionCall, reason: str) -> dict:
        return {
            "type": "function_call_output",
            "call_id": fc.call_id,
            "output": json.dumps({"error": "denied_by_governance", "reason": reason}),
        }
