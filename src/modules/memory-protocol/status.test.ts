import { describe, expect, test } from "bun:test";
import type { MemoryIntegrationComponentStatus } from "../config-writer/types";
import { computeOverallStatus } from "./status";

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
