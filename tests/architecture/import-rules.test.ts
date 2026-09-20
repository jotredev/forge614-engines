import { describe, expect, test } from "bun:test";
import { findLayerViolations } from "./import-rules";

describe("architecture layering", () => {
  test("modules/infrastructure/app never import from a higher layer", () => {
    expect(findLayerViolations()).toEqual([]);
  });
});
