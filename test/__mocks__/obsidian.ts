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
		getLeavesOfType: vi.fn(() => [] as WorkspaceLeaf[]),
		getRightLeaf: vi.fn(() => new WorkspaceLeaf()),
		getLeaf: vi.fn(() => new WorkspaceLeaf()),
		revealLeaf: vi.fn(),
		setActiveLeaf: vi.fn(),
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

	loadData = vi.fn<() => Promise<unknown>>(async () => ({}));
	saveData = vi.fn<(data: unknown) => Promise<void>>(async () => {});
	addRibbonIcon = vi.fn(() => document.createElement("div"));
	addStatusBarItem = vi.fn(() => ({ setText: vi.fn() }));
	addCommand = vi.fn();
	addSettingTab = vi.fn();
	registerView = vi.fn();
	register = vi.fn();
	removeCommand = vi.fn();
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

// --- Workspace / Views ---

export class WorkspaceLeaf {
	view: unknown = undefined;
	setViewState = vi.fn();
	detach = vi.fn();
}

export class ItemView extends Component {
	leaf: WorkspaceLeaf;
	contentEl = document.createElement("div");

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
	}

	onOpen = vi.fn(async () => {});
	onClose = vi.fn(async () => {});
}

// --- Menu / Modal ---

interface MenuItem {
	setTitle: ReturnType<typeof vi.fn>;
	setIcon: ReturnType<typeof vi.fn>;
	setDisabled: ReturnType<typeof vi.fn>;
	onClick: ReturnType<typeof vi.fn>;
}

export class Menu {
	addItem = vi.fn((cb: (item: MenuItem) => void) => {
		const item: MenuItem = {
			setTitle: vi.fn(() => item),
			setIcon: vi.fn(() => item),
			setDisabled: vi.fn(() => item),
			onClick: vi.fn(() => item),
		};
		cb(item);
		return this;
	});
	showAtMouseEvent = vi.fn();
}

export class Modal {
	app: App;
	contentEl = document.createElement("div");

	constructor(app: App) {
		this.app = app;
	}

	open = vi.fn();
	close = vi.fn();
	onOpen = vi.fn(() => {});
	onClose = vi.fn(() => {});
}

// --- Event ref (opaque marker) ---

export class EventRef {}

// --- Icons ---

export const setIcon = vi.fn();

// --- Utilities ---

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
