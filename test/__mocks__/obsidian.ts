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

// In real Obsidian, `activeDocument` is a global pointing to the document of
// the currently-active window (handles popouts). jsdom has no equivalent —
// point it at the single jsdom `document` so production code using
// `activeDocument.*` runs unchanged under tests.
if (typeof globalThis !== "undefined" && typeof document !== "undefined") {
	const g = globalThis as typeof globalThis & { activeDocument?: Document };
	if (g.activeDocument === undefined) g.activeDocument = document;
}

// In real Obsidian, `activeWindow` is the Window of the currently-active
// leaf (handles popout windows). jsdom has no equivalent — point it at
// globalThis so production code calling `activeWindow.setTimeout` /
// `activeWindow.clearTimeout` resolves to the same timer functions that
// `vi.useFakeTimers()` patches, keeping fake-timer tests correct.
// Idempotent guard prevents double-assignment across test worker reloads.
if (typeof globalThis !== "undefined") {
	const g = globalThis as typeof globalThis & { activeWindow?: typeof globalThis };
	if (g.activeWindow === undefined) g.activeWindow = globalThis;
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
		getFiles: vi.fn<() => TFile[]>(() => []),
		adapter: { read: vi.fn(), write: vi.fn(), exists: vi.fn() },
		process: vi.fn<(file: TFile, fn: (data: string) => string) => Promise<void>>(
			async () => {},
		),
		trash: vi.fn<(file: TFile, useSystemTrash: boolean) => Promise<void>>(
			async () => {},
		),
		createFolder: vi.fn<(path: string) => Promise<void>>(async () => {}),
		// FolderSuggest enumerates folders for the path-setting autocomplete.
		getAllFolders: vi.fn<(includeRoot?: boolean) => TFolder[]>(() => []),
	};
	workspace = {
		getActiveViewOfType: vi.fn(),
		getActiveFile: vi.fn<() => TFile | null>(() => null),
		on: vi.fn(),
		off: vi.fn(),
		// Invoke the callback synchronously so layout-ready-deferred wiring
		// (e.g. T4.5's active-leaf-change registration) is testable without a
		// real Obsidian workspace bootstrap.
		onLayoutReady: vi.fn((cb: () => void) => {
			cb();
		}),
		getLeavesOfType: vi.fn(() => [] as WorkspaceLeaf[]),
		getRightLeaf: vi.fn(() => new WorkspaceLeaf()),
		// `newLeaf` mirrors real Obsidian's `PaneType | boolean` union (a bare
		// `boolean` for replace/new-tab, or `"split"`/`"tab"`/`"window"` for a
		// `PaneType`) — typed as `boolean | string` here since the mock has no
		// need to import the real `PaneType` union.
		openLinkText: vi.fn<
			(linktext: string, sourcePath: string, newLeaf?: boolean | string) => Promise<void>
		>(async () => {}),
		getLeaf: vi.fn(() => new WorkspaceLeaf()),
		revealLeaf: vi.fn(),
		setActiveLeaf: vi.fn(),
		// Real Obsidian's page-preview core plugin listens for this to show
		// hover previews (garden-audit T6.2, PRD F9). A plain vi.fn — tests
		// assert the call, nothing subscribes to it here.
		trigger: vi.fn(),
	};
	metadataCache = {
		getFileCache: vi.fn<(file: TFile) => { headings: unknown[]; sections: unknown[] }>(
			() => ({ headings: [], sections: [] }),
		),
		// Resolves a link target to a `TFile` (or `null` if it doesn't exist) —
		// the standard Obsidian idiom for "does this link resolve" at render
		// time. Defaults to resolving (a fresh TFile) so existing tests that
		// don't care about the missing-target path keep passing unchanged;
		// tests exercising T6.2's "note not found" degrade override this to
		// return `null`.
		getFirstLinkpathDest: vi.fn<(linkpath: string, sourcePath: string) => TFile | null>(
			() => new TFile(),
		),
		on: vi.fn(),
	};
	fileManager = {
		renameFile: vi.fn<(file: TFile, newPath: string) => Promise<void>>(
			async () => {},
		),
		trashFile: vi.fn<(file: TFile) => Promise<void>>(async () => {}),
	};
}

// --- Plugin ---

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	minAppVersion?: string;
	description?: string;
	author?: string;
	authorUrl?: string;
	isDesktopOnly?: boolean;
}

export class Plugin extends Component {
	app: App;
	manifest: PluginManifest = {
		id: "test-plugin",
		name: "Test Plugin",
		version: "0.0.0",
	};

	// Real obsidian.d.ts declares `(app, manifest)` (2-arg). The mock accepts
	// either form so existing tests that pass `(app)` keep working AND tests
	// that need `this.manifest.id` to reflect a real plugin id can pass a
	// manifest. Extended in T5.3 — `main.ts` calls
	// `app.setting.openTabById(this.manifest.id)`.
	constructor(app?: App, manifest?: PluginManifest) {
		super();
		this.app = app ?? new App();
		if (manifest !== undefined) this.manifest = manifest;
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
	// CM6 editor extension registration (T4.5 — IDE Bridge selection tracking).
	// Obsidian auto-tears-down registered extensions on unload, so this is a
	// fire-and-forget vi.fn for assertion only.
	registerEditorExtension = vi.fn();
}

// --- UI Components ---

// `Notice` is exposed as a `vi.fn()` constructor (not a `class`) so tests can
// assert `vi.mocked(Notice).toHaveBeenCalledWith(...)` without spying.
// Production code uses it as `new Notice(message, timeout?)`; vi.fn supports
// `new`-construction and records the same call list as a function call.
export const Notice = vi.fn(function Notice(
	this: { message: string; timeout?: number },
	message: string,
	timeout?: number,
) {
	this.message = message;
	this.timeout = timeout;
}) as unknown as new (message: string, timeout?: number) => {
	message: string;
	timeout?: number;
};

export class Setting {
	settingEl = document.createElement("div");

	constructor(containerEl: HTMLElement) {
		containerEl.appendChild(this.settingEl);
	}

	// NOTE: setName/setDesc here APPEND a child each call. Real Obsidian
	// REPLACES the existing name/desc element. Safe in current usage because
	// `display()` calls `containerEl.empty()` and constructs fresh `Setting`
	// instances, so each name/desc is appended exactly once. Do not reuse a
	// `Setting` instance across `display()` calls — the labels would stack.
	setName = vi.fn((name: string) => {
		const nameEl = document.createElement("div");
		nameEl.classList.add("setting-item-name");
		nameEl.textContent = name;
		this.settingEl.appendChild(nameEl);
		return this;
	});
	setDesc = vi.fn((desc: string) => {
		const descEl = document.createElement("div");
		descEl.classList.add("setting-item-description");
		descEl.textContent = desc;
		this.settingEl.appendChild(descEl);
		return this;
	});
	setHeading = vi.fn(() => this);
	addText = vi.fn(
		(
			cb: (text: {
				setValue: ReturnType<typeof vi.fn>;
				setPlaceholder: ReturnType<typeof vi.fn>;
				onChange: ReturnType<typeof vi.fn>;
			}) => void,
		) => {
			// component returns itself from setValue/setPlaceholder/onChange so
			// both fluent chaining and separate-call patterns work in tests.
			const component = {
				// Real Obsidian exposes the underlying <input> as `inputEl`;
				// FolderSuggest attaches its type-ahead to it.
				inputEl: document.createElement("input"),
				setValue: vi.fn(() => component),
				setPlaceholder: vi.fn(() => component),
				onChange: vi.fn(() => component),
			};
			cb(component);
			return this;
		},
	);
	addTextArea = vi.fn(
		(
			cb: (text: {
				inputEl: HTMLTextAreaElement;
				setValue: ReturnType<typeof vi.fn>;
				setPlaceholder: ReturnType<typeof vi.fn>;
				onChange: ReturnType<typeof vi.fn>;
			}) => void,
		) => {
			const component = {
				inputEl: document.createElement("textarea"),
				setValue: vi.fn(() => component),
				setPlaceholder: vi.fn(() => component),
				onChange: vi.fn(() => component),
			};
			cb(component);
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
			const component = {
				setValue: vi.fn(() => component),
				onChange: vi.fn(() => component),
			};
			cb(component);
			return this;
		},
	);
	addButton = vi.fn(
		(
			cb: (button: {
				setButtonText: ReturnType<typeof vi.fn>;
				setCta: ReturnType<typeof vi.fn>;
				onClick: ReturnType<typeof vi.fn>;
				buttonEl: HTMLButtonElement;
			}) => void,
		) => {
			const buttonEl = document.createElement("button");
			const component = {
				setButtonText: vi.fn((text: string) => { buttonEl.textContent = text; return component; }),
				setCta: vi.fn(() => component),
				onClick: vi.fn((fn: () => void) => { buttonEl.addEventListener("click", fn); return component; }),
				buttonEl,
			};
			cb(component);
			return this;
		},
	);
	addDropdown = vi.fn(
		(
			cb: (dropdown: {
				addOption: ReturnType<typeof vi.fn>;
				setValue: ReturnType<typeof vi.fn>;
				onChange: ReturnType<typeof vi.fn>;
			}) => void,
		) => {
			const component = {
				addOption: vi.fn(() => component),
				setValue: vi.fn(() => component),
				onChange: vi.fn(() => component),
			};
			cb(component);
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
	// Real Obsidian's `View` base class exposes `app`, populated by the
	// Workspace when a leaf actually opens the view (before onOpen runs) —
	// not passed through the constructor. Declared as definite-assignment
	// here so views constructed directly in tests (bypassing the real
	// leaf.setViewState flow) must assign it themselves, mirroring that
	// real-world wiring order.
	app!: App;

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
	}

	// onOpen() / onClose() are declared as prototype methods (not field
	// assignments) so subclass overrides aren't clobbered by the parent
	// constructor's field initialization order. Mirrors the Modal mock
	// pattern below — same reasoning.
	onOpen(): void | Promise<void> {
		// default: no-op; subclasses override
	}

	onClose(): void | Promise<void> {
		// default: no-op; subclasses override
	}
}

// --- MarkdownView ---

// Minimal Editor shape used by ObsidianEditorAdapter — only the methods
// the adapter calls. Tests that exercise the real adapter via this mock
// can override individual vi.fn() returns.
interface MockEditor {
	getCursor: ReturnType<typeof vi.fn>;
	getSelection: ReturnType<typeof vi.fn>;
}

export class MarkdownView extends ItemView {
	file: TFile | null = null;
	editor: MockEditor = {
		getCursor: vi.fn(() => ({ line: 0, ch: 0 })),
		getSelection: vi.fn(() => ""),
	};

	getViewType(): string {
		return "markdown";
	}
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
	// M13: titleEl mirrors the real Obsidian Modal — Obsidian wires
	// aria-labelledby on the modal container to this element. Subclasses
	// can call this.titleEl.setText("…") instead of bypassing via
	// contentEl.createEl("h2", …).
	titleEl = document.createElement("div");

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

// --- Input suggest (folder autocomplete base) ---
//
// Mirrors the surface FolderSuggest relies on: constructor (app, inputEl),
// app field, setValue/getValue on the input, and no-op popover lifecycle.
// `getSuggestions` / `renderSuggestion` / `selectSuggestion` are provided by
// the subclass under test; tests can call `getSuggestions` directly to assert
// the vault-backed filtering without driving the real popover.
export abstract class AbstractInputSuggest<T> {
	app: App;
	limit = 100;

	constructor(app: App, protected inputEl: HTMLInputElement) {
		this.app = app;
	}

	setValue = vi.fn((value: string) => {
		this.inputEl.value = value;
	});
	getValue = vi.fn(() => this.inputEl.value);
	close = vi.fn();
	open = vi.fn();
	onSelect = vi.fn(() => this);

	protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
	abstract renderSuggestion(value: T, el: HTMLElement): void;
	abstract selectSuggestion(value: T, evt?: MouseEvent | KeyboardEvent): void;
}

// --- Suggest modals (command-palette-style pickers) ---
//
// Mirrors the surface SpotPicker (SuggestModal) and the fuzzy field pickers
// (FuzzySuggestModal) rely on. As with AbstractInputSuggest, tests drive the
// logic directly (call getSuggestions / getItems / getItemText / onChooseItem)
// rather than the real popover. open()/close() invoke onOpen/onClose so
// lifecycle spies work.
export abstract class SuggestModal<T> {
	app: App;
	limit = 100;
	inputEl = document.createElement("input");
	resultContainerEl = document.createElement("div");

	constructor(app: App) {
		this.app = app;
	}

	setPlaceholder = vi.fn((_placeholder: string) => {});
	setInstructions = vi.fn();
	open = vi.fn(() => {
		void this.onOpen();
	});
	close = vi.fn(() => {
		void this.onClose();
	});

	onOpen(): void {
		// default no-op; subclasses may override
	}
	onClose(): void {
		// default no-op; subclasses may override
	}

	abstract getSuggestions(query: string): T[] | Promise<T[]>;
	abstract renderSuggestion(value: T, el: HTMLElement): void;
	abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
}

export interface FuzzyMatch<T> {
	item: T;
	match: { score: number; matches: number[][] };
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
	abstract getItems(): T[];
	abstract getItemText(item: T): string;
	abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;

	getSuggestions(query: string): FuzzyMatch<T>[] {
		const q = query.toLowerCase();
		return this.getItems()
			.filter((item) => this.getItemText(item).toLowerCase().includes(q))
			.map((item) => ({ item, match: { score: 0, matches: [] } }));
	}

	renderSuggestion(match: FuzzyMatch<T>, el: HTMLElement): void {
		el.textContent = this.getItemText(match.item);
	}

	onChooseSuggestion(
		match: FuzzyMatch<T>,
		evt: MouseEvent | KeyboardEvent,
	): void {
		this.onChooseItem(match.item, evt);
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
