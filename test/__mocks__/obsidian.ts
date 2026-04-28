/**
 * Lightweight Obsidian API mock for unit testing.
 * Provides minimal stubs of the classes and functions used in the plugin skeleton.
 * Extend as needed when adding new Obsidian API usage.
 */

import { vi } from "vitest";

// --- HTMLElement polyfills (Obsidian DOM helpers) ---
//
// Real Obsidian augments HTMLElement.prototype with createDiv / createEl /
// empty / addClass / removeClass / setText / setAttr. jsdom doesn't provide
// these. Polyfill them here so production code can use the idiomatic
// Obsidian style and still run under vitest. Idempotent — guarded so that
// reloading the mock module under different test workers can't double-wrap.

interface DomElInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string>;
	parent?: HTMLElement;
}

function applyDomElInfo(el: HTMLElement, info?: DomElInfo): void {
	if (info === undefined) return;
	if (info.cls !== undefined) {
		const classes = Array.isArray(info.cls) ? info.cls : [info.cls];
		for (const c of classes) el.classList.add(c);
	}
	if (info.text !== undefined) el.textContent = info.text;
	if (info.attr !== undefined) {
		for (const [k, v] of Object.entries(info.attr)) el.setAttribute(k, v);
	}
}

interface ObsidianElementShim {
	createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		info?: DomElInfo,
	): HTMLElementTagNameMap[K];
	createDiv(info?: DomElInfo | string): HTMLDivElement;
	createSpan(info?: DomElInfo | string): HTMLSpanElement;
	empty(): void;
	addClass(...classes: string[]): void;
	removeClass(...classes: string[]): void;
	setText(text: string): void;
	setAttr(key: string, value: string): void;
}

if (typeof HTMLElement !== "undefined") {
	const proto = HTMLElement.prototype as unknown as ObsidianElementShim & {
		__hashiObsidianShimInstalled?: true;
	};
	if (proto.__hashiObsidianShimInstalled !== true) {
		proto.__hashiObsidianShimInstalled = true;

		proto.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
			this: HTMLElement,
			tag: K,
			info?: DomElInfo,
		): HTMLElementTagNameMap[K] {
			const el = document.createElement(tag);
			applyDomElInfo(el, info);
			(info?.parent ?? this).appendChild(el);
			return el;
		};

		proto.createDiv = function createDiv(
			this: HTMLElement,
			info?: DomElInfo | string,
		): HTMLDivElement {
			const normalized: DomElInfo | undefined =
				typeof info === "string" ? { cls: info } : info;
			const el = document.createElement("div");
			applyDomElInfo(el, normalized);
			(normalized?.parent ?? this).appendChild(el);
			return el;
		};

		proto.createSpan = function createSpan(
			this: HTMLElement,
			info?: DomElInfo | string,
		): HTMLSpanElement {
			const normalized: DomElInfo | undefined =
				typeof info === "string" ? { cls: info } : info;
			const el = document.createElement("span");
			applyDomElInfo(el, normalized);
			(normalized?.parent ?? this).appendChild(el);
			return el;
		};

		proto.empty = function empty(this: HTMLElement): void {
			while (this.firstChild !== null) this.removeChild(this.firstChild);
		};

		proto.addClass = function addClass(
			this: HTMLElement,
			...classes: string[]
		): void {
			for (const c of classes) this.classList.add(c);
		};

		proto.removeClass = function removeClass(
			this: HTMLElement,
			...classes: string[]
		): void {
			for (const c of classes) this.classList.remove(c);
		};

		proto.setText = function setText(this: HTMLElement, text: string): void {
			this.textContent = text;
		};

		proto.setAttr = function setAttr(
			this: HTMLElement,
			key: string,
			value: string,
		): void {
			this.setAttribute(key, value);
		};
	}
}

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
	// Real Obsidian returns a status-bar HTMLElement that supports the same
	// DOM helpers as any other Obsidian element (createSpan / addClass /
	// setAttr — provided by the prototype shim above). Returning a real
	// HTMLElement lets production code use idiomatic Obsidian style.
	addStatusBarItem = vi.fn(() => document.createElement("div"));
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
	// Per-instance capture of every item-builder addItem created. Tests
	// can introspect setTitle / setIcon / setDisabled / onClick calls
	// after the popover is built without re-running the addItem callback
	// (which would double-bind handlers). Extended in T4.2 to support
	// status-bar popover tests.
	items: MenuItem[] = [];
	addItem = vi.fn((cb: (item: MenuItem) => void) => {
		const item: MenuItem = {
			setTitle: vi.fn(() => item),
			setIcon: vi.fn(() => item),
			setDisabled: vi.fn(() => item),
			onClick: vi.fn(() => item),
		};
		this.items.push(item);
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

	// open() / close() mirror real Obsidian: `open` invokes `onOpen()` and
	// `close` invokes `onClose()`. Both are vi.fn-wrapped so tests can spy
	// on call-counts, but the wrapped impl still drives the lifecycle.
	// Subclasses override `onOpen` / `onClose` as prototype methods (not
	// field assignments) so overrides aren't clobbered by the parent
	// constructor.
	open = vi.fn(() => {
		void this.onOpen();
	});
	close = vi.fn(() => {
		void this.onClose();
	});

	onOpen(): void | Promise<void> {
		// default: no-op; subclasses override
	}

	onClose(): void | Promise<void> {
		// default: no-op; subclasses override
	}
}

// --- Event ref (opaque marker) ---

export class EventRef {}

// --- Icons ---

export const setIcon = vi.fn();

// --- Utilities ---

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
