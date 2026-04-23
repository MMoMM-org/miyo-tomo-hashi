# MiYo Tomo Hashi

Direct integration with Tomo (Claude Code) sessions for session interaction and automated vault updates

## Installation

### Community Plugins (after listing)
1. Open Obsidian Settings → Community Plugins
2. Search for "MiYo Tomo Hashi"
3. Install and enable

### Manual
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/MMoMM-org/miyo-tomo-hashi/releases/latest)
2. Create folder `<vault>/.obsidian/plugins/miyo-tomo-hashi/`
3. Copy the downloaded files into that folder
4. Restart Obsidian and enable the plugin

### BRAT (Beta)
1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
2. Add beta plugin: `MMoMM-org/miyo-tomo-hashi`

## Usage

<!-- Describe how to use the plugin -->

## Development

```bash
git clone https://github.com/MMoMM-org/miyo-tomo-hashi.git
cd miyo-tomo-hashi
git config core.hooksPath .githooks
npm install
npm run dev       # Watch mode
npm run build     # Production build
npm test          # Run tests
npm run lint      # Lint
```

## License

MIT - see [LICENSE](LICENSE)
