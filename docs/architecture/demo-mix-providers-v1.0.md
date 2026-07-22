> # ✅ CANONICAL — RATIFIED AND FROZEN
>
> **Ratified 22 Jul 2026.** This document is binding. It specifies the Demo Mix provider
> architecture and the playback arbitration it plugs into.
>
> It contains **no SQL, no schema, no components, no hooks, no services, no RLS, no realtime code**
> in its normative sections. §9 is an explicitly **NON-NORMATIVE** appendix naming the modules that
> implement this, so the specification can be found from the code and the code from the
> specification.
>
> **Rule numbers `DM1`–`DM16` are frozen** — a stable citation interface. They may never be
> renumbered. They are namespaced to this document and do not refer to rules in
> `communication-v1.0` (`C`/`D`), `messaging-availability-v1.0` (`MA`/`DA`),
> `conversation-workspace-v1.0` (`W`), `architecture-v1.0` (`§`), `identity-v1.1` (`R`/`B`/`D`/`A`)
> or `publication-v1.0` (`P`).
>
> Status: **RATIFIED v1.0** — 22 Jul 2026 · frozen. Amendment record at **§10**.
>
> **Amendments** are made by minting a new version (`demo-mix-providers-v1.1`), never by editing
> this file.

YesPleez · Architecture Specification

# Demo Mix Provider Architecture v1.0

The canonical design for long-form music playback: what a Demo Mix is, how a provider implements
one, and how playback is arbitrated against communication.

**Status** CANONICAL — ratified and frozen 22 Jul 2026
**Scope** Scene · Festival · future products

---

## Constitutional principles

Three rules are **constitutional**. An implementation that finds one inconvenient has found the
point at which it must stop and surface the conflict, not the point at which it may make an
exception.

**`DM1` · A Demo Mix is a logical media type, not a platform.**
An artist has a featured demo mix. Where it is hosted — SoundCloud, Mixcloud, Spotify, or uploaded
to YesPleez — is an implementation detail. No surface outside a provider may name a platform, and no
behaviour anywhere may depend on which one it is.

**`DM2` · Arbitration knows roles, never providers.**
The Media Session Manager decides what pauses and what resumes. It may never contain
`if (soundcloud)`, hold a widget, or import a provider. It arbitrates between **SHORT** and
**LONG**, and those are the only two facts about a source it is permitted to know.

**`DM3` · Adding a provider is two steps and nothing else.**
Implement the interface; register it. Any change required to the player, the manager, arbitration,
or another provider means the abstraction has leaked, and **the leak is the defect** — not the
provider that revealed it.

---

## §1 — Playback roles

**`DM4`** Every audio source declares one of two roles. The role is a claim about **what the sound
is for**, not about its length or its format.

| role | what it is | on interruption |
|---|---|---|
| **LONG** | a demo mix, a set, long-form music | parked, and resumed afterwards |
| **SHORT** | a Voicey, an audio message — communication | interrupts, and is never resumed |

**`DM5`** A phone is the reference behaviour: a call pauses music, and the music comes back. A
product that stops a forty-minute set for a four-second voice note and leaves the listener in
silence has taken something away.

**`DM6`** SHORT interrupting SHORT does **not** resume the first. Two voice notes in a row is
someone moving on, not an interruption, and resuming would be a player fighting its listener.

**`DM7` Parking is one deep.**
A Voicey over a Voicey over a set still resumes **the set**. The middle link is short-form and was
never resumable, so a stack would model a state that cannot exist.

---

## §2 — Interruption and resumption

**`DM8` Resume belongs to completion, never to pause.**
A source that finishes naturally resumes what it interrupted. A source the listener **deliberately
paused** resumes nothing: silence was the request.

**`DM9` A destroyed source is forgotten, not released.**
Pausing and ceasing-to-exist are different facts. A paused source stays parked so it can still come
back; a source whose provider has been torn down — the player unmounted, the media changed — must be
dropped from the parked slot entirely. Conflating the two either discards music that should return,
or resumes a provider that no longer exists.

---

## §3 — The provider interface

**`DM10`** A provider declares:

| member | meaning |
|---|---|
| `id` | stable identifier, recorded in captured session state |
| `label` | what a human calls it |
| `matches(url)` | can this provider play that address? |
| `surface` | what the player must render for it |
| `embedUrl(url)` | the source address for that surface |
| `attach({ el, url, on })` | everything else, returning playback primitives and a teardown |

**`DM11` `attach` is where ALL provider-specific work happens** — creating widgets, loading
third-party scripts, binding events, fetching metadata, observing position, reporting readiness.
Nothing provider-specific may exist outside it.

**`DM12` A provider must report playback it did not initiate.**
Every platform embed has its own play control. A provider that only reports plays made through its
own `play()` leaves the manager unaware that audio started, and communication will not interrupt it.

**`DM13` `surface` is a value, not a branch.**
The player renders what it is told to render. A future provider needing a new surface adds one value
and one rendering case — never a code path per provider.

---

## §4 — Resumable playback

**`DM14` Position is captured, never assumed.**
Widget APIs do not reliably hold a playhead across a pause, and some reset it. The position is read
**before** pausing and written back on resume. A provider that happens to preserve it is merely
seeked to where it already was.

**`DM15` Resume is state-driven, never timer-driven.**
Restoration waits for the provider to report readiness. A fixed delay is wrong twice: too short on a
slow connection, so playback silently never resumes; and dead air on a fast one. Providers that
answer no position query must **observe** it from their own progress events.

---

## §5 — Layer responsibilities

**`DM16`** Three layers, three responsibilities, no overlap:

| layer | owns | must never |
|---|---|---|
| **Media Session Manager** | arbitration and interruption policy | know a provider exists |
| **MiniPlayer** | orchestration and presentation | ask which provider it holds |
| **Providers** | attachment and playback implementation | know why they were paused |

A provider is never told *why* it was paused, and the manager is never told *how* a provider pauses.
That mutual ignorance is the architecture.

---

## §6 — Direct Upload

Direct Upload is a **first-class provider**, not a fallback. An artist who uses no third-party
platform is not a degraded case and no code may treat them as one.

It is also the simplest provider to implement, which is the clearest evidence the interface sits at
the right altitude: a media element already satisfies it, so the platform integrations are the
complicated ones rather than the baseline.

⚠ **The upload path itself remains inside the frozen Media System milestone.** This document
guarantees that when it is built it plugs into this interface without architectural change. It does
not authorise building it.

---

## §7 — Extension rules

To add a provider:

1. Implement `DM10`, honouring `DM11`, `DM12`, `DM14` and `DM15`.
2. Add it to the registry.

⚠ **Ordering is significant only for overlap.** `matches` is asked in sequence, so a provider with a
broad test must be registered last. Direct Upload is the catch-all and must remain final.

Nothing else changes. If something else must change, stop and surface it (`DM3`).

---

## §8 — Out of scope

Deferred to the post-launch **Media System** milestone: video, transcoding, compressed download
assets, storage quotas, media optimisation, codec support, and the direct-upload storage path.

---

## §9 — Implementation map *(NON-NORMATIVE)*

> A snapshot at ratification. Where it disagrees with the code, the code is right.

| concern | module |
|---|---|
| arbitration, SHORT/LONG, parking | `v2/src/lib/mediaSession.js` |
| resumable-source factory, capture/restore | `v2/src/lib/mediaProviders.js` |
| the registry and every provider | `v2/src/lib/demoMixProviders.js` |
| orchestration and presentation | `v2/src/components/MiniPlayer.jsx` |
| SHORT sources | `VoiceMessage.jsx`, `FileMessage.jsx` |

The rules above are enforced by tests rather than convention:
`mediaSession.test.js` (policy), `mediaResume.test.js` (the two layers composed),
`demoMixProviders.test.js` (registry and interface), and `mediaSessionContract.test.js`, which fails
if provider identity reappears in the player or the manager.

⚠ **Nothing in this architecture has been verified by listening.** Correctness is proven; whether a
resume is audibly seamless on a real SoundCloud embed, and whether Mixcloud's progress events are
frequent enough for its restored position to feel accurate, are open questions answerable only on a
device.

---

## §10 — Amendment record

| version | date | change |
|---|---|---|
| v1.0 | 22 Jul 2026 | Ratified. Consolidates the Media Session Manager, the Demo Mix provider model, and the completion of the provider abstraction — attachment moved into providers, making MiniPlayer fully provider-agnostic. |
