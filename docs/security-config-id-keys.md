# Security hardening: config `id`s used as object-map keys

This note documents a **low-severity, defense-in-depth** hardening item in the
data loader: config-supplied group/track `id`s are written verbatim as keys into
a plain-object map without a character allowlist. It was surfaced during the
security review of the *"de-hardcode the variation filter baseline"* change (the
`transformedVariants` → `__unfiltered` refactor that resolved
[`architecture-audit.md` B3 / #156](./architecture-audit.md)). The finding is
**pre-existing** — it is not introduced by that change — and is filed here rather
than as an exploitable vulnerability report (see [Disclosure](#disclosure)).

## Summary

`loadProtvistaData` accumulates fetched/adapted per-track and per-group data into
a plain object:

```ts
const data: Record<string, unknown> = {}; // src/load-data.ts
```

Keys are derived from config `id`s. Per-track keys are **composite**
(`${groupId}-${trackId}`, plus the `${…}__unfiltered` baseline), so they can
never equal a magic property name. The **group aggregate**, however, is written
under a **bare** `groupId`:

```ts
// src/load-data.ts — group-aggregate assignment
data[groupId] =
  group.component === 'nightingale-linegraph-track' ||
  group.component === 'nightingale-colored-sequence'
    ? groupData[0]
    : groupData.flat();
```

The schema places no character constraint on ids —
`src/schema/schema.json` declares both group and track `id` as
`{ "type": "string", "minLength": 1 }` with no `pattern`, and
`src/schema/normalize.ts` validates only for **duplicate** ids, not for
dangerous id *values*. So a group whose `id` is `__proto__` produces
`data['__proto__'] = <array>`.

## Mechanics — what actually happens

This is **not** classic global `Object.prototype` pollution. Assigning
`o['__proto__'] = someArray` on a plain object invokes the inherited `__proto__`
setter and reparents `o`'s `[[Prototype]]`; it does not create an own property
and does not mutate the shared `Object.prototype`. There is no recursive,
attacker-keyed deep merge anywhere in the pipeline (`obj[userKey1][userKey2] = v`),
which is what a real prototype-pollution vector requires.

Consequences of a `__proto__` group id are therefore limited and contained:

1. The affected group's aggregate value lands in the prototype slot instead of a
   readable own key, so that one group renders incorrectly (an availability /
   integrity bug for a hostile config, not a cross-object compromise).
2. The reparenting is on the loader's transient local `data`. The component then
   does `this.data = { ...this.data, ...data }`, which copies own-enumerable
   properties only, so the reparenting is discarded at that boundary and never
   reaches `this.data`.

### Related hazard: key-namespace collisions

Because keys are string-concatenated without a reserved separator, unconstrained
ids also permit silent collisions that corrupt rendering (not a security risk,
but the same root cause):

- A group `id` containing `-` (e.g. `X-y`) collides with group `X`'s track `y`
  at `data['X-y']`.
- A track literally named `foo__unfiltered` collides its primary key with track
  `foo`'s `__unfiltered` filter baseline.

## Impact and preconditions

Exploitation requires the `viewerConfig` / `config-src` to be **attacker-controlled**.
In the intended deployment the config is authored by the integrating application,
so this is a hardening item, not an active vulnerability. It matters only for an
integrator that assembles a `<protvista-uniprot>` config from untrusted input.

**Severity: Low (defense-in-depth).** No global prototype pollution; no data
exfiltration; no code execution.

## Recommended remediation

Any (or all) of the following close the class:

1. **Null-prototype loader map** — immune to the `__proto__` setter:
   ```ts
   const data: Record<string, unknown> = Object.create(null);
   ```
   Cheapest fix. Confirm downstream `Object.entries(this.data)` / object spreads
   still behave (they do — those operate on own properties).
2. **Schema id allowlist** — add a `pattern` to the group/track `id` schema in
   `src/schema/schema.json`, e.g. `"pattern": "^[A-Za-z0-9_-]+$"`, rejecting
   `__proto__`-style ids and separator characters at load time. Back it with a
   normalize-time check if configs can bypass JSON-schema validation.
3. **Reserve the separator / suffix** — validate that no id contains the `-`
   composite separator or ends in `__unfiltered`, eliminating the collision
   class; or key a structured `Map` with tuple keys instead of concatenated
   strings.

There is no existing key-sanitization helper today — `src/utils/security.ts`
covers only HTML output (`escapeHtml`, `sanitizeUrl`). Options 1–2 above need no
new helper; if a shared guard emerges, `src/utils/security.ts` is its natural
home.

## Disclosure

The repository's [`SECURITY.md`](../SECURITY.md) asks that **exploitable
vulnerabilities** be reported privately via GitHub Private Vulnerability
Reporting rather than public issues/PRs. This item is documented publicly here
because it is a **low-severity hardening / defense-in-depth** concern that is not
exploitable under the intended trust model (it requires an already-untrusted
config and yields only local map-integrity effects). If a future change makes
config input untrusted by design — or introduces a deep, attacker-keyed merge —
re-evaluate this against the private-reporting policy before publishing further
detail.

## Provenance

- Surfaced during the security review of the `transformedVariants` →
  `__unfiltered` filter-baseline refactor (resolves
  [`architecture-audit.md` B3 / #156](./architecture-audit.md); the A11 entry
  describes the original `transformedVariants` assumption).
- **Pre-existing** — the bare-id group-aggregate write and the unconstrained
  schema ids predate that refactor and are unaffected by it.
