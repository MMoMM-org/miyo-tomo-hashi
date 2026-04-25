---
from: hashi
to: tomo
date: 2026-04-24
topic: instance-name-label
status: done
status_note: Added --label miyo.tomo.instance-name=$INSTANCE_NAME to docker run in scripts/lib/begin-tomo.sh.template (template v0.11.0). Only start path in Tomo. Users regenerate begin-tomo.sh via install-tomo.sh.
priority: normal
requires_action: true
---

# Add `miyo.tomo.instance-name` Docker label on Tomo container startup

## What Changed

Hashi v0.1 (spec 001, Tomo Connection & Chat Window) discovers Tomo containers by the Docker label `miyo.component=tomo` and presents them in a picker in Obsidian plugin Settings. Each picker row needs a human-readable identifier so the user can pick the correct instance when multiple Tomo containers are running.

Hashi's design requires Tomo to expose the instance name as a Docker label at container startup:

- **Label key**: `miyo.tomo.instance-name`
- **Label value**: a user-meaningful string (e.g., derived from `--name`, the vault name, or a user-set environment variable — whatever Tomo considers canonical)

## Why

Docker's API does not otherwise expose a human-friendly name distinct from the auto-generated container name. The container name (`--name`) is one option, but it's also used for uniqueness enforcement inside Docker and is not semantically the same as "the Tomo instance this user is working with". An explicit label lets Tomo decide what the display name should be independently of Docker's container-name rules.

Hashi also uses this label to dynamically name its command palette entry: when a name is known, the Reconnect command shows as "Tomo Hashi: Reconnect to `<instance-name>`"; otherwise it falls back to a static "Tomo Hashi: Reconnect to Tomo".

## Impact on Tomo

**Required change**: wherever Tomo runs `docker run` (or its equivalent start path — start scripts, docker-compose, systemd unit), add:

```
--label miyo.tomo.instance-name=<name>
```

**Deadline**: before Hashi v0.1 release. Hashi can ship without this (see graceful fallback below) but the UX is notably worse.

**Graceful fallback** (already in Hashi): when the label is absent, Hashi's picker row shows the short container ID (first 12 chars) + uptime with a small warning icon. The palette command degrades to the static "Reconnect to Tomo" label. Nothing breaks; users just see fewer distinguishing cues.

**No other change**: no changes to Tomo's chat protocol, stdio, or file output. Hashi attaches to the container's PID 1 via `docker attach` — that path is unchanged. Tomo's existing `miyo.component=tomo` label is still required (Hashi filters discovery on it).

## Action Required

1. Confirm Tomo has a canonical "instance name" concept; if not, decide what to populate the label with (the filesystem path of the vault being worked on is a strong default).
2. Add `--label miyo.tomo.instance-name=<value>` wherever Tomo starts containers.
3. Set `status: done` on this handoff file (with optional `status_note` noting which start paths were updated).

## References

- Hashi spec 001 PRD: `docs/XDD/specs/001-session-view/requirements.md` — see **Assumptions** ("Tomo containers are responsible for …") and **F1** acceptance criteria.
- Hashi spec 001 SDD: `docs/XDD/specs/001-session-view/solution.md` — ADR-1 (dockerode), "Runtime View / Complex Logic — Discovery result mapping".
- Hashi spec 001 README: `docs/XDD/specs/001-session-view/README.md` — Decisions Log 2026-04-24 entry on the outbound handoff.
