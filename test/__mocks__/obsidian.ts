/**
 * Lightweight Obsidian API mock for unit testing.
 * Provides minimal stubs of the classes and functions used in the plugin skeleton.
 * Extend as needed when adding new Obsidian API usage.
 */

import { vi } from "vitest";

// --- App & Workspace ---

export class Component {
	registerDomEvent = vi.fn();
	registerInterval = vi.fn();
	registerEvent = vi.fn();
}

export class App {
	vault = {
		getAbstractFileByPath: vi.fn(),
		read: vi.fn(),
		modify: vi.fn(),
		create: vi.fn(),
		delete: vi.fn(),
		getMarkdownFiles: vi.fn(() => []),
		adapter: { read: vi.fn(), write: vi.fn(), exists: vi.fn() },
	};
	workspace = {
		getActiveViewOfType: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
	};
	metadataCache = {
		getFileCache: vi.fn(() => null),
		on: vi.fn(),
	};
}

// --- Plugin ---

export class Plugin extends Component {
	app: App;
	manifest = { id: "test-plugin", name: "Test Plugin", version: "0.0.0" };

	constructor(app?: App) {
		super();
		this.app = app ?? new App();
	}

	loadData = vi.fn(async () => ({}));
	saveData = vi.fn(async () => {});
	addRibbonIcon = vi.fn(() => document.createElement("div"));
	addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }));
	addCommand = vi.fn();
	addSettingTab = vi.fn();
}

// --- UI Components ---

export class Notice {
	constructor(
		public message: string,
		public timeout?: number,
	) {}
}

export class Setting {
	settingEl = document.createElement("div");

	constructor(containerEl: HTMLElement) {
		containerEl.appendChild(this.settingEl);
	}

	setName = vi.fn(() => this);
	setDesc = vi.fn(() => this);
	setHeading = vi.fn(() => this);
	addText = vi.fn(
		(
			cb: (text: {
				setValue: ReturnType<typeof vi.fn>;
				setPlaceholder: ReturnType<typeof vi.fn>;
				onChange: ReturnType<typeof vi.fn>;
			}) => void,
		) => {
			cb({
				setValue: vi.fn(() => ({ onChange: vi.fn() })),
				setPlaceholder: vi.fn(() => ({
					setValue: vi.fn(() => ({ onChange: vi.fn() })),
				})),
				onChange: vi.fn(),
			});
			return this;
		},
	);
	addToggle = vi.fn(
		(
			cb: (toggle: {
				setValue: ReturnType<typeof vi.fn>;
				onChange: ReturnType<typeof vi.fn>;
			}) => void,
		) => {
			cb({ setValue: vi.fn(() => ({ onChange: vi.fn() })), onChange: vi.fn() });
			return this;
		},
	);
	addButton = vi.fn(
		(
			cb: (button: {
				setButtonText: ReturnType<typeof vi.fn>;
				setCta: ReturnType<typeof vi.fn>;
				onClick: ReturnType<typeof vi.fn>;
			}) => void,
		) => {
			cb({
				setButtonText: vi.fn(() => ({
					setCta: vi.fn(() => ({ onClick: vi.fn() })),
				})),
				setCta: vi.fn(),
				onClick: vi.fn(),
			});
			return this;
		},
	);
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl = document.createElement("div");
	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}
	display() {}
	hide() {}
}

// --- File System ---

export class TFile {
	path = "test.md";
	name = "test.md";
	basename = "test";
	extension = "md";
}

export class TFolder {
	path = "test-folder";
	name = "test-folder";
	children: (TFile | TFolder)[] = [];
}

// --- Utilities ---

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
