import { describe, expect, test } from "bun:test";
import type { MemoryIntegrationComponentStatus } from "../config-writer/types";
import { computeOverallStatus, computeRemovalStatus } from "./status";

const noop: MemoryIntegrationComponentStatus = { kind: "noop" };
const write: MemoryIntegrationComponentStatus = { kind: "write" };
const blocked: MemoryIntegrationComponentStatus = { kind: "blocked", reason: "x", details: "x" };
const unsupported: MemoryIntegrationComponentStatus = { kind: "unsupported", reason: "x" };

describe("computeOverallStatus", () => {
  test("is complete when both components are noop or write", () => {
    expect(computeOverallStatus(noop, write)).toBe("complete");
    expect(computeOverallStatus(write, noop)).toBe("complete");
  });

  test("is partial when only one component is ok", () => {
    expect(computeOverallStatus(write, unsupported)).toBe("partial");
    expect(computeOverallStatus(blocked, noop)).toBe("partial");
  });

  test("is unsupported when neither component is ok", () => {
    expect(computeOverallStatus(blocked, unsupported)).toBe("unsupported");
  });
});

describe("computeRemovalStatus", () => {
  test("is complete when a component structurally has nothing to remove (unsupported) and the other is noop or write", () => {
    expect(computeRemovalStatus(noop, unsupported)).toBe("complete");
    expect(computeRemovalStatus(write, unsupported)).toBe("complete");
    expect(computeRemovalStatus(unsupported, noop)).toBe("complete");
  });

  test("is partial when one component is blocked and the other is ok", () => {
    expect(computeRemovalStatus(blocked, noop)).toBe("partial");
    expect(computeRemovalStatus(blocked, unsupported)).toBe("partial");
  });

  test("is unsupported when neither component is ok", () => {
    expect(computeRemovalStatus(blocked, blocked)).toBe("unsupported");
  });
});
