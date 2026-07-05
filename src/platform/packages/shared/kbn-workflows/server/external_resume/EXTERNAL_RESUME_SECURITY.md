# External Resume Security Model

This document describes the security architecture for Human-in-the-Loop (HITL) external resume links: the URLs sent via Slack, email, and other channels that allow an external actor to approve a workflow pause or submit structured input without a Kibana session.

The model applies to both HITL step types:

- `waitForApproval` — one-click approve/reject links (GET)
- `waitForInput` — query-param resume (GET) and HTML form submission (GET form page + POST)

---

## Context / Problem Statement

External resume requires a way to validate that an incoming request is authorized to resume a specific workflow step. The established credential primitive in the Elastic stack is the Elasticsearch API key. However, for GET-based resume links the API key would appear directly in the URL query string, which is unacceptable: URLs are logged by reverse proxies and CDNs, retained in browser history, leaked via referrer headers, and indexed by messaging platforms. Even a zero-privilege key is still an ES credential that can be used to call `security.authenticate()`, polluting audit trails.

---

## New Architecture Overview

This model keeps the ES API key as an internal lifecycle primitive (TTL, revocation, audit — see [Layer 1](#layer-1-es-api-key-lifecycle-and-gating)) but never exposes its encoded secret externally. Authentication of the external caller is handled by a separate cryptographic nonce that has no ES semantics.

The new model replaces the encoded ES API key in the URL with two non-secret values:

| Query param | Description |
|-------------|-------------|
| `kid` | The ES API key ID (a UUID). Not a secret — visible in Kibana's API Keys UI and ES security audit logs. |
| `token` | A cryptographically random nonce: 32 bytes (256 bits of entropy), hex-encoded (64 characters). Not an ES credential. |

Neither value is an ES credential. The raw nonce is never stored anywhere on the server after mint time; only its SHA-256 hash is persisted (in immutable API key metadata).

### URL format

Default space:

```
GET /api/workflows/executions/{executionId}/resume/external?kid={apiKeyId}&token={nonce}&approved=true
```

Non-default Kibana space (space prefix inserted before the API path):

```
GET /s/{spaceId}/api/workflows/executions/{executionId}/resume/external?kid={apiKeyId}&token={nonce}&approved=true
```

The external input form page uses the same `kid` and `token` pair:

```
GET /api/workflows/executions/{executionId}/resume/external/form?kid={apiKeyId}&token={nonce}
```

Form submissions POST to the resume endpoint with `kid` and `token` in the query string (body carries the structured input fields).

Authentication is performed entirely at the application layer. Kibana route security disables session `authc`/`authz` (`access: 'public'`); the resume service validates `kid` + `token` before loading workflow data or resuming execution.

---

## Security Layers

External resume authorization is enforced through three independent layers plus a concurrency guard.

```
                    External actor clicks link
                              |
                              v
+------------------------------------------------------------------+
| Layer 1: ES API Key (Lifecycle & Gating)                         |
|   getApiKey({ id: kid }) -> exists, active, not expired           |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
| Layer 2: Nonce / Token (Caller Authentication)                   |
|   SHA-256(token) == metadata.resume_token_hash (timing-safe)     |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
| Layer 3: _hitlApiKeyId on Step Input (Authorization / Binding)   |
|   step.input._hitlApiKeyId === kid for waiting HITL step         |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
| Concurrency: markStepAsResponded (first-writer-wins claim)       |
+------------------------------------------------------------------+
                              |
                              v
                     Resume + invalidate API key
```

### Layer 1: ES API Key (Lifecycle and Gating)

An ES API key is still minted when a HITL step enters `WAITING_FOR_INPUT`, but its **encoded secret is never placed in the URL**. The key serves as a lifecycle manager and cheap pre-filter, not as the caller's authentication credential.

**Key properties at mint time:**

- Zero privileges — empty `cluster`, `indices`, `applications`, and `run_as` in the role descriptor (`workflow_external_resume`).
- TTL matching the step timeout:
  - `waitForApproval`: 24 hours (`DEFAULT_WAIT_FOR_APPROVAL_TIMEOUT`)
  - `waitForInput`: 72 hours (`DEFAULT_WAIT_FOR_INPUT_TIMEOUT`)
- Immutable metadata including `resume_token_hash: SHA-256(nonce)` plus workflow binding fields (see [Mint time flow](#mint-time-step-enters-waiting_for_input)).

**Why we still need the API key ID:**

1. **TTL management** — Elasticsearch automatically expires the key after the step timeout. No custom cleanup job is required.
2. **Revocation interface** — `invalidateApiKey` provides single-use enforcement after a successful resume and teardown on workflow cancel, with a single ES call.
3. **Cheap pre-filter** — `getApiKey({ id: kid })` rejects garbage, expired, or already-invalidated requests before any workflow document is loaded.
4. **Audit trail** — ES security audit logs record key creation and invalidation events.
5. **Immutable metadata store** — `resume_token_hash` stored in metadata cannot be tampered with after creation.

The key ID itself is **not secret**. Its security value is as a lifecycle manager and gating mechanism, not as an authentication credential passed to external actors.

### Layer 2: Nonce / Token (Caller Authentication)

A 32-byte cryptographically random nonce is generated at mint time:

```typescript
crypto.randomBytes(32).toString('hex')  // 64-char hex string, 256 bits of entropy
```

**Why we need the nonce:**

1. **Proves caller identity** — only the intended recipient (who received the URL via Slack, email, etc.) possesses the raw nonce.
2. **256 bits of entropy** — computationally infeasible to brute-force. Even at 10 billion SHA-256 hashes per second, exhausting the keyspace would take on the order of 10^59 years.
3. **Never stored in raw form** — only `SHA-256(nonce)` exists server-side (in API key metadata). Even with full platform access, the raw nonce cannot be recovered from the hash (preimage resistance).
4. **Not an ES credential** — the nonce has no ES semantics and cannot be used to authenticate against any Elasticsearch API.

**Why `SHA-256(nonce)` is stored in API key metadata (not in the workflow index):**

1. **Single-call auth gate** — `getApiKey({ id: kid })` returns existence, expiry status, invalidation status, and the hash in one round-trip. The auth decision is made before touching workflow data.
2. **Higher privilege boundary** — reading API key metadata requires `manage_api_key` or `manage_security` privileges. Reading the workflow index only requires index-level read access. The hash is stored behind a higher privilege wall.
3. **Separation of concerns** — authentication data lives in the ES security subsystem where it belongs, not mixed with business data.
4. **Immutability** — API key metadata cannot be altered after creation. An attacker who compromises write access to the workflow index cannot tamper with the auth hash.
5. **Lifecycle coupling** — the hash is naturally destroyed when the API key is invalidated or expires. No orphaned auth data remains in the workflow index.

At validation time, the server computes `SHA-256(token)` and compares it to `metadata.resume_token_hash` using `crypto.timingSafeEqual()` to prevent timing side channels.

### Layer 3: `_hitlApiKeyId` on Step Input (Authorization / Step Binding)

The API key ID is stored on the step's persisted input as `_hitlApiKeyId` (constant: `HITL_API_KEY_ID_INPUT_FIELD` in `@kbn/workflows/common/hitl`).

**Why we store `_hitlApiKeyId` on the workflow step execution:**

1. **Step binding** — proves the authenticated caller (who passed Layer 1 and Layer 2) is authorized to act on **this specific step**, not any other step in the execution.
2. **Cross-step replay prevention** — a nonce minted for step A cannot be used to resume step B, because step B's `_hitlApiKeyId` references a different API key.
3. **Scoped lookup** — combined with `executionId` from the URL path and `spaceId` from the route, ensures the resume targets exactly one step in one execution in one space.

---

## High-Level Flow

### Mint time (step enters `WAITING_FOR_INPUT`)

Executed by the workflows execution engine when a HITL step with external channels enters the waiting state (see `hitl_external_resume_helpers.ts` in the execution engine plugin).

```
1. Generate nonce = crypto.randomBytes(32).toString('hex')
2. Compute tokenHash = SHA-256(nonce)
3. Create ES API key with:
     - Zero privileges (workflow_external_resume role descriptor)
     - TTL = step timeout (24h or 72h, converted to milliseconds for ES)
     - metadata.application = 'kibana-workflows'
     - metadata.resume_token_hash = tokenHash
     - metadata.workflow_execution_id = executionId
     - metadata.workflow_step_id = stepId
     - metadata.workflow_space_id = spaceId
     - metadata.workflow_id = workflowId
4. Store _hitlApiKeyId = apiKey.id on step input
5. Build URL with kid={apiKey.id} and token={nonce}
     - Approval links: .../resume/external?kid=...&token=...&approved=true|false
     - Input form link: .../resume/external/form?kid=...&token=...
6. Send URLs via configured channels (Slack, email, etc.)
7. Discard the raw nonce from server memory (only exists in the outbound URL now)
```

The encoded API key secret returned by `security.createApiKey` is discarded after mint; it is not written to the workflow index, step input, or URL.

### Validation time (external actor clicks the link)

Handled by `external_resume_service.ts` in the workflows management plugin (GET resume, GET form, POST form submission).

```
1. Extract kid and token from URL query params
2. getApiKey({ id: kid })
     -> Key must exist, be active, not invalidated, not expired         [Layer 1]
     -> Retrieve metadata.resume_token_hash
3. Compute SHA-256(token) and constant-time compare against metadata.resume_token_hash
     -> Authenticates the caller (proves possession of nonce)           [Layer 2]
4. Load execution document by executionId + spaceId
5. Find the waiting HITL step where _hitlApiKeyId === kid
     -> Authorizes the caller for this specific step                    [Layer 3]
6. First-writer-wins atomic claim (markStepAsResponded / claimHitlStepForExternalResume)
     -> Prevents double-submit races                                    [Concurrency]
7. Resume workflow execution with provided input
8. Invalidate the API key (invalidateApiKey / invalidateAsInternalUser)
     -> Enforces single-use                                             [Replay prevention]
```

On cancel or step teardown, any remaining API key referenced by `_hitlApiKeyId` is invalidated proactively (`invalidateHitlExternalResumeApiKeyIfPresent`).

---

## Error Responses

All error responses render an HTML error page (not JSON) with strict CSP headers. The raw `token` value must never appear in logs or error messages.

| Condition | HTTP | Message |
|-----------|------|---------|
| Missing `kid` or `token` | 401 | API key and token must be provided |
| Key does not exist / expired / invalidated | 401 | Link expired or already used |
| Token hash mismatch | 401 | Invalid resume token |
| Execution not found | 404 | Workflow execution not found |
| No matching step (`kid` mismatch with `_hitlApiKeyId`) | 403 | Token does not match this workflow execution |
| Step already finished/errored | 409 | This workflow response link is no longer valid |
| Claim conflict (concurrent submit) | 409 | This workflow response link is no longer valid |

Additional validation errors (e.g., missing `approved` for `waitForApproval`, invalid form fields) return 400 with step-specific messages.

---

## Threat Model

| Threat | Mitigation |
|--------|------------|
| URL leaked in server logs / referrer headers | Neither `kid` nor `token` is an ES credential. `token` is a random nonce with no ES semantics. Short TTL plus single-use invalidation limits the exposure window. |
| Attacker has `kid` only (from Kibana UI / audit logs) | Cannot pass Layer 2 — missing the nonce (256 bits of entropy). |
| Attacker has full read access to workflow index | Only sees `_hitlApiKeyId` (a UUID, not secret). No nonce or hash stored in workflow documents. |
| Attacker has API key metadata access (`manage_api_key`) | Sees `SHA-256(nonce)` — cannot reverse (preimage resistance). Offline brute-force against a 256-bit keyspace is computationally infeasible. |
| Attacker has both index read and metadata access | Has one UUID plus one hash. Still cannot recover the 256-bit nonce. |
| Attacker has valid URL but step already resumed | Key is invalidated after first use. Layer 1 rejects immediately on subsequent attempts. |
| Attacker crafts URL for wrong step / execution | Layer 3 fails — `_hitlApiKeyId` on the waiting step will not match the supplied `kid`. |
| Attacker replays URL concurrently | First-writer-wins claim via `markStepAsResponded`. Second request receives 409. |
| Slack / email message retention | Nonce in URL is not an ES credential. Exposure is bounded by TTL and single-use invalidation. Organizational retention policies still apply to message content. |

---

---

## Implementation Notes

### Cryptography

```typescript
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// Mint
const nonce = randomBytes(32).toString('hex');
const tokenHash = createHash('sha256').update(nonce).digest('hex');

// Validate
const computed = createHash('sha256').update(token).digest();
const stored = Buffer.from(metadata.resume_token_hash, 'hex');
if (computed.length !== stored.length || !timingSafeEqual(computed, stored)) {
  throw unauthorized('Invalid resume token');
}
```

- Use Node.js built-in CSPRNG (`crypto.randomBytes`).
- Compare hashes with `crypto.timingSafeEqual()` — never use `===` on digest strings.
- Discard the raw nonce from server memory immediately after the URL is built and the hash is stored in metadata.

### API key creation

Core mint logic lives in `@kbn/workflows/server/external_resume/create_external_resume_api_key.ts`. The execution engine wraps this in `mintHitlExternalResumeApiKey` and persists `_hitlApiKeyId` on step input.

Metadata field for the token hash:

```typescript
metadata: {
  application: 'kibana-workflows',
  resume_token_hash: tokenHash,
  workflow_execution_id: executionId,
  workflow_id: workflowId,
  workflow_space_id: spaceId,
  workflow_step_id: stepId,
}
```

### URL building

URL helpers in `@kbn/workflows/server/external_resume/`:

- `build_external_resume_url.ts` — approval and query-param input links
- `build_external_resume_form_url.ts` — HTML form page links

Both accept `kid` and `token` parameters.

### Resume service validation

Validation and resume orchestration:

- `workflows_management/server/api/external_resume/external_resume_service.ts` — resolves context, claims step, resumes, invalidates key
- `getExternalResumeStepExecution()` — Layer 3 lookup matching `_hitlApiKeyId === kid`
- `claimHitlStepForExternalResume()` — delegates to `markStepAsResponded()` for first-writer-wins

Layer 1 and Layer 2 validation uses `getApiKey` plus hash comparison rather than `security.authenticate()`.

### Route configuration

Defined in `workflows_management/server/api/routes/executions/external_resume_route_helpers.ts`:

- Routes remain `access: 'public'` with Kibana `authc`/`authz` disabled (auth is application-level).
- `xsrfRequired: false` on the POST route (no session cookie).
- CSP on HTML responses: `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'`.

### Logging and monitoring

- Log successful and failed resume attempts for security monitoring.
- **Never log the `token` query parameter.** Safe to log `kid`, `executionId`, `spaceId`, and HTTP status.
- Consider structured fields: `event.action=workflow_external_resume`, `event.outcome=success|failure`, `error.message` (without token).

### Invalidation paths

| Trigger | Mechanism |
|---------|-----------|
| Successful external resume | `invalidateApiKey` immediately after resume |
| Workflow cancel / step teardown | `invalidateHitlExternalResumeApiKeyIfPresent` reads `_hitlApiKeyId` from step input |
| Step timeout | ES TTL expires the API key automatically |

---

## Why the Encoded API Key Is Not Needed at Resume Time

The workflow execution resumes with the permissions of the user who originally invoked (started) the workflow — not with the permissions of the external actor who clicked the resume link. The external resume endpoint triggers the engine to continue execution using the pre-existing runner API key that was established at workflow start time.

This means the minted external resume API key is purely a lifecycle/identity primitive. Its encoded secret is never used to perform any Elasticsearch operation on behalf of the external actor. The only operations performed are:

1. `getApiKey({ id })` — read-only metadata lookup (done as internal user).
2. Hash comparison — application-level, no ES auth involved.
3. Resume scheduling — uses the workflow's own runner credentials.

Because the encoded key has no runtime role, it is safe to discard it immediately after creation. Only the key ID (for lifecycle management) and the token hash (for caller authentication) are retained.

### Future: If the encoded API key is ever needed

If a future requirement demands that the external actor's API key be used to scope operations during resume (e.g., to enforce per-actor audit attribution at the ES level), the encoded key secret must not be stored in plaintext in any index. In that case, it should be persisted via an Encrypted Saved Object (ESO), which provides at-rest encryption through the `encryptedSavedObjects` plugin. The Encrypted SO would hold the encoded key, keyed by the API key ID, and would be decrypted only at resume time within the execution context.
