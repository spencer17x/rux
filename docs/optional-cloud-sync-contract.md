# Optional cross-device sync contract

Status: product and security design baseline, 2026-08-17. No cloud sync transport is implemented or enabled by this document.

## Non-negotiable defaults

- Sync is off by default at the product, account, Workspace, and data-class levels.
- Local-first use never requires a Rux cloud account and behaves exactly as it does without this feature.
- Enabling sync requires an explicit Workspace-scoped flow that lists every included and excluded data class, remote destination, encryption model, retention rule, and deletion consequence.
- A device cannot silently enroll another Workspace, broaden the synchronized data set, upload historical content, or turn on telemetry.
- Provider/CLI credentials, OS-encrypted Rux Native secrets, terminal environment variables, raw credential diagnostics, and Keychain material are never syncable.

## Data classes

The first eligible classes are Rux-owned immutable records: Task metadata, user/Assistant messages, completed Run events, permission decisions, Model Decisions, Token Usage, Context snapshots, Run-owned patches, review records, Handoff snapshots, and imported Projection Revisions. Each class can be disabled before the initial upload, with a clear warning when disabling it makes another record incomplete.

Excluded by default and requiring a second explicit switch are file contents, command output, terminal transcripts, imported provider conversation content, and exported artifacts. Active PTY sessions, process state, OS paths outside the canonical Workspace-relative projection, native-session credentials, and hidden model reasoning are never eligible.

A Provider-native Session id may synchronize only as an opaque, non-secret identity inside an encrypted Task record. Possessing that id on another device does not establish Provider authentication or continuation authority. The destination device must independently have the same Engine, non-secret Connection reference, authorized Workspace, Agent Revision, and official Provider authentication before offering continuation.

## Encryption and key custody

- Content is encrypted on the source device before upload with a random per-Workspace data-encryption key. The service stores ciphertext, authenticated metadata, version envelopes, and the minimum routing metadata required to deliver ciphertext.
- Each record uses authenticated encryption with a unique nonce and associated data binding Workspace id, record type, record id, schema version, and ciphertext revision.
- The Workspace key is wrapped separately for each enrolled device. Device wrapping keys are generated locally and stored with OS-backed credential protection. The service never receives an unwrapped Workspace key.
- Recovery is opt-in and separate from ordinary sync. A user may create an encrypted recovery package protected by a recovery secret they control; Rux must explain that losing every device and recovery secret makes content unrecoverable.
- Device enrollment uses an already enrolled device or recovery flow, displays both device identities, and requires explicit approval. Removing a device rotates the Workspace key for future records; a full historical re-key is a separate, potentially long-running confirmed action.
- No plaintext fallback is allowed when OS credential protection or cryptographic primitives are unavailable.

The service can still observe unavoidable metadata such as account, enrolled devices, ciphertext sizes, upload time, and coarse traffic patterns. The consent screen must disclose this rather than calling the system “zero metadata.”

## Identity and versioning

Stable record identity remains the local contract: Workspace id plus Rux record id, or Engine + Connection reference + native Session id for an imported source identity. Sync cannot merge records solely because titles, prompts, file paths, or content hashes look similar.

Every uploaded mutation is an append-only encrypted envelope with device id, local sequence, logical record id, parent revision ids, schema version, and creation time. Mutable views are projections over immutable revisions. A client never overwrites an unknown remote head.

Schema upgrades are client-side and versioned. A newer unsupported envelope stays encrypted and preserved; an older client shows “需要更新 Rux” and cannot replace it. Migration creates a new revision and retains the old ciphertext until the Workspace retention/delete policy allows removal.

## Conflict and multi-writer policy

Independent additions with different record ids merge. Concurrent edits to a nominally mutable Rux preference use field-level last-writer only for explicitly low-risk UI preferences; the interface shows the winning device and time.

Conversation and execution records never use last-writer-wins:

- Concurrent writes to the same Task or linked Native Session create visible branches from the common immutable parent.
- The client marks both branches read-only until the user chooses one to continue or creates a Context Handoff into a new Task.
- Provider-native refresh remains explicit on the authenticated device. A remote Rux projection cannot write to, delete, reorder, or claim authority over the Provider session.
- Run, permission, Git patch, review, Handoff, and imported Projection records are append-only and deduplicated by stable id. Conflicting payloads for the same id are a security/integrity error, not an automatic merge.
- Workspace-relative file evidence may be reviewed on another device, but applying a patch requires an independently authorized matching Workspace, a fresh local Git snapshot, and the existing restore/mutation confirmations.

## Deletion, retention, and account exit

Local deletion and cloud deletion are separate choices. The impact preview distinguishes:

1. remove only this device's local projection;
2. stop sync and keep encrypted cloud data;
3. delete selected Rux records from every enrolled device and the service;
4. delete the entire synchronized Workspace;
5. delete the cloud account.

Cloud deletion creates an authenticated tombstone, synchronizes it to enrolled devices, and removes active service copies within a published deadline. Backups may retain encrypted ciphertext for a separately published maximum period; keys needed to decrypt deleted Workspace content are destroyed at the end of that period. The UI states both deadlines and does not claim instantaneous physical erasure.

Before destructive cloud deletion, Rux shows record counts, affected devices, local-only records, Provider-native sessions that are not affected, retention deadlines, and export options. Account deletion never calls a Provider-native delete API. A user can export decrypted, credential-free Rux data before deletion when an enrolled device still has keys.

Removing imported content from Rux cloud never mutates the Provider source. A later explicit re-import is a new local/cloud revision and does not resurrect a deleted revision invisibly.

## Consent and operational controls

- The first enable flow requires review and confirmation; no single generic “agree” control can also enable analytics, AI training, support access, or broader Workspace scope.
- Uploading local success metrics remains a separate consent, endpoint, retention, and revocation decision from content sync.
- Every device exposes last successful sync, pending upload/download counts, encrypted bytes, current key epoch, device list, conflicts, deletions awaiting propagation, and a pause control.
- Pause stops new network transfer without deleting data. Disable offers the distinct local/cloud retention choices above.
- Support staff cannot decrypt content. Any diagnostic export is produced locally, previewed, redacted, and explicitly shared by the user.
- Server logs exclude plaintext content, keys, Provider ids when not required for routing, command output, file paths, and prompts. Security/audit logs have documented retention and user-visible device/session entries.

## Threats and required verification

The implementation threat model includes service compromise, malicious or lost enrolled device, replay/rollback, record substitution across Workspaces, nonce reuse, future-client downgrade, traffic analysis, compromised local Renderer, concurrent writers, deletion failure, and accidental upload of an excluded class.

Before any preview release, independent tests must prove cryptographic test vectors, device enrollment/removal, key rotation, rollback/replay rejection, schema forward-compatibility, branch conflicts, offline convergence, tombstone propagation, backup expiry, account export/deletion, excluded-data scans, Renderer non-access to keys, and an end-to-end exercise where the service sees only ciphertext and disclosed routing metadata. An external security review is required before public availability.

## Delivery gates

1. Implement the immutable encrypted envelope and local-only multi-device simulator; no network.
2. Add explicit Workspace consent and two-device encrypted transport behind a development flag.
3. Add branch conflict UX, pause, device removal, export, and deletion/tombstone flows.
4. Complete external security/privacy review, recovery testing, retention operations, and incident response.
5. Only then consider a user-facing opt-in preview. Local-first mode remains fully supported and unchanged.
