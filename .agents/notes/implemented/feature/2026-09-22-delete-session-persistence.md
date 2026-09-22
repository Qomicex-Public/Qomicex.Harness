# Agent Note: Permanently deleting a stored Session across the persistence seam

Status: implemented

English | [中文](2026-09-22-delete-session-persistence.zh.md)

## Problem

The registry could hide a Session from every grouping surface through `archiveSession`, but nothing could erase one: the JSONL log, its header, and its write lock stayed on disk for the life of the storage root, so the archived list only ever grew. Deleting a Session is a different operation from archiving, and it reaches the durability seam: the event log is the source of truth, so an erase has to remove every physical artifact of the Session or leave a half-deleted log behind.

## Decision

One new verb on the persistence seam, implemented once and threaded through the existing owners of Session identity.

`SessionPersistence` gains `delete(id, options?)` next to `create` — the destroy counterpart of the creation verb, with the same id-addressed, handle-free shape as `stat`/`list`. The shipped provider (`JsonlSessionPersistence`) implements it as removal of the whole session-owned directory: every immutable generation, the write lock file, and any session-local artifact. The cross-process write lock is claimed before the removal and released after it, so a writer in this or another process refuses the erase instead of appending into a removed directory; an in-process write claim refuses first for a precise error. An unknown id rejects `SessionPersistenceNotFoundError`. The cold-log memo entry for the id is dropped with it; an unmaterialized Session has no artifact to erase and can only ever be refused while its creator handle is live.

`WorkspaceRegistry.deleteSession` owns the domain sequence: refuse a live Session (`WorkspaceLiveSessionError` — the owning agent holds the write handle over the log being erased, and the registry has no agent handle to close), reject an unknown id, then erase through persistence first, then drop the Session from its workspace `sessionIds` slot, the registry-global archive set, and the header index. Erase-first ordering means an interrupted delete leaves a ghost Session the next start filters out, never a Session the user believes is gone while its log still occupies storage.

`workspace-controller` exposes the verb as the `workspace.deleteSession` Remote method and maps the two refusals to the stable codes `session/live` and `session/not-found`. The Client model drops the erased id from its local archive set, `ctx.uiWorkspace` gains `deleteSession`, and the archived-sessions Settings page gains a per-row Delete action that opens the shared `RiskConfirmation` primitive — the erase is one checkbox-gated confirmation that names the irreversibility, never a bare button.

## Verification

The shared persistence contract suite (`runPersistenceContract`) carries the seam-wide cases: erase hides a stored Session from `stat`/`list`/`open` and frees its id for a new create, and an absent id or a live write owner refuses without erasing anything. Registry coverage lives in `workspace.spec.ts` (accounting drop, archive-set removal, refusals, persistence-failure propagation); controller coverage in `workspace-controller.host.spec.ts` (stable failure mapping) and `model.client.spec.ts` (archive-set drop on success, retention on failure); UI coverage in `components.client.spec.tsx` (the dialog stays disabled until the acknowledgement is checked, cancel erases nothing, a rejection stays a console diagnostic) and `browser-plugin.client.spec.tsx` (the injected write). `pnpm run build` compiles both faces.

## Alternatives considered

**A soft-delete flag on the domain state.** It keeps the artifact, every read path (`stat`, `list`, the search index, resume) would need the filter, and the storage never returns. The user-facing requirement is erasure, so the honest implementation removes the bytes.

**Erasing inside `archiveSession` or the workspace registration delete.** Archive is a display set whose contract is restore; mixing erasure into it would make an unarchive of an erased id unresolvable, and the workspace-registration delete deliberately retains Sessions. A separate verb keeps each contract single-purpose.

**Closing the live agent automatically.** The registry has no `AgentHandle`, and killing a mid-turn agent from a registry call would abort in-flight work the caller did not ask to abort. The refusal names the precondition instead, and the Host refuses again through its own write claim if a handle appears later.

**Deleting individual generations instead of the session directory.** Generation selection is a reader concern; leaving the lock file or a stray staged migration file behind would resurrect state on the next write. The session directory is the unit the backend already owns per Session.

## Consequences

An erased Session is unrecoverable: there is no restore verb, and the UI states that before the user confirms. The seam now has a destructive verb, so every future provider implements it as part of the contract. A Session that is live in the Host process cannot be erased until its agent closes; an attempt surfaces as `session/live`. Cross-process ownership is enforced by the same kernel lock the write path already uses, so a concurrent writer never appends into a removed directory.
