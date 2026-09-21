import { describe, expect, test } from "bun:test";
import { computeOverallStatus, computeRemovalStatus } from "./status";

const OK = { kind: "noop" } as const;
const WRITE = { kind: "write" } as const;
const UNSUPPORTED = { kind: "unsupported", reason: "x" } as const;

const RUNTIME_OBSERVED = { kind: "runtime-observed", timestamp: "2026-01-01T00:00:00.000Z" } as const;
const NEEDS_TRUST = { kind: "needs-user-trust" } as const;
const PENDING = { kind: "pending-runtime-verification", reason: "no-evidence" } as const;
const HOOK_ABSENT = { kind: "absent" } as const;
const HOOK_UNSUPPORTED = { kind: "unsupported" } as const;

describe("computeOverallStatus with three components", () => {
  test("is complete only when mcp, instructions are ok AND the hook has runtime-observed evidence", () => {
    expect(computeOverallStatus(OK, OK, RUNTIME_OBSERVED)).toBe("complete");
    expect(computeOverallStatus(OK, WRITE, RUNTIME_OBSERVED)).toBe("complete");
  });

  test("is partial — never complete — when the hook is only structurally installed but not yet runtime-observed", () => {
    // This is the exact bug this test guards against: a config that WOULD be
    // correct once applied must never count as "complete" before any real
    // session has run it and left evidence.
    expect(computeOverallStatus(OK, OK, PENDING)).toBe("partial");
    expect(computeOverallStatus(OK, OK, HOOK_ABSENT)).toBe("partial");
  });

  test("is partial, never complete, when the hook needs user trust", () => {
    expect(computeOverallStatus(OK, OK, NEEDS_TRUST)).toBe("partial");
  });

  test("is unsupported only when all three are unsupported", () => {
    expect(computeOverallStatus(UNSUPPORTED, UNSUPPORTED, HOOK_UNSUPPORTED)).toBe("unsupported");
  });
});

describe("computeRemovalStatus with three components", () => {
  // Removal uses the plain structural HookComponentStatus, not HookRuntimeStatus
  // — "did we successfully remove the config" has no runtime-proof question to answer.
  test("treats unsupported as an ok outcome for removal, same as before", () => {
    expect(computeRemovalStatus(OK, OK, UNSUPPORTED)).toBe("complete");
  });

  test("is complete when the hook config was successfully written away", () => {
    expect(computeRemovalStatus(OK, OK, WRITE)).toBe("complete");
  });
});
