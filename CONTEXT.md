# Echoform History

Echoform brings Git-like history and experimentation to Ableton projects without requiring musicians to understand Git or storage internals.

## Language

**Project**:
An Ableton project Echoform protects as one creative workspace.
_Avoid_: Repository

**Ableton Set**:
A `.als` document inside a Project. Multiple Ableton Sets are files, not branches.
_Avoid_: Version, branch

**Checkpoint**:
An immutable captured state of a Project that can be inspected, compared, pinned, or used as a new starting point.
_Avoid_: Save, commit, version

**Branch**:
An independent sequence of Checkpoints that begins from an existing Checkpoint and continues in its own Working Copy.
_Avoid_: Ableton Set, copied file

**Working Copy**:
The materialized Project folder Ableton can open and edit. History remains independently protected by Echoform.
_Avoid_: Checkpoint, branch file

**Continue from Here**:
Start a new Branch from a selected Checkpoint in a separate, protected Working Copy without changing the current Project.
_Avoid_: Restore in place, duplicate set

**Recovery**:
Reconstruct and verify every file represented by a Checkpoint before making it available as a Working Copy.
_Avoid_: Rollback
