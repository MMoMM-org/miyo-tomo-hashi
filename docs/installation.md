# Installation

## From Obsidian Community Plugins

1. Open **Settings → Community Plugins → Browse**
2. Search for **MiYo Tomo Hashi**
3. Click **Install**, then **Enable**

## Using BRAT (recommended while pending review)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) lets you install plugins directly from GitHub before they appear in the community directory.

1. Install the BRAT plugin
2. In BRAT settings, **Add Beta Plugin** → paste `MMoMM-org/miyo-tomo-hashi`
3. Enable **MiYo Tomo Hashi** in **Settings → Community Plugins**

## Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MMoMM-org/miyo-tomo-hashi/releases/latest)
2. Create `<your-vault>/.obsidian/plugins/miyo-tomo-hashi/` (if it doesn't exist)
3. Place the three files inside that folder
4. Reload Obsidian and enable **MiYo Tomo Hashi** in **Settings → Community Plugins**

## Requirements

- **Obsidian** ≥ 1.7.2
- **Desktop only** — `isDesktopOnly: true` in the manifest. Hashi uses Node APIs (Docker socket, filesystem) that are unavailable on Obsidian Mobile.
- **Docker** (only for the [Session View](session-view.md) — talking to Tomo containers). The instruction executor works without Docker.

## Verify the installation

After enabling the plugin, confirm it loaded — **no Docker or Tomo container is
needed for this check**:

1. Open **Settings → MiYo Tomo Hashi**. The settings tab should show three
   sections: **Tomo chat**, **Tomo context**, and **Instruction executor**.
2. Look at the status bar (bottom of the Obsidian window). You should see the
   **友** icon (Tomo session) and the **橋** icon (instruction executor, idle state).
3. Open the command palette (`Ctrl/Cmd+P`) and type **MiYo Tomo Hashi** — commands
   such as *Show chat window* and *Execute instructions document* should appear.

If all three are present, the plugin is installed and running. Connecting to a Tomo
container (chat) additionally requires Docker and a running container — see
[Session View](session-view.md) — but that is a separate step from verifying the
install itself.

## Next steps

- [Configure the plugin](configuration.md) — settings reference
- [How It Works](how-it-works.md) — architecture and the three-component model
- [Session View](session-view.md) — connect to a Tomo container
- [Instruction executor](instruction-executor.md) — run vault updates from `_instructions.json`
