import { describe, expect, mock, test } from "bun:test";
import {
  describeConfirmation,
  describeVersionMismatch,
  findReleaseRunId,
  interpretReleaseAnswer,
  validateVersion,
  watchReleaseRun,
} from "./release-cut.mjs";

function commandNotFoundError() {
  // Matches what execFileSync actually throws when the binary isn't on PATH.
  const error = new Error("spawnSync gh ENOENT");
  error.code = "ENOENT";
  return error;
}

describe("describeConfirmation", () => {
  test("says package.json needs a bump when the current and target versions differ", () => {
    expect(describeConfirmation("1.8.0", "1.9.0")).toBe(
      "Bumping package.json 1.8.0 -> 1.9.0. Tagging v1.9.0 and pushing — this publishes a real release. Continue?",
    );
  });

  test("says the bump is skipped when package.json is already at the target version — the exact case that used to read '1.9.0 -> 1.9.0' and looked like a no-op bug", () => {
    expect(describeConfirmation("1.9.0", "1.9.0")).toBe(
      "package.json is already at 1.9.0 (from an earlier attempt) — skipping the bump. Tagging v1.9.0 and pushing — this publishes a real release. Continue?",
    );
  });
});

describe("describeVersionMismatch — the guardrail against picking a version that doesn't match reality", () => {
  test("warns when the requested version doesn't match what the commits actually suggest", () => {
    expect(describeVersionMismatch("5.0.0", { severity: "minor", version: "1.10.0" })).toBe(
      "You asked for 5.0.0, but the changes since the last release suggest a minor bump to 1.10.0 instead. Release 5.0.0 anyway?",
    );
  });

  test("says nothing (null) when the requested version matches the suggestion exactly", () => {
    expect(describeVersionMismatch("1.10.0", { severity: "minor", version: "1.10.0" })).toBeNull();
  });

  test("says nothing when there is no suggestion to compare against (e.g. no prior tags, or no commits since the last one)", () => {
    expect(describeVersionMismatch("1.0.0", null)).toBeNull();
  });
});

describe("interpretReleaseAnswer — collapsing 'accept the suggestion' into a single prompt instead of two", () => {
  test("pressing Enter (empty answer) accepts the suggestion and counts as already confirmed", () => {
    expect(interpretReleaseAnswer("", "1.10.0")).toEqual({ version: "1.10.0", confirmed: true });
  });

  test("typing y or yes accepts the suggestion and counts as already confirmed", () => {
    expect(interpretReleaseAnswer("y", "1.10.0")).toEqual({ version: "1.10.0", confirmed: true });
    expect(interpretReleaseAnswer("Yes", "1.10.0")).toEqual({ version: "1.10.0", confirmed: true });
  });

  test("typing n or no declines outright — version is null, nothing left to confirm", () => {
    expect(interpretReleaseAnswer("n", "1.10.0")).toEqual({ version: null, confirmed: false });
    expect(interpretReleaseAnswer("No", "1.10.0")).toEqual({ version: null, confirmed: false });
  });

  test("typing a different version overrides the suggestion and is NOT pre-confirmed — it still needs its own explicit gate", () => {
    expect(interpretReleaseAnswer("5.0.0", "1.10.0")).toEqual({ version: "5.0.0", confirmed: false });
  });

  test("trims surrounding whitespace before interpreting", () => {
    expect(interpretReleaseAnswer("  1.10.0  ", "1.10.0")).toEqual({ version: "1.10.0", confirmed: true });
  });
});

describe("validateVersion", () => {
  test("accepts a version strictly greater than the latest released tag", () => {
    expect(validateVersion("1.9.0", ["v1.7.0", "v1.8.0"])).toEqual({ ok: true });
  });

  test("accepts a version equal to package.json's current field when that exact version was never actually tagged", () => {
    // Exactly what happened today: a first release-cut attempt bumped
    // package.json to 1.9.0 and then failed before tagging/pushing. Re-running
    // with the same version must succeed — the source of truth for "already
    // released" is git tags, not whatever package.json happens to say.
    expect(validateVersion("1.9.0", ["v1.7.0", "v1.8.0"])).toEqual({ ok: true });
  });

  test("rejects a non-semver string", () => {
    expect(validateVersion("latest", [])).toEqual({
      ok: false,
      reason: '"latest" is not a valid version — expected X.Y.Z (e.g. 1.9.0)',
    });
  });

  test("rejects a version equal to the latest released tag (the tag-exists check fires first, since they're necessarily the same thing)", () => {
    expect(validateVersion("1.8.0", ["v1.7.0", "v1.8.0"])).toEqual({
      ok: false,
      reason: "Tag v1.8.0 already exists — this version was already released",
    });
  });

  test("rejects a version older than the latest released tag, even when that exact version was never itself tagged", () => {
    expect(validateVersion("1.8.0", ["v1.7.0", "v2.0.0"])).toEqual({
      ok: false,
      reason: "1.8.0 is not newer than the latest released version 2.0.0",
    });
  });

  test("rejects a version whose tag already exists, even if it's numerically newer (duplicate release attempt)", () => {
    expect(validateVersion("1.9.0", ["v1.8.0", "v1.9.0"])).toEqual({
      ok: false,
      reason: "Tag v1.9.0 already exists — this version was already released",
    });
  });

  test("accepts a major or patch bump the same way as a minor bump", () => {
    expect(validateVersion("2.0.0", ["v1.8.0"])).toEqual({ ok: true });
    expect(validateVersion("1.8.1", ["v1.8.0"])).toEqual({ ok: true });
  });

  test("accepts any valid version when there are no tags at all yet", () => {
    expect(validateVersion("0.1.0", [])).toEqual({ ok: true });
  });

  test("ignores tags that don't look like vX.Y.Z when finding the latest released version", () => {
    expect(validateVersion("1.9.0", ["v1.8.0", "not-a-version", "v1.8.0-beta.1"])).toEqual({ ok: true });
  });
});

describe("findReleaseRunId — what happens when a user doesn't have gh installed", () => {
  test("returns null immediately (no 20s of retrying) when gh isn't on PATH", async () => {
    const runCapture = mock(() => {
      throw commandNotFoundError();
    });

    const result = await findReleaseRunId(runCapture, "v1.9.0");

    expect(result).toBeNull();
    expect(runCapture).toHaveBeenCalledTimes(1); // fails fast — ENOENT isn't a "not registered yet" race to poll through
  });

  test("finds the run id from gh's real JSON shape when gh works", async () => {
    const runCapture = mock(() => JSON.stringify([{ databaseId: 35659541863 }]));

    const result = await findReleaseRunId(runCapture, "v1.9.0");

    expect(result).toBe(35659541863);
  });
});

describe("watchReleaseRun — the user-facing fallback when gh isn't installed", () => {
  test("falls back to the static message and never calls run() (gh run watch) when gh isn't on PATH — the tag is already pushed either way, so this must not throw", async () => {
    const runCapture = mock(() => {
      throw commandNotFoundError();
    });
    const run = mock(() => {
      throw new Error("run() should never be called when no run id was found");
    });

    await watchReleaseRun(run, runCapture, "v1.9.0");

    expect(run).not.toHaveBeenCalled();
  });

  test("reports the release as published only after gh run watch actually succeeds", async () => {
    const runCapture = mock(() => JSON.stringify([{ databaseId: 35659541863 }]));
    const run = mock(() => {}); // gh run watch --exit-status exits 0 -> execFileSync doesn't throw

    await watchReleaseRun(run, runCapture, "v1.9.0");

    expect(run).toHaveBeenCalledWith("gh", ["run", "watch", "35659541863", "--exit-status", "-R", "jotredev/forge614-engines"]);
  });

  test("reports failure, and sets a non-zero exit code, when the run actually failed — never silently 'published'", async () => {
    const previousExitCode = process.exitCode;
    const runCapture = mock(() => JSON.stringify([{ databaseId: 35659541863 }]));
    const run = mock(() => {
      throw new Error("gh run watch exited non-zero: run failed"); // --exit-status makes execFileSync throw on failure
    });

    await watchReleaseRun(run, runCapture, "v1.9.0");

    expect(process.exitCode).toBe(1);
    process.exitCode = previousExitCode;
  });
});
