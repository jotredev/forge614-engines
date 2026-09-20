# 04. Safe application and recovery

## The analogy: compare the quote with the real part

An old quote must not be applied after someone changes the part. Before writing, Engines looks at the file again and compares its fingerprint with the one saved when the plan was created. This avoids undoing work by a person or another program.

## Applying a confirmed plan

```text
forge614-engines apply --plan-id 11111111-2222-3333-4444-555555555555
```

The identifier must match a file under `~/.forge614/engines/plans/`. If it is absent, the response uses `PLAN_NOT_FOUND`. When the plan says `noop`, the operation succeeds and `changedFiles` is empty.

For every real write, Engines reads the target file again. It calculates SHA-256 and requires it to equal the plan's `beforeHash`. A difference produces `STALE_PLAN` (an expired plan), without writing anything. The safe solution is to create another plan, show it again, and request confirmation again.

A write can also be a deletion — used to fully remove Claude Code's dedicated instructions content file on `plan memory-remove` — and it is applied through that exact same hash-check and snapshot path as every other write.

## Backup and reliable write

Before changing an existing file, Engines creates a backup under `~/.forge614/engines/snapshots/<planId>/`. The manifest (a structured inventory of backups) stores the original path, backup name, date, and fingerprint.

The write is atomic (the new file appears all at once): it first writes a private temporary file, synchronizes it to disk, then renames it to the final name. It then reads it again and compares the fingerprint. On systems other than Windows it also synchronizes the directory, reducing the risk of an interruption halfway through a change.

## Recovery

The internal restore function uses the manifest to copy every backup to its original path. The current public interface does not expose a `restore` command; Shell must keep the plan context and own any visible recovery flow. Do not manually delete backups while a change is still being investigated.

## What to expect on failure

| Code | Everyday meaning | Safe action |
| --- | --- | --- |
| `STALE_PLAN` | the file changed since the quote | create a new plan |
| `PLAN_NOT_FOUND` | the requested receipt is absent | calculate the plan again |
| `CONFLICT` | the same name has different configuration | review both values in Shell |
| `UNRECOGNIZED_ENTRY` | the entry appears to belong to another person or tool | do not remove it automatically |

Safety depends on preserving the sequence: plan, human review, immediate application.
