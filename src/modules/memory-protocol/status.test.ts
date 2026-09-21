import { describe, expect, test } from "bun:test";
import { computeOverallStatus, computeRemovalStatus } from "./status";

const OK = { kind: "noop" } as const;
const WRITE = { kind: "write" } as const;
const UNSUPPORTED = { kind: "unsupported", reason: "x" } as const;
const NEEDS_TRUST = { kind: "needs-user-trust", agentId: "codex", configPath: "/x", details: "x" } as const;

describe("computeOverallStatus with three components", () => {
  test("is complete only when mcp, instructions, AND hook are all ok", () => {
    expect(computeOverallStatus(OK, OK, OK)).toBe("complete");
    expect(computeOverallStatus(OK, OK, WRITE)).toBe("complete");
  });

  test("is partial, never complete, when the hook needs user trust", () => {
    expect(computeOverallStatus(OK, OK, NEEDS_TRUST)).toBe("partial");
  });

  test("is partial when hook alone is missing", () => {
    expect(computeOverallStatus(OK, OK, UNSUPPORTED)).toBe("partial");
  });

  test("is unsupported only when all three are unsupported", () => {
    expect(computeOverallStatus(UNSUPPORTED, UNSUPPORTED, UNSUPPORTED)).toBe("unsupported");
  });
});

describe("computeRemovalStatus with three components", () => {
  test("treats unsupported as an ok outcome for removal, same as before", () => {
    expect(computeRemovalStatus(OK, OK, UNSUPPORTED)).toBe("complete");
  });
});
