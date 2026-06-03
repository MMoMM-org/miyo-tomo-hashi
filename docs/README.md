# Documentation

> TODO: Add a one-paragraph overview of MiYo Tomo Hashi and who it is for.

## Overview

**MiYo Tomo Hashi** (友橋, "friend-bridge") is a desktop Obsidian plugin that
connects your vault to [Tomo](https://github.com/MMoMM-org/miyo-tomo) — the Claude
Code agent — running in a Docker container. It bundles **three independent
components** in one plugin (they share nothing at runtime):

- **[Session View](session-view.md)** — an interactive terminal tab attached to a
  running Tomo container, so you talk to Claude Code without leaving Obsidian
  (outbound, over the Docker socket).
- **[Tomo context](context.md)** — an opt-in, loopback-only WebSocket server (off by
  default) that streams your active file, cursor, and selection to Claude Code inside
  the container.
- **[Instruction executor](instruction-executor.md)** — reads the `_instructions.json`
  files Tomo writes into your vault and applies them as deterministic, previewable,
  idempotent vault operations through Obsidian's API.

Hashi is **local-first** and **proposal-first**: its only inbound surface is the
loopback Tomo-context bridge (disabled by default), and the approval for what it
executes lives upstream in Tomo's instruction-set review step. It's for Obsidian
users already running Tomo who want session interaction, live editor context, and
automated vault updates in one place.

## Documentation map

- [Installation](installation.md)
- [Configuration](configuration.md)
- [How it works](how-it-works.md)
- [Session view](session-view.md)
- [Chat](chat.md)
- [Action reference](action-reference.md)
- [Instruction executor](instruction-executor.md)
- [Hooks](hooks.md)
- [Commands reference](commands-reference.md)
- [Troubleshooting](troubleshooting.md)

## Quick links

- **Install it** → [Installation](installation.md)
- **Configure it** → [Configuration](configuration.md)
- **Connect to a Tomo container** → [Session View](session-view.md)
- **Share editor context with Claude Code** → [Tomo context](context.md)
- **Run an instruction set** → [Instruction executor](instruction-executor.md)
- **Something's broken** → [Troubleshooting](troubleshooting.md)
