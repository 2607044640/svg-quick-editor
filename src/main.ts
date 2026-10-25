import { App, MarkdownView, Notice, Platform, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { adaptAllTextBackgrounds, adaptBackgroundToText, asText, cloneCard, commitText, findTextInCard, insertCloneSibling, nudge, readText, resolveCloneTarget, resolveDeleteTarget, resolveHit, resolveScaleTarget, scaleCard, serializeSvg, smartAutoLayout, snapDelta, writeText, type AlignGuide, type TextHit } from "./svgCard";
import { openTextOverlay, type OverlayHandle } from "./editorOverlay";
import { resolveEffectiveEditorColors } from "./svgTheme";
import { ensureMarker, matchSpan, spliceSvg } from "./svgSource";
import { cleanSvgHtml, replaceSvgChildrenFromMarkup, SvgHistoryManager } from "./svgHistory";
import { getLocaleStrings, isChineseLocale } from "./i18n";
import {
	MARK,
	SVG_PATH_ATTR,
	cleanupFluentTasksSvgLinks,
	cleanupSvgEmbedsInNotes,
	getLinkedTasksInfo,
	isDiagramSvg,
	isFluentTasksInstalled,
	isTodoDataSvg,
	prepareSvgMarkup,
	readVaultSvgFile,
	resolveVaultSvgFile,
	sanitizeSvgLinkPath,
	writeVaultSvgFile,
} from "./svgVaultUtils";
import "./styles.css";

export { getLocaleStrings, isDiagramSvg };

interface A1SvgQuickEditorSettings {
	openEditorHotkey: string; // e.g. "Ctrl+Shift+Alt+I"
	deleteSvgHotkey: string; // e.g. "Ctrl+Delete"
	smartLayoutHotkey: string; // e.g. "Ctrl+Shift+S"
}

const DEFAULT_SETTINGS: A1SvgQuickEditorSettings = {
	openEditorHotkey: "Ctrl+Shift+Alt+I",
	deleteSvgHotkey: "Ctrl+Delete",
	smartLayoutHotkey: "Ctrl+Shift+S",
};

export default class A1SvgQuickEditorPlugin extends Plugin {
	settings: A1SvgQuickEditorSettings = DEFAULT_SETTINGS;
	public history: SvgHistoryManager = new SvgHistoryManager();
	private overlay: OverlayHandle | null = null;
	private hovered: Element | null = null;
	private hoveredSvgTarget: Element | null = null;
	private lastPointerX = 0;
	private lastPointerY = 0;
	private dragging: {
		card: Element;
		svg: SVGSVGElement;
		pointerId: number;
		lastX: number;
		lastY: number;
		moved: boolean;
		mode: "move" | "clone";
		snapOffsetUserX: number;
		snapOffsetUserY: number;
	} | null = null;
	private autoAlign = true;
	private activeModal: HTMLElement | null = null;
	private currentModalPath: string | null = null;
	private currentModalTitle: string | null = null;
	private currentModalBody: HTMLElement | null = null;
	private currentModalSvg: SVGSVGElement | null = null;
	private toastTimer: any = null;
	private activeToastEl: HTMLElement | null = null;
	private lastSelfSave: { path: string; timestamp: number; content: string } | null = null;

	public commitActiveOverlay(): void {
		if (this.overlay) {
			this.overlay.commit();
			this.overlay = null;
		}
	}

	public cancelActiveOverlay(): void {
		if (this.overlay) {
			this.overlay.cancel();
			this.overlay = null;
		}
	}

	public isRecentSelfSave(filePath: string, diskContent?: string): boolean {
		if (!this.lastSelfSave || !filePath) return false;
		const cleanTarget = sanitizeSvgLinkPath(filePath).toLowerCase();
		const cleanSaved = sanitizeSvgLinkPath(this.lastSelfSave.path).toLowerCase();
		const targetBase = cleanTarget.split("/").pop() || "";
		const savedBase = cleanSaved.split("/").pop() || "";
		const pathMatches = cleanTarget === cleanSaved || (targetBase !== "" && targetBase === savedBase);
		if (!pathMatches) return false;

		if (Date.now() - this.lastSelfSave.timestamp < 2500) {
			return true;
		}
		if (diskContent) {
			const normDisk = diskContent.replace(/\s+/g, " ").trim();
			const normSaved = this.lastSelfSave.content.replace(/\s+/g, " ").trim();
			if (normDisk === normSaved) return true;
		}
		return false;
	}

	public showSaveToast(message?: string): void {
		const text = message || getLocaleStrings().noticeSaved("SVG");
		if (this.activeToastEl) {
			this.activeToastEl.remove();
			this.activeToastEl = null;
		}
		if (this.toastTimer) {
			clearTimeout(this.toastTimer);
			this.toastTimer = null;
		}

		// Insert directly inside the active modal dialog if present, otherwise on body
		const modalContainer = this.activeModal?.querySelector(".a1-svg-modal-dialog")
			?? (document.querySelector(".a1-svg-modal-dialog, .svg-lightbox-modal") as HTMLElement | null);
		const container = modalContainer ?? document.body;
		const isInModal = container !== document.body;

		const toast = document.createElement("div");
		toast.className = isInModal ? "a1-svg-modal-toast" : "a1-svg-toast";

		const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		iconSvg.setAttribute("class", "a1-svg-toast-icon");
		iconSvg.setAttribute("viewBox", "0 0 24 24");
		iconSvg.setAttribute("fill", "none");
		iconSvg.setAttribute("stroke", "#4ade80");
		iconSvg.setAttribute("stroke-width", "2.5");
		iconSvg.setAttribute("stroke-linecap", "round");
		iconSvg.setAttribute("stroke-linejoin", "round");
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", "M20 6L9 17l-5-5");
		iconSvg.appendChild(path);

		const textSpan = document.createElement("span");
		textSpan.textContent = text;

		toast.appendChild(iconSvg);
		toast.appendChild(textSpan);
		container.appendChild(toast);
		this.activeToastEl = toast;

		// 3-second display duration
		this.toastTimer = setTimeout(() => {
			toast.classList.add("is-fading");
			setTimeout(() => {
				toast.remove();
				if (this.activeToastEl === toast) {
					this.activeToastEl = null;
				}
			}, 300);
		}, 3000);
	}

	public getAutoAlign(): boolean {
		return this.autoAlign;
	}

	public setAutoAlign(enabled: boolean): void {
		this.autoAlign = enabled;
		if (!enabled && this.dragging) {
			if (this.dragging.snapOffsetUserX !== 0 || this.dragging.snapOffsetUserY !== 0) {
				nudge(this.dragging.card, -this.dragging.snapOffsetUserX, -this.dragging.snapOffsetUserY);
				this.dragging.snapOffsetUserX = 0;
				this.dragging.snapOffsetUserY = 0;
			}
			this.clearAlignGuides(this.dragging.svg);
		}
	}

	public smartLayout(targetSvg?: SVGSVGElement | null): boolean {
		this.commitActiveOverlay();
		const svg = targetSvg ?? this.currentModalSvg ?? (document.querySelector(".a1-svg-modal-body svg, .svg-lightbox-content svg") as SVGSVGElement | null);
		if (!svg) return false;
		this.clearHover();
		this.history.setActiveSvg(svg);
		const preLayoutSnapshot = cleanSvgHtml(svg.innerHTML);
		const res = smartAutoLayout(svg);
		const i18n = getLocaleStrings();
		if (res.changed) {
			this.history.recordExplicitSnapshot(svg, preLayoutSnapshot);
			this.showSaveToast(i18n.noticeSmartLayoutApplied);
			return true;
		} else {
			this.showSaveToast(i18n.noticeSmartLayoutNoChange);
			return false;
		}
	}

	async onload(): Promise<void> {
		(window as any).a1SvgQuickEditor = this;
		(window as any).svgQuickEditor = this;
		this.addSettingTab(new A1SvgQuickEditorSettingTab(this.app, this));
		await this.loadSettings();

		// Auto-refresh: listen to external file modifications on disk (e.g. AI edits)
		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (file instanceof TFile && file.extension === "svg") {
					if (this.isRecentSelfSave(file.path)) {
						return;
					}
					window.dispatchEvent(new CustomEvent("a1-svg-updated", {
						detail: { path: file.path, name: file.name, source: "vault-modify" }
					}));
					this.refreshImgEmbeds(file.path);
					if (this.currentModalPath && (this.currentModalPath === file.path || this.currentModalPath.endsWith(file.name))) {
						if (this.currentModalSvg && !this.history.isDirty(this.currentModalSvg)) {
							try {
								const { content: diskContent } = await readVaultSvgFile(this.app, file);
								if (diskContent && !this.isRecentSelfSave(file.path, diskContent)) {
									this.hotReloadModal(diskContent);
								}
							} catch (e) {
								console.error("Failed to hot reload on vault modify:", e);
							}
						}
					}
				}
			})
		);

		// Auto-refresh: when user switches back to Obsidian ("返回软件")
		this.registerDomEvent(window, "focus", () => {
			void this.checkAndRefreshActiveSvg();
		});
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "visible") {
				void this.checkAndRefreshActiveSvg();
			}
		});

		// Auto-refresh: when Obsidian launches / workspace layout ready
		this.app.workspace.onLayoutReady(() => {
			void this.checkAndRefreshActiveSvg();
		});

		this.registerDomEvent(window, "pointermove", (evt) => this.onPointerMove(evt), { capture: true });
		this.registerDomEvent(window, "pointerdown", (evt) => this.onPointerDown(evt), { capture: true });
		this.registerDomEvent(window, "pointerup", (evt) => this.onPointerUp(evt), { capture: true });
		this.registerDomEvent(window, "keydown", (evt) => this.onKeyDown(evt), { capture: true });
		this.registerDomEvent(window, "wheel", (evt) => this.onWheel(evt), { capture: true, passive: false } as any);
		this.registerDomEvent(window, "dblclick", (evt) => {
			if (evt.shiftKey || evt.altKey) return;
			const text = this.textFromEvent(evt) ?? (evt.target instanceof Element ? findTextInCard(evt.target, evt.clientX, evt.clientY) : null);
			if (text && this.isInteractiveSvg(text)) {
				evt.preventDefault();
				evt.stopPropagation();
				evt.stopImmediatePropagation();
				void this.beginEdit(text);
			}
		}, { capture: true });

		this.registerDomEvent(window, "click", (evt) => {
			if (this.overlay || (evt as MouseEvent).shiftKey || (evt as MouseEvent).altKey) return;
			const target = evt.target;
			if (!(target instanceof Element)) return;

			const modalContainer = target.closest(".a1-svg-modal-body, .svg-lightbox-content");
			if (!modalContainer) return;

			// If clicked directly on text in modal or lightbox: begin editing immediately
			const text = asText(target);
			if (text && this.isInteractiveSvg(text)) {
				evt.preventDefault();
				evt.stopPropagation();
				this.setHover(text);
				void this.beginEdit(text);
				return;
			}

			// If clicked on a card (rect, g, etc.): focus and target that card
			const cardText = findTextInCard(target, evt.clientX, evt.clientY);
			if (cardText && this.isInteractiveSvg(cardText)) {
				this.setHover(cardText);
			}
		}, { capture: true });

		this.addCommand({
			id: "edit-svg-text",
			name: "Edit SVG text under cursor (F2 / Inline)",
			callback: () => {
				void this.executeEditSvgText();
			},
		});

		this.addCommand({
			id: "open-svg-image-editor",
			name: "Open SVG Image Editor for hovered SVG image",
			callback: () => {
				const target = this.hoveredSvgTarget ?? this.findSvgTargetAtPoint(this.lastPointerX, this.lastPointerY);
				if (target) void this.openSvgEditorModal(target);
				else new Notice(getLocaleStrings().noticeHoverSvgPrompt);
			},
		});

		this.addCommand({
			id: "smart-layout-svg",
			name: "Smart layout active SVG (Auto-center and balance cards)",
			callback: () => {
				this.smartLayout();
			},
		});

		this.addCommand({
			id: "delete-active-svg",
			name: "Delete active SVG (with confirmation)",
			checkCallback: (checking: boolean) => {
				const hasModal = !!(this.activeModal || document.querySelector(".a1-svg-modal-dialog, .svg-lightbox-modal"));
				if (checking) return hasModal;
				void this.promptDeleteActiveSvg();
				return true;
			},
		});
	}

	onunload(): void {
		if ((window as any).a1SvgQuickEditor === this) {
			(window as any).a1SvgQuickEditor = null;
		}
		if ((window as any).svgQuickEditor === this) {
			(window as any).svgQuickEditor = null;
		}
		this.clearHover();
		this.clearHoveredSvgTarget();
		this.overlay?.close();
		this.overlay = null;
		this.activeModal?.remove();
		this.activeModal = null;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<A1SvgQuickEditorSettings> || {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private matchesObsidianHotkey(evt: KeyboardEvent, hotkey: { modifiers?: string[]; key?: string }): boolean {
		if (!hotkey || !hotkey.key) return false;
		const isMac = Platform.isMacOS;
		const mods = (hotkey.modifiers || []).map((m) => m.toLowerCase());
		const wantsCtrl = mods.includes("ctrl") || mods.includes("control") || (!isMac && mods.includes("mod"));
		const wantsMeta = mods.includes("meta") || mods.includes("cmd") || mods.includes("command") || (isMac && mods.includes("mod"));
		const wantsShift = mods.includes("shift");
		const wantsAlt = mods.includes("alt");

		if (evt.ctrlKey !== wantsCtrl) return false;
		if (evt.metaKey !== wantsMeta) return false;
		if (evt.shiftKey !== wantsShift) return false;
		if (evt.altKey !== wantsAlt) return false;

		const target = hotkey.key.toLowerCase();
		const pressedKey = (evt.key || "").toLowerCase();
		const pressedCode = (evt.code || "").toLowerCase();
		return pressedKey === target || pressedCode === `key${target}` || pressedCode === `digit${target}` || pressedCode === target;
	}

	private matchesHotkey(evt: KeyboardEvent, hotkeyStr: string): boolean {
		if (!hotkeyStr || !hotkeyStr.trim()) return false;
		const isMac = Platform.isMacOS;
		const parts = hotkeyStr.split("+").map((p) => p.trim().toLowerCase());
		const hasCtrl = parts.includes("ctrl") || parts.includes("control") || (!isMac && parts.includes("mod"));
		const hasMeta = parts.includes("meta") || parts.includes("cmd") || parts.includes("command") || (isMac && parts.includes("mod"));
		const hasShift = parts.includes("shift");
		const hasAlt = parts.includes("alt");
		const keyPart = parts.find((p) => !["ctrl", "control", "shift", "alt", "meta", "cmd", "command", "mod"].includes(p)) || "";

		if (evt.ctrlKey !== hasCtrl) return false;
		if (evt.metaKey !== hasMeta) return false;
		if (evt.shiftKey !== hasShift) return false;
		if (evt.altKey !== hasAlt) return false;

		const pressedKey = (evt.key || "").toLowerCase();
		const pressedCode = (evt.code || "").toLowerCase();
		const targetKey = keyPart.toLowerCase();
		return pressedKey === targetKey || pressedCode === `key${targetKey}` || pressedCode === `digit${targetKey}` || pressedCode === targetKey;
	}

	private isSvgEditHotkey(evt: KeyboardEvent): boolean {
		// 1. Check custom setting string
		if (this.matchesHotkey(evt, this.settings.openEditorHotkey)) return true;
		// 2. Check common defaults / permutations
		if (this.matchesHotkey(evt, "Ctrl+Shift+Alt+I")) return true;
		if (this.matchesHotkey(evt, "Ctrl+Alt+Shift+I")) return true;
		if (this.matchesHotkey(evt, "Mod+Alt+Shift+I")) return true;
		if (this.matchesHotkey(evt, "Mod+Shift+Alt+I")) return true;

		// 3. Check Obsidian command hotkeys for both edit commands
		interface HotkeyEntry { modifiers?: string[]; key?: string }
		interface HotkeyManagerLike {
			getHotkeys?: (id: string) => HotkeyEntry[] | undefined;
			customKeys?: Record<string, HotkeyEntry[] | undefined>;
			defaultKeys?: Record<string, HotkeyEntry[] | undefined>;
		}
		const hkMgr = (this.app as unknown as { hotkeyManager?: HotkeyManagerLike }).hotkeyManager;
		if (hkMgr) {
			const commandIds = [
				"svg-quick-editor:edit-svg-text",
				"svg-quick-editor:open-svg-image-editor",
				"a1-svg-quick-editor:edit-svg-text",
				"a1-svg-quick-editor:open-svg-image-editor"
			];
			for (const id of commandIds) {
				const list: HotkeyEntry[] = [
					...(hkMgr.getHotkeys?.(id) || []),
					...(hkMgr.customKeys?.[id] || []),
					...(hkMgr.defaultKeys?.[id] || [])
				];
				for (const hk of list) {
					if (this.matchesObsidianHotkey(evt, hk)) return true;
				}
			}
		}
		return false;
	}

	public isDeleteSvgHotkey(evt: KeyboardEvent): boolean {
		if (this.settings.deleteSvgHotkey && this.matchesHotkey(evt, this.settings.deleteSvgHotkey)) return true;
		if (this.matchesHotkey(evt, "Ctrl+Delete") || this.matchesHotkey(evt, "Mod+Delete")) return true;

		interface HotkeyEntry { modifiers?: string[]; key?: string }
		interface HotkeyManagerLike {
			getHotkeys?: (id: string) => HotkeyEntry[] | undefined;
			customKeys?: Record<string, HotkeyEntry[] | undefined>;
			defaultKeys?: Record<string, HotkeyEntry[] | undefined>;
		}
		const hkMgr = (this.app as unknown as { hotkeyManager?: HotkeyManagerLike }).hotkeyManager;
		if (hkMgr) {
			const commandIds = [
				`${this.manifest.id}:delete-active-svg`,
				"svg-quick-editor:delete-active-svg",
				"a1-svg-quick-editor:delete-active-svg"
			];
			for (const id of commandIds) {
				const list: HotkeyEntry[] = [
					...(hkMgr.getHotkeys?.(id) || []),
					...(hkMgr.customKeys?.[id] || []),
					...(hkMgr.defaultKeys?.[id] || [])
				];
				for (const hk of list) {
					if (this.matchesObsidianHotkey(evt, hk)) return true;
				}
			}
		}
		return false;
	}

	public isSmartLayoutHotkey(evt: KeyboardEvent): boolean {
		if (this.settings.smartLayoutHotkey && this.matchesHotkey(evt, this.settings.smartLayoutHotkey)) return true;
		if (this.matchesHotkey(evt, "Ctrl+Shift+S") || this.matchesHotkey(evt, "Mod+Shift+S")) return true;

		interface HotkeyEntry { modifiers?: string[]; key?: string }
		interface HotkeyManagerLike {
			getHotkeys?: (id: string) => HotkeyEntry[] | undefined;
			customKeys?: Record<string, HotkeyEntry[] | undefined>;
			defaultKeys?: Record<string, HotkeyEntry[] | undefined>;
		}
		const hkMgr = (this.app as unknown as { hotkeyManager?: HotkeyManagerLike }).hotkeyManager;
		if (hkMgr) {
			const commandIds = [
				`${this.manifest.id}:smart-layout-svg`,
				"svg-quick-editor:smart-layout-svg",
				"a1-svg-quick-editor:smart-layout-svg"
			];
			for (const id of commandIds) {
				const list: HotkeyEntry[] = [
					...(hkMgr.getHotkeys?.(id) || []),
					...(hkMgr.customKeys?.[id] || []),
					...(hkMgr.defaultKeys?.[id] || [])
				];
				for (const hk of list) {
					if (this.matchesObsidianHotkey(evt, hk)) return true;
				}
			}
		}
		return false;
	}

	private onKeyDown(evt: KeyboardEvent): void {
		// Do not intercept keys when a confirmation dialog is open
		if (document.querySelector(".a1-svg-confirm-overlay, .svg-confirm-backdrop")) {
			return;
		}

		// When text input overlay is open, only intercept Ctrl+S / Cmd+S to commit & save; let all other keys pass to the input
		if (this.overlay) {
			if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey && (evt.key === "s" || evt.key === "S")) {
				const activeSvg = this.history.getActiveSvg() ??
					this.currentModalSvg ??
					(document.querySelector(".a1-svg-modal-body svg, .svg-lightbox-content svg") as SVGSVGElement | null);
				if (activeSvg) {
					evt.preventDefault();
					evt.stopPropagation();
					evt.stopImmediatePropagation();
					this.commitActiveOverlay();
					void this.saveCurrentSvg(activeSvg, true);
				}
			}
			return;
		}

		// 1. Hotkey check: Open SVG Image Editor or start text edit (default, custom setting, or Obsidian bound hotkey)
		if (this.isSvgEditHotkey(evt)) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
			void this.executeEditSvgText();
			return;
		}

		// 2. F2 text editing check: Stop immediate propagation so Obsidian NEVER renames the note!
		if (evt.key === "F2" && !evt.repeat && !evt.altKey && !evt.metaKey && !evt.ctrlKey) {
			const el = (this.lastPointerX > 0 || this.lastPointerY > 0)
				? document.elementFromPoint(this.lastPointerX, this.lastPointerY)
				: null;
			const target = this.hoveredSvgTarget ?? (el ? this.matchSvgElement(el) : null);
			const text = this.hovered ?? (el ? findTextInCard(el, this.lastPointerX, this.lastPointerY) : null);
			const inModal = el?.closest(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body") ||
				document.querySelector(".svg-lightbox-content, .a1-svg-modal-body");
			if (text || target || inModal) {
				evt.preventDefault();
				evt.stopPropagation();
				evt.stopImmediatePropagation();
				void this.executeEditSvgText();
				return;
			}
		}

		// 3. Smart Layout (default Ctrl+Shift+S / custom setting)
		if (this.isSmartLayoutHotkey(evt) && !evt.repeat) {
			const activeSvg = this.history.getActiveSvg() ??
				this.currentModalSvg ??
				(document.querySelector(".a1-svg-modal-body svg, .svg-lightbox-content svg") as SVGSVGElement | null);
			if (activeSvg) {
				evt.preventDefault();
				evt.stopPropagation();
				evt.stopImmediatePropagation();
				this.smartLayout(activeSvg);
				return;
			}
		}

		// 4. Save (Ctrl+S / Cmd+S): Directly overwrite local file, keeping Ctrl+Z/Y history
		if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !evt.shiftKey && (evt.key === "s" || evt.key === "S")) {
			const activeSvg = this.history.getActiveSvg() ??
				this.currentModalSvg ??
				(document.querySelector(".a1-svg-modal-body svg, .svg-lightbox-content svg") as SVGSVGElement | null);
			if (activeSvg) {
				evt.preventDefault();
				evt.stopPropagation();
				evt.stopImmediatePropagation();
				void this.saveCurrentSvg(activeSvg, true);
				return;
			}
		}

		// 5. Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
		if ((evt.ctrlKey || evt.metaKey) && !evt.altKey) {
			const activeSvg = this.history.getActiveSvg();
			if (activeSvg) {
				if (evt.key === "z" || evt.key === "Z") {
					evt.preventDefault();
					evt.stopPropagation();
					evt.stopImmediatePropagation();
					if (evt.shiftKey) {
						this.redo();
					} else {
						this.undo();
					}
					return;
				}
				if (evt.key === "y" || evt.key === "Y") {
					evt.preventDefault();
					evt.stopPropagation();
					evt.stopImmediatePropagation();
					this.redo();
					return;
				}
			}
		}

		// 6. Delete key: Directly delete hovered UI box/card element
		if ((evt.key === "Delete" || evt.code === "Delete") && !evt.repeat && !evt.altKey && !evt.metaKey && !evt.ctrlKey && !evt.shiftKey) {
			if (this.deleteHoveredBox()) {
				evt.preventDefault();
				evt.stopPropagation();
				evt.stopImmediatePropagation();
				return;
			}
		}
	}

	public deleteHoveredBox(): boolean {
		if (this.overlay) return false;
		const activeTag = document.activeElement?.tagName?.toLowerCase();
		if (activeTag === "input" || activeTag === "textarea" || (document.activeElement as HTMLElement)?.isContentEditable) {
			return false;
		}

		const el = (this.lastPointerX > 0 || this.lastPointerY > 0)
			? document.elementFromPoint(this.lastPointerX, this.lastPointerY)
			: null;
		const candidate = this.hovered ?? el ?? this.hoveredSvgTarget;
		if (!candidate) return false;

		const delTarget = resolveDeleteTarget(candidate, this.lastPointerX, this.lastPointerY);
		if (!delTarget || !this.isInteractiveSvg(delTarget.svg)) return false;

		this.clearHover();
		this.clearHoveredSvgTarget();
		this.history.recordSnapshot(delTarget.svg);
		delTarget.element.remove();

		const inModal = !!delTarget.svg.closest(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body");
		if (!inModal) {
			void this.persistSvg(delTarget.svg);
		}

		const isZh = isChineseLocale();
		this.showSaveToast(isZh ? "已删除 UI 框 (Ctrl+Z 可撤销)" : "UI box deleted (Ctrl+Z to undo)");
		return true;
	}

	private onWheel(evt: WheelEvent): void {
		if (!evt.ctrlKey && !evt.metaKey) return;
		if (this.overlay) return;

		const factor = evt.deltaY < 0 ? 1.08 : 0.92;
		if (this.scaleHoveredBox(factor)) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
		}
	}

	public scaleHoveredBox(factor: number): boolean {
		if (this.overlay) return false;
		const activeTag = document.activeElement?.tagName?.toLowerCase();
		if (activeTag === "input" || activeTag === "textarea" || (document.activeElement as HTMLElement)?.isContentEditable) {
			return false;
		}

		const el = (this.lastPointerX > 0 || this.lastPointerY > 0)
			? document.elementFromPoint(this.lastPointerX, this.lastPointerY)
			: null;
		const candidate = this.hovered ?? el ?? this.hoveredSvgTarget;
		if (!candidate) return false;

		const scaleTarget = resolveScaleTarget(candidate, this.lastPointerX, this.lastPointerY);
		if (!scaleTarget || !this.isInteractiveSvg(scaleTarget.svg)) return false;

		this.history.setActiveSvg(scaleTarget.svg);
		const preScaleSnapshot = cleanSvgHtml(scaleTarget.svg.innerHTML);
		const res = scaleCard(scaleTarget.element, scaleTarget.svg, factor);
		if (!res) return false;
		this.history.recordExplicitSnapshot(scaleTarget.svg, preScaleSnapshot);

		const inModal = !!scaleTarget.svg.closest(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body");
		if (!inModal) {
			void this.persistSvg(scaleTarget.svg);
		}

		const pct = Math.round(res.scale * 100);
		const isZh = isChineseLocale();
		this.showSaveToast(isZh ? `UI 大小: ${pct}% (Ctrl+Z 可撤销)` : `UI Scale: ${pct}% (Ctrl+Z to undo)`);
		return true;
	}

	public undo(svg?: SVGSVGElement | null): boolean {
		this.commitActiveOverlay();
		const res = this.history.undo(svg);
		if (res) {
			this.clearHover();
			new Notice(getLocaleStrings().noticeUndo);
		}
		return res;
	}

	public redo(svg?: SVGSVGElement | null): boolean {
		this.commitActiveOverlay();
		const res = this.history.redo(svg);
		if (res) {
			this.clearHover();
			new Notice(getLocaleStrings().noticeRedo);
		}
		return res;
	}

	public isSvgDirty(svg?: SVGSVGElement | null): boolean {
		return this.history.isDirty(svg);
	}

	public registerActiveSvg(svg: SVGSVGElement): void {
		this.history.setActiveSvg(svg);
	}

	public async saveCurrentSvg(svg?: SVGSVGElement | null, keepHistory = false): Promise<boolean> {
		this.commitActiveOverlay();
		this.clearHover();
		const target = svg ??
			this.history.getActiveSvg() ??
			this.currentModalSvg ??
			(document.querySelector(".a1-svg-modal-body svg, .svg-lightbox-content svg") as SVGSVGElement | null);
		if (!target) return false;
		const ok = await this.persistSvg(target);
		if (ok) {
			this.history.markSaved(target, keepHistory);
			return true;
		}
		new Notice(getLocaleStrings().noticeSaveFailed);
		return false;
	}

	public discardCurrentSvg(svg?: SVGSVGElement | null): void {
		this.cancelActiveOverlay();
		const target = svg ?? this.history.getActiveSvg();
		if (!target) return;
		this.history.discard(target);
		this.clearHover();
	}

	public clearSvgHistory(svg?: SVGSVGElement | null): void {
		this.history.clear(svg);
	}

	public async executeEditSvgText(): Promise<void> {
		if (this.overlay) return;

		let elAtPoint = (this.lastPointerX > 0 || this.lastPointerY > 0)
			? document.elementFromPoint(this.lastPointerX, this.lastPointerY)
			: null;

		// Check if active element or modal container should be inspected
		const activeModalContainer = document.querySelector(".svg-lightbox-content, .a1-svg-modal-body") as HTMLElement | null;
		if (!elAtPoint && activeModalContainer) {
			elAtPoint = activeModalContainer;
		}

		// 1. Check hovered or element under pointer for card text
		let textToEdit: SVGTextElement | null = asText(this.hovered as any);
		if (!textToEdit && elAtPoint) {
			textToEdit = findTextInCard(elAtPoint, this.lastPointerX, this.lastPointerY);
		}
		if (!textToEdit && this.hoveredSvgTarget) {
			textToEdit = findTextInCard(this.hoveredSvgTarget, this.lastPointerX, this.lastPointerY);
		}
		if (!textToEdit && activeModalContainer) {
			textToEdit = findTextInCard(activeModalContainer, this.lastPointerX, this.lastPointerY);
		}

		if (textToEdit && this.isInteractiveSvg(textToEdit)) {
			this.setHover(textToEdit);
			await this.beginEdit(textToEdit);
			return;
		}

		// 2. Fallback to SVG target (embed, image, modal)
		const svgTarget = this.hoveredSvgTarget
			?? (elAtPoint ? this.matchSvgElement(elAtPoint) : null)
			?? this.findSvgTargetAtPoint(this.lastPointerX, this.lastPointerY)
			?? activeModalContainer;

		if (svgTarget) {
			const isModal = !!svgTarget.closest(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body") ||
				(svgTarget.matches && svgTarget.matches(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body"));
			if (isModal) {
				const svgEl = svgTarget instanceof SVGSVGElement ? svgTarget : (svgTarget.closest("svg") ?? svgTarget.querySelector("svg"));
				const fallbackText = svgEl ? findTextInCard(svgEl, this.lastPointerX, this.lastPointerY) : null;
				if (fallbackText) {
					this.setHover(fallbackText);
					await this.beginEdit(fallbackText);
					return;
				}
			} else {
				await this.openSvgEditorModal(svgTarget);
				return;
			}
		}

		// 3. Fallback: check active Markdown editor's cursor line for SVG links
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.editor) {
			const cursor = view.editor.getCursor();
			for (let offset = 0; offset <= 2; offset++) {
				for (const sign of [0, -1, 1]) {
					if (offset === 0 && sign !== 0) continue;
					const lineNum = cursor.line + sign * offset;
					if (lineNum < 0 || lineNum >= view.editor.lineCount()) continue;
					const lineText = view.editor.getLine(lineNum);
					const wikiMatch = lineText.match(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
					const mdMatch = lineText.match(/!\[[^\]]*\]\(([^)]+)\)/);
					const candidate = wikiMatch?.[1] || mdMatch?.[1];
					if (candidate && candidate.toLowerCase().includes(".svg")) {
						await this.openSvgEditorByPathOrLink(candidate.trim());
						return;
					}
				}
			}
		}

		new Notice(getLocaleStrings().noticeHoverTextPrompt);
	}

	private onPointerMove(evt: PointerEvent): void {
		this.lastPointerX = evt.clientX;
		this.lastPointerY = evt.clientY;

		if (this.dragging) {
			const dx = evt.clientX - this.dragging.lastX;
			const dy = evt.clientY - this.dragging.lastY;
			if (dx !== 0 || dy !== 0) {
				if (!this.dragging.moved && this.dragging.mode === "move") {
					this.history.recordSnapshot(this.dragging.svg);
				}
				this.dragging.moved = true;
				this.dragging.lastX = evt.clientX;
				this.dragging.lastY = evt.clientY;

				// 1. Remove previous frame snap offset to restore true pointer-following position
				if (this.dragging.snapOffsetUserX !== 0 || this.dragging.snapOffsetUserY !== 0) {
					nudge(this.dragging.card, -this.dragging.snapOffsetUserX, -this.dragging.snapOffsetUserY);
					this.dragging.snapOffsetUserX = 0;
					this.dragging.snapOffsetUserY = 0;
				}

				// 2. Translate card by mouse delta
				this.translate(this.dragging.card, this.dragging.svg, dx, dy);

				// 3. Compute and apply magnetic snap if autoAlign is active
				if (this.autoAlign) {
					const snap = this.applySnap(this.dragging.card, this.dragging.svg);
					this.dragging.snapOffsetUserX = snap.dx;
					this.dragging.snapOffsetUserY = snap.dy;
				} else {
					this.clearAlignGuides(this.dragging.svg);
				}
			}
			return;
		}
		if (this.overlay) return;

		const text = this.textFromEvent(evt);
		this.setHover(text);

		const svgTarget = this.svgTargetFromEvent(evt);
		this.setHoveredSvgTarget(svgTarget);
	}

	private onPointerDown(evt: PointerEvent): void {
		if ((!evt.altKey && !evt.shiftKey) || evt.button !== 0) return;
		const target = evt.target instanceof Element ? evt.target : null;
		if (!target) return;

		let dragTarget = resolveCloneTarget(target, evt.clientX, evt.clientY);
		if (!dragTarget) {
			const text = this.textFromEvent(evt);
			if (text) {
				dragTarget = resolveCloneTarget(text, evt.clientX, evt.clientY);
			}
		}
		if (!dragTarget) return;

		const isSvg = (typeof SVGSVGElement !== "undefined" && dragTarget instanceof SVGSVGElement) || (dragTarget.localName || dragTarget.tagName.toLowerCase()).endsWith("svg");
		const svg = (isSvg ? dragTarget : (dragTarget.ownerSVGElement ?? dragTarget.closest("svg"))) as SVGSVGElement | null;
		if (!svg || !this.isInteractiveSvg(svg)) return;

		evt.preventDefault();
		evt.stopPropagation();
		evt.stopImmediatePropagation();

		if (evt.shiftKey && !evt.altKey) {
			// Mode: Move UI box (Shift+drag)
			document.body.style.cursor = "grabbing";
			this.dragging = {
				card: dragTarget,
				svg,
				pointerId: evt.pointerId,
				lastX: evt.clientX,
				lastY: evt.clientY,
				moved: false,
				mode: "move",
				snapOffsetUserX: 0,
				snapOffsetUserY: 0,
			};
		} else {
			// Mode: Duplicate UI box (Alt+drag)
			this.history.recordSnapshot(svg);
			const clone = cloneCard(dragTarget, 12, 12);
			insertCloneSibling(dragTarget, clone);
			document.body.style.cursor = "copy";
			this.dragging = {
				card: clone,
				svg,
				pointerId: evt.pointerId,
				lastX: evt.clientX,
				lastY: evt.clientY,
				moved: true,
				mode: "clone",
				snapOffsetUserX: 0,
				snapOffsetUserY: 0,
			};
		}
	}

	private onPointerUp(evt: PointerEvent): void {
		if (!this.dragging || evt.pointerId !== this.dragging.pointerId) return;
		const svg = this.dragging.svg;
		const moved = this.dragging.moved;
		this.clearAlignGuides(svg);
		this.dragging = null;
		document.body.style.cursor = "";

		if (!moved) return;

		const inModal = !!svg.closest(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body");
		if (!inModal) {
			void this.persistSvg(svg);
		}
	}

	private textFromEvent(evt: Event): SVGTextElement | null {
		const clientX = (evt as MouseEvent).clientX;
		const clientY = (evt as MouseEvent).clientY;
		const path = typeof evt.composedPath === "function" ? evt.composedPath() : [];
		for (const node of path) {
			if (node instanceof Element) {
				const found = asText(node);
				if (found && this.isInteractiveSvg(found)) return found;
			}
		}
		const t = evt.target;
		if (t instanceof Element) {
			const found = asText(t);
			if (found && this.isInteractiveSvg(found)) return found;
			const cardText = findTextInCard(t, clientX, clientY);
			if (cardText && this.isInteractiveSvg(cardText)) return cardText;
		}
		return null;
	}

	private isInteractiveSvg(el: Element): boolean {
		const isSvg = (typeof SVGSVGElement !== "undefined" && el instanceof SVGSVGElement) || (el.localName || el.tagName.toLowerCase()).endsWith("svg");
		const svg = isSvg ? el : ((el as SVGElement).ownerSVGElement ?? el.closest("svg") ?? el.querySelector("svg"));
		if (!svg) return false;
		return !!svg.closest(
			".markdown-preview-view, .markdown-rendered, .view-content, .cm-content, .markdown-source-view, div[class*='block-language'], .internal-embed, .image-embed, .media-embed, .a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body"
		);
	}

	private svgTargetFromEvent(evt: Event): Element | null {
		const path = typeof evt.composedPath === "function" ? evt.composedPath() : [];
		for (const node of path) {
			if (node instanceof Element) {
				const match = this.matchSvgElement(node);
				if (match) return match;
			}
		}
		if (evt.target instanceof Element) {
			return this.matchSvgElement(evt.target);
		}
		return null;
	}

	private findSvgTargetAtPoint(x: number, y: number): Element | null {
		const el = (x > 0 || y > 0) ? document.elementFromPoint(x, y) : null;
		if (!el) return null;
		return this.matchSvgElement(el);
	}

	private matchSvgElement(el: Element): Element | null {
		// 1. If inside or containing an image/media embed, prioritize the embed container
		const embed = el.closest(".internal-embed, .image-embed, .media-embed, div[class*='block-language']")
			?? el.querySelector(".internal-embed, .image-embed, .media-embed, div[class*='block-language']");
		if (embed) {
			const src = (embed.getAttribute("src") || "").toLowerCase();
			const img = embed.querySelector("img");
			const imgSrc = (img?.getAttribute("src") || "").toLowerCase();
			if (src.includes(".svg") || imgSrc.includes(".svg") || embed.querySelector("img[src*='.svg' i]")) {
				return embed;
			}
		}

		// 2. <img src="...svg">
		if (el instanceof HTMLImageElement) {
			const src = (el.getAttribute("src") || "").toLowerCase();
			if (src.includes(".svg")) return el;
		}
		const childImg = el.querySelector("img[src*='.svg' i]");
		if (childImg) return childImg;

		// 3. Modal / Lightbox containers
		const modalContainer = el.closest(".svg-lightbox-content, .svg-lightbox-body, .a1-svg-modal-body");
		if (modalContainer) return modalContainer;

		// 4. Live diagram <svg> (strictly excluding toolbar/zoom/icon SVGs)
		if (el instanceof SVGSVGElement && isDiagramSvg(el) && this.isInteractiveSvg(el)) return el;
		const parentSvg = el.closest("svg");
		if (parentSvg && isDiagramSvg(parentSvg) && this.isInteractiveSvg(parentSvg)) return parentSvg;
		const childSvg = el.querySelector("svg");
		if (childSvg && isDiagramSvg(childSvg) && this.isInteractiveSvg(childSvg)) return childSvg;

		return null;
	}

	private setHover(text: Element | null): void {
		if (this.hovered === text) return;
		this.clearHover();
		this.hovered = text;
		text?.classList.add("a1-svg-hover-text");
	}

	public clearHover(): void {
		if (this.hovered) {
			this.hovered.classList.remove("a1-svg-hover-text");
			if (this.hovered.classList.length === 0) {
				this.hovered.removeAttribute("class");
			}
		}
		this.hovered = null;
	}

	private setHoveredSvgTarget(target: Element | null): void {
		if (this.hoveredSvgTarget === target) return;
		this.clearHoveredSvgTarget();
		this.hoveredSvgTarget = target;
		// Add subtle hover ring to image embeds
		if (target && !(target instanceof SVGElement)) {
			target.classList.add("a1-svg-hover-image");
		}
	}

	private clearHoveredSvgTarget(): void {
		if (this.hoveredSvgTarget && !(this.hoveredSvgTarget instanceof SVGElement)) {
			this.hoveredSvgTarget.classList.remove("a1-svg-hover-image");
			if (this.hoveredSvgTarget.classList.length === 0) {
				this.hoveredSvgTarget.removeAttribute("class");
			}
		}
		this.hoveredSvgTarget = null;
	}

	private async beginEdit(textEl: Element): Promise<void> {
		const hit = resolveHit(textEl);
		const svg = (textEl as SVGElement).ownerSVGElement ?? (textEl.closest("svg") as SVGSVGElement | null);
		if (!hit || !svg) return;
		this.overlay?.close();

		// Capture clean baseline BEFORE any live-preview or background adaptation mutates the SVG
		this.history.setActiveSvg(svg);
		const preEditSnapshot = cleanSvgHtml(svg.innerHTML);

		// Immediately adapt background if text already overflows
		adaptBackgroundToText(hit.textEl);

		const rect = textEl.getBoundingClientRect();
		const cs = getComputedStyle(textEl);
		const initialVal = readText(hit.textEl);
		const theme = resolveEffectiveEditorColors(hit.textEl as SVGTextElement);

		this.overlay = openTextOverlay(document.body, {
			rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
			value: initialVal,
			fontSize: cs.fontSize,
			fontFamily: cs.fontFamily,
			color: theme.color,
			background: theme.background,
			borderColor: theme.border,
			boxShadow: theme.boxShadow,
			caretColor: theme.caretColor,
			onInput: (value) => {
				if (!value || value.trim().length === 0) return;
				writeText(hit.textEl, value);
				adaptBackgroundToText(hit.textEl, value);
			},
			onCommit: (value) => {
				this.overlay = null;
				const normNew = value.replace(/\u00a0/g, " ").trim();
				const normInit = initialVal.replace(/\u00a0/g, " ").trim();
				if (normNew === normInit) {
					if (cleanSvgHtml(svg.innerHTML) !== preEditSnapshot) {
						replaceSvgChildrenFromMarkup(svg, preEditSnapshot);
					}
				} else {
					this.history.recordExplicitSnapshot(svg, preEditSnapshot);
					commitText(hit, value);
					const inModal = !!svg.closest(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body");
					if (!inModal) {
						void this.persistSvg(svg);
					}
				}
				const focusTarget = (svg.closest(".a1-svg-modal-dialog, .svg-lightbox-modal")
					?? document.querySelector(".a1-svg-modal-dialog, .svg-lightbox-modal")) as HTMLElement | null;
				if (focusTarget) {
					focusTarget.focus();
				}
			},
			onCancel: () => {
				this.overlay = null;
				if (cleanSvgHtml(svg.innerHTML) !== preEditSnapshot) {
					replaceSvgChildrenFromMarkup(svg, preEditSnapshot);
				} else {
					writeText(hit.textEl, initialVal);
					adaptBackgroundToText(hit.textEl, initialVal);
				}
				const focusTarget = (svg.closest(".a1-svg-modal-dialog, .svg-lightbox-modal")
					?? document.querySelector(".a1-svg-modal-dialog, .svg-lightbox-modal")) as HTMLElement | null;
				if (focusTarget) {
					focusTarget.focus();
				}
			},
			onSave: () => {
				void this.saveCurrentSvg(svg, true);
			},
		});
	}

	private translate(card: Element, svg: SVGSVGElement, dx: number, dy: number): void {
		const ctm = svg.getScreenCTM();
		if (!ctm) return;
		const inv = ctm.inverse();
		nudge(card, inv.a * dx + inv.c * dy, inv.b * dx + inv.d * dy);
	}

	private applySnap(card: Element, svg: SVGSVGElement): { dx: number; dy: number } {
		const ctm = svg.getScreenCTM();
		const pxPerUser = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
		const pxPerMm = pxPerUser > 0 ? (96 / 25.4) / pxPerUser : 3.78;
		const snap = snapDelta(card, svg, { pxPerMm });
		if (snap.dx !== 0 || snap.dy !== 0) nudge(card, snap.dx, snap.dy);
		this.paintAlignGuides(svg, snap.guides);
		return { dx: snap.dx, dy: snap.dy };
	}

	private paintAlignGuides(svg: SVGSVGElement, guides: AlignGuide[]): void {
		this.clearAlignGuides(svg);
		if (guides.length === 0) return;
		const doc = svg.ownerDocument;
		const layer = doc.createElementNS("http://www.w3.org/2000/svg", "g");
		layer.setAttribute("data-a1-align", "1");
		layer.setAttribute("pointer-events", "none");
		const vb = (svg.getAttribute("viewBox") || svg.getAttribute("viewbox") || "").trim().split(/[\s,]+/);
		const span = vb.length === 4
			? { x: parseFloat(vb[0]), y: parseFloat(vb[1]), w: parseFloat(vb[2]), h: parseFloat(vb[3]) }
			: { x: 0, y: 0, w: parseFloat(svg.getAttribute("width") || "1000"), h: parseFloat(svg.getAttribute("height") || "1000") };
		for (const g of guides) {
			const line = doc.createElementNS("http://www.w3.org/2000/svg", "line");
			line.setAttribute("class", "a1-svg-align-guide");
			if (g.axis === "x") {
				line.setAttribute("x1", String(g.value));
				line.setAttribute("x2", String(g.value));
				line.setAttribute("y1", String(span.y));
				line.setAttribute("y2", String(span.y + span.h));
			} else {
				line.setAttribute("y1", String(g.value));
				line.setAttribute("y2", String(g.value));
				line.setAttribute("x1", String(span.x));
				line.setAttribute("x2", String(span.x + span.w));
			}
			layer.appendChild(line);
		}
		svg.appendChild(layer);
	}

	private clearAlignGuides(svg: Element): void {
		svg.querySelector("[data-a1-align]")?.remove();
	}

	/**
	 * Persists SVG changes.
	 * If the SVG was loaded from a standalone .svg vault file (marked with data-a1-svg-path),
	 * writes directly to that file and refreshes note images.
	 * Otherwise splices into the active Markdown note.
	 */
	public async persistSvg(svg: SVGSVGElement): Promise<boolean> {
		this.commitActiveOverlay();
		this.clearHover();

		const containerWithPath = svg.closest(`[${SVG_PATH_ATTR}]`);
		const rawPath =
			svg.getAttribute(SVG_PATH_ATTR) ||
			containerWithPath?.getAttribute(SVG_PATH_ATTR) ||
			(svg === this.currentModalSvg ? this.currentModalPath : null) ||
			"";
		const svgPath = sanitizeSvgLinkPath(rawPath);

		if (svgPath) {
			svg.setAttribute(SVG_PATH_ATTR, svgPath);
			const live = serializeSvg(svg);
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const sourcePath = activeView?.file?.path || this.app.workspace.getActiveFile()?.path || "";

			this.lastSelfSave = { path: svgPath, timestamp: Date.now(), content: live };
			const { ok, resolvedPath } = await writeVaultSvgFile(this.app, svgPath, live, sourcePath);
			if (!ok) {
				return false;
			}

			const finalPath = resolvedPath || svgPath;
			this.lastSelfSave = { path: finalPath, timestamp: Date.now(), content: live };
			svg.setAttribute(SVG_PATH_ATTR, finalPath);
			if (containerWithPath) {
				containerWithPath.setAttribute(SVG_PATH_ATTR, finalPath);
			}
			if (svg === this.currentModalSvg) {
				this.currentModalPath = finalPath;
			}

			// Refresh <img> embeds referencing this SVG in the DOM
			this.refreshImgEmbeds(finalPath);
			// Dispatch event for other plugins (fluent-tasks, etc.) with source: "self-save"
			window.dispatchEvent(
				new CustomEvent("a1-svg-updated", {
					detail: { path: finalPath, content: live, source: "self-save" },
				})
			);
			const name = finalPath.split("/").pop() || "SVG";
			this.showSaveToast(getLocaleStrings().noticeSaved(name));
			return true;
		}

		// Splicing inline SVG in active Markdown file
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file ?? this.app.workspace.getActiveFile();
		if (!file) return false;
		const marker = this.markerFor(svg);
		const live = serializeSvg(svg);
		let didSplice = false;
		await this.app.vault.process(file, (data) => {
			const span = matchSpan(data, this.domIndex(svg), marker);
			if (!span) return data;
			didSplice = true;
			const stamped = ensureMarker(live, marker);
			return spliceSvg(data, span, stamped);
		});
		if (!didSplice) {
			return false;
		}
		const isZh = isChineseLocale();
		this.showSaveToast(isZh ? "SVG 已保存到笔记" : "SVG saved to note");
		return true;
	}

	public refreshImgEmbeds(filePath: string): void {
		const filename = filePath.split("/").pop() || "";
		if (!filename) return;
		const filenameLower = filename.toLowerCase();
		const encoded = encodeURIComponent(filename).toLowerCase();
		const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
		for (const img of imgs) {
			const src = (img.getAttribute("src") || "").toLowerCase();
			const alt = (img.getAttribute("alt") || "").toLowerCase();
			const dataSrc = (img.getAttribute("data-src") || "").toLowerCase();
			if (
				(src.includes(".svg") && (src.includes(filenameLower) || src.includes(encoded))) ||
				alt === filenameLower ||
				dataSrc.includes(filenameLower)
			) {
				const rawSrc = img.getAttribute("src") || "";
				const clean = rawSrc.split("?")[0];
				img.setAttribute("src", `${clean}?t=${Date.now()}`);
			}
		}
		const embeds = Array.from(document.querySelectorAll<HTMLElement>(".internal-embed, .image-embed, .media-embed"));
		for (const emb of embeds) {
			const embSrc = (emb.getAttribute("src") || "").toLowerCase();
			if (embSrc.includes(filenameLower)) {
				const innerImg = emb.querySelector("img");
				if (innerImg) {
					const clean = innerImg.src.split("?")[0];
					innerImg.setAttribute("src", `${clean}?t=${Date.now()}`);
				}
			}
		}
	}

	public refreshAllVisibleSvgEmbeds(): void {
		const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
		for (const img of imgs) {
			const src = img.getAttribute("src") || "";
			if (src.toLowerCase().includes(".svg")) {
				const clean = src.split("?")[0];
				img.setAttribute("src", `${clean}?t=${Date.now()}`);
			}
		}
	}

	public hotReloadModal(freshSvgContent: string): void {
		if (!this.activeModal || !this.currentModalBody) return;
		const processed = prepareSvgMarkup(freshSvgContent, this.currentModalPath || undefined);

		try {
			const parsed = new DOMParser().parseFromString(processed, "image/svg+xml");
			const rootSvg = parsed.documentElement;
			if (rootSvg && rootSvg.tagName.toLowerCase() !== "parsererror" && !rootSvg.querySelector("parsererror")) {
				const adopted = document.adoptNode ? document.adoptNode(rootSvg) : rootSvg;
				while (this.currentModalBody.firstChild) {
					this.currentModalBody.firstChild.remove();
				}
				this.currentModalBody.appendChild(adopted);
				const newModalSvg = this.currentModalBody.querySelector("svg") as SVGSVGElement | null;
				if (newModalSvg) {
					if (this.currentModalPath) {
						newModalSvg.setAttribute(SVG_PATH_ATTR, this.currentModalPath);
					}
					this.currentModalSvg = newModalSvg;
					this.history.setActiveSvg(newModalSvg);
				}
				window.dispatchEvent(new CustomEvent("a1-svg-updated", {
					detail: { path: this.currentModalPath, content: processed, source: "hot-reload" }
				}));
				const name = this.currentModalPath ? (this.currentModalPath.split("/").pop() || "SVG") : "SVG";
				new Notice(getLocaleStrings().noticeSvgUpdated(name));
			}
		} catch (err) {
			console.error("Failed to hot reload modal SVG:", err);
		}
	}

	public async checkAndRefreshActiveSvg(): Promise<void> {
		if (this.currentModalPath && this.currentModalSvg && this.activeModal) {
			if (!this.history.isDirty(this.currentModalSvg) && !this.isRecentSelfSave(this.currentModalPath)) {
				try {
					const { content: diskContent } = await readVaultSvgFile(this.app, this.currentModalPath);
					if (diskContent && !this.isRecentSelfSave(this.currentModalPath, diskContent)) {
						const currentLive = serializeSvg(this.currentModalSvg);
						const normDisk = diskContent.replace(/\s+/g, " ").trim();
						const normLive = currentLive.replace(/\s+/g, " ").trim();
						if (normDisk !== normLive && !normDisk.includes(normLive.slice(0, 50))) {
							this.hotReloadModal(diskContent);
						}
					}
				} catch (e) {
					console.error("Failed to check active SVG for updates:", e);
				}
			}
		}

		this.refreshAllVisibleSvgEmbeds();
	}

	private markerFor(svg: SVGSVGElement): string {
		const existing = svg.getAttribute(MARK);
		if (existing) return existing;
		const marker = `s${this.domIndex(svg)}-${fileStamp(this.app.workspace.getActiveFile())}`;
		svg.setAttribute(MARK, marker);
		return marker;
	}

	private domIndex(svg: SVGSVGElement): number {
		const root = svg.closest(".markdown-preview-view, .markdown-rendered") ?? document.body;
		const all = Array.from(root.querySelectorAll("svg"));
		const idx = all.indexOf(svg);
		return idx < 0 ? 0 : idx;
	}

	/**
	 * Opens the full interactive SVG Image Editor Modal for a hovered note SVG image or element.
	 */
	public async openSvgEditorModal(target: Element): Promise<void> {
		this.activeModal?.remove();
		this.activeModal = null;
		const i18n = getLocaleStrings();

		let file: TFile | null = null;
		let relPath = "";
		let rawSvgContent = "";
		let title = i18n.modalTitleDefault;

		// 0. Resolve the true container/embed if target was an inner element or overlay
		const embed = target.closest(".internal-embed, .image-embed, .media-embed, div[class*='block-language']")
			?? target.querySelector(".internal-embed, .image-embed, .media-embed, div[class*='block-language']")
			?? target;
		const img = (target instanceof HTMLImageElement ? target : embed?.querySelector("img")) as HTMLImageElement | null;
		const rawSrc = img?.getAttribute("src") || (target instanceof HTMLImageElement ? target.src : "") || "";

		// 1. If target is or is inside an image embed or img tag: prioritize resolving from image source / vault file!
		if (img || embed.classList?.contains("internal-embed") || embed.classList?.contains("image-embed") || rawSrc.includes(".svg")) {
			let filenameFromSrc = "";
			let directRelPath = "";
			if (rawSrc) {
				try {
					let decoded = decodeURIComponent(rawSrc.split("?")[0]);
					decoded = decoded.replace(/\\/g, "/");
					decoded = decoded.replace(/^[a-z]+:\/\/[^/]*\//i, "");
					decoded = decoded.replace(/^\/+/, "");
					const vaultBasePath = ((this.app.vault.adapter as unknown as { basePath?: string }).basePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
					if (vaultBasePath && decoded.toLowerCase().startsWith(vaultBasePath.toLowerCase())) {
						directRelPath = decoded.slice(vaultBasePath.length).replace(/^\/+/, "");
					}
					filenameFromSrc = decoded.split("/").pop() || "";
				} catch {}
			}

			const rawCandidates = [
				directRelPath,
				embed?.getAttribute("src") || "",
				embed?.getAttribute("data-src") || "",
				img?.getAttribute("alt") || "",
				img?.getAttribute("data-src") || "",
				filenameFromSrc
			].filter((c) => !!c && !!c.trim());

			if (directRelPath && directRelPath.includes("/")) {
				const parts = directRelPath.split("/");
				for (let i = 1; i < parts.length; i++) {
					rawCandidates.push(parts.slice(i).join("/"));
				}
			}

			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const sourcePath = activeView?.file?.path || this.app.workspace.getActiveFile()?.path || "";

			for (const rawCand of rawCandidates) {
				const clean = sanitizeSvgLinkPath(rawCand);
				if (!clean) continue;

				const readRes = await readVaultSvgFile(this.app, clean, sourcePath);
				if (readRes.content) {
					rawSvgContent = readRes.content;
					relPath = readRes.path;
					file = readRes.file;
					const displayName = file?.name || relPath.split("/").pop() || "SVG";
					title = i18n.modalTitleNamed(displayName);
					break;
				}
			}
		}

		// 2. If not resolved from embed/img, check for live diagram <svg> element in modal/page (strictly excluding icon/zoom SVGs)
		if (!rawSvgContent && !img && !embed.classList?.contains("internal-embed") && !embed.classList?.contains("image-embed")) {
			const candidateSvg = target instanceof SVGSVGElement
				? target
				: (target.closest("svg") ?? target.querySelector("svg"));
			if (candidateSvg && isDiagramSvg(candidateSvg)) {
				const svgPath = candidateSvg.getAttribute(SVG_PATH_ATTR) || candidateSvg.closest(`[${SVG_PATH_ATTR}]`)?.getAttribute(SVG_PATH_ATTR) || "";
				if (svgPath) {
					const readRes = await readVaultSvgFile(this.app, svgPath);
					if (readRes.content) {
						rawSvgContent = readRes.content;
						relPath = readRes.path;
						file = readRes.file;
					} else {
						relPath = sanitizeSvgLinkPath(svgPath);
					}
				}
				if (!rawSvgContent) {
					rawSvgContent = serializeSvg(candidateSvg);
				}
				if (file || relPath) title = i18n.modalTitleNamed(file?.name || relPath.split("/").pop() || "SVG");
			}
		}

		if (!rawSvgContent) {
			new Notice(i18n.noticeCannotParse);
			return;
		}

		this.renderModalWithContent(rawSvgContent, relPath || file?.path || "", title);
	}

	public async openSvgEditorByPathOrLink(linkPath: string): Promise<void> {
		const clean = sanitizeSvgLinkPath(linkPath);
		if (!clean) return;
		const i18n = getLocaleStrings();
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sourcePath = activeView?.file?.path || this.app.workspace.getActiveFile()?.path || "";

		const { content: rawSvgContent, path: relPath, file } = await readVaultSvgFile(this.app, clean, sourcePath);
		if (!rawSvgContent) {
			new Notice(i18n.noticeCannotParse);
			return;
		}

		const name = file ? file.name : (relPath.split("/").pop() || "SVG");
		this.renderModalWithContent(rawSvgContent, relPath, i18n.modalTitleNamed(name));
	}

	private renderModalWithContent(rawSvgContent: string, relPath: string, title: string): void {
		const i18n = getLocaleStrings();
		const cleanRelPath = sanitizeSvgLinkPath(relPath);
		const preparedMarkup = prepareSvgMarkup(rawSvgContent, cleanRelPath || undefined);

		// Create Modal DOM
		const backdrop = document.createElement("div");
		backdrop.className = "a1-svg-modal-backdrop";

		const dialog = document.createElement("div");
		dialog.className = "a1-svg-modal-dialog";
		dialog.setAttribute("tabindex", "-1");

		const header = document.createElement("div");
		header.className = "a1-svg-modal-header";

		const titleRow = document.createElement("div");
		titleRow.className = "a1-svg-modal-title-row";

		const titleDiv = document.createElement("div");
		titleDiv.className = "a1-svg-modal-title";
		try {
			const svgIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			svgIcon.setAttribute("width", "16");
			svgIcon.setAttribute("height", "16");
			svgIcon.setAttribute("viewBox", "0 0 24 24");
			svgIcon.setAttribute("fill", "none");
			svgIcon.setAttribute("stroke", "var(--interactive-accent, #7c9cff)");
			svgIcon.setAttribute("stroke-width", "2");
			svgIcon.setAttribute("stroke-linecap", "round");
			svgIcon.setAttribute("stroke-linejoin", "round");
			const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
			rect.setAttribute("x", "3");
			rect.setAttribute("y", "3");
			rect.setAttribute("width", "18");
			rect.setAttribute("height", "18");
			rect.setAttribute("rx", "2");
			rect.setAttribute("ry", "2");
			const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			circle.setAttribute("cx", "8.5");
			circle.setAttribute("cy", "8.5");
			circle.setAttribute("r", "1.5");
			const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
			polyline.setAttribute("points", "21 15 16 10 5 21");
			svgIcon.appendChild(rect);
			svgIcon.appendChild(circle);
			svgIcon.appendChild(polyline);
			titleDiv.appendChild(svgIcon);
		} catch {}

		const titleSpan = document.createElement("span");
		titleSpan.textContent = title;
		titleDiv.appendChild(titleSpan);
		const isZh = (getLocaleStrings().noticeUndo === "已撤销");
		const helpWrap = document.createElement("div");
		helpWrap.className = "svg-help-wrap";

		const helpIcon = document.createElement("div");
		helpIcon.className = "svg-help-icon";
		helpIcon.textContent = "?";
		helpIcon.title = isZh ? "操作说明 (悬浮查看)" : "Help & Shortcuts (Hover to view)";

		const helpPopover = document.createElement("div");
		helpPopover.className = "svg-help-popover";

		const smartLayoutKey = this.settings.smartLayoutHotkey || "Ctrl+Shift+S";
		const shortcuts = isZh ? [
			{ key: "Ctrl+S", desc: "即时保存 (保留撤销记录)" },
			{ key: smartLayoutKey, desc: "自动居中并均匀分布卡片间隙" },
			{ key: "Ctrl+滚轮", desc: "缩放UI框大小 (增大/减小)" },
			{ key: "Delete", desc: "悬浮UI框按键直接删除" },
			{ key: "清空文本", desc: "清空文字自动删除UI框" },
			{ key: "Shift+拖拽", desc: "移动UI框" },
			{ key: "Alt+拖拽", desc: "复制克隆UI框" },
			{ key: "Ctrl+Z / Y", desc: "撤销与重做" },
			{ key: "双击 / F2", desc: "快速编辑文字" },
		] : [
			{ key: "Ctrl+S", desc: "Save in-place (keeps history)" },
			{ key: smartLayoutKey, desc: "Auto-center and balance cards & gaps" },
			{ key: "Ctrl+Scroll", desc: "Scale UI box size (enlarge/shrink)" },
			{ key: "Delete", desc: "Hover and press Delete to remove box" },
			{ key: "Clear Text", desc: "Auto-deletes box when text is empty" },
			{ key: "Shift+Drag", desc: "Move UI box" },
			{ key: "Alt+Drag", desc: "Duplicate / clone UI box" },
			{ key: "Ctrl+Z / Y", desc: "Undo & Redo" },
			{ key: "Dblclick / F2", desc: "Quick edit text" },
		];

		for (const item of shortcuts) {
			const row = document.createElement("div");
			row.className = "svg-help-row";

			const kbd = document.createElement("kbd");
			kbd.textContent = item.key;

			const desc = document.createElement("span");
			desc.className = "svg-help-desc";
			desc.textContent = item.desc;

			row.appendChild(kbd);
			row.appendChild(desc);
			helpPopover.appendChild(row);
		}

		helpWrap.appendChild(helpIcon);
		helpWrap.appendChild(helpPopover);

		titleRow.appendChild(titleDiv);
		titleRow.appendChild(helpWrap);

		const actionGroup = document.createElement("div");
		actionGroup.className = "a1-svg-modal-actions";

		const alignBtn = document.createElement("button");
		alignBtn.type = "button";
		alignBtn.className = "a1-svg-modal-tab-btn is-on";
		alignBtn.textContent = i18n.btnAutoAlign;
		alignBtn.title = i18n.btnAutoAlignTip;
		alignBtn.setAttribute("aria-pressed", "true");
		alignBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.autoAlign = !this.autoAlign;
			alignBtn.classList.toggle("is-on", this.autoAlign);
			alignBtn.setAttribute("aria-pressed", this.autoAlign ? "true" : "false");
			if (!this.autoAlign && modalSvg) this.clearAlignGuides(modalSvg);
		});
		actionGroup.appendChild(alignBtn);

		const smartLayoutBtn = document.createElement("button");
		smartLayoutBtn.type = "button";
		smartLayoutBtn.className = "a1-svg-modal-tab-btn";
		smartLayoutBtn.textContent = i18n.btnSmartLayout;
		smartLayoutBtn.title = i18n.btnSmartLayoutTip;
		smartLayoutBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.smartLayout(modalSvg);
		});
		actionGroup.appendChild(smartLayoutBtn);

		if (relPath) {
			const openInTabBtn = document.createElement("button");
			openInTabBtn.type = "button";
			openInTabBtn.className = "a1-svg-modal-tab-btn";
			openInTabBtn.textContent = i18n.openInTab;
			openInTabBtn.title = "Open note/file in Obsidian";
			openInTabBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				void this.app.workspace.openLinkText(relPath, "", false);
			});
			actionGroup.appendChild(openInTabBtn);
		}

		const deleteBtn = document.createElement("button");
		deleteBtn.type = "button";
		deleteBtn.className = "a1-svg-modal-tab-btn a1-svg-modal-delete-btn";
		deleteBtn.textContent = i18n.btnDeleteSvg;
		deleteBtn.title = i18n.btnDeleteSvgTip;
		deleteBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.promptDeleteActiveSvg();
		});
		actionGroup.appendChild(deleteBtn);

		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.className = "a1-svg-modal-close";
		closeBtn.textContent = "✕";
		closeBtn.title = i18n.closeTooltip;
		actionGroup.appendChild(closeBtn);

		header.appendChild(titleRow);
		header.appendChild(actionGroup);

		const body = document.createElement("div");
		body.className = "a1-svg-modal-body";
		if (cleanRelPath) {
			body.setAttribute(SVG_PATH_ATTR, cleanRelPath);
		}

		try {
			const parsed = new DOMParser().parseFromString(preparedMarkup, "image/svg+xml");
			const rootSvg = parsed.documentElement;
			if (rootSvg && rootSvg.tagName.toLowerCase() !== "parsererror" && !rootSvg.querySelector("parsererror")) {
				const adopted = document.adoptNode ? document.adoptNode(rootSvg) : rootSvg;
				body.appendChild(adopted);
			}
		} catch (err) {
			console.error("Failed to parse modal SVG via DOMParser:", err);
		}

		const modalSvg = body.querySelector("svg") as SVGSVGElement | null;
		if (modalSvg) {
			if (cleanRelPath) {
				modalSvg.setAttribute(SVG_PATH_ATTR, cleanRelPath);
			}
			this.history.setActiveSvg(modalSvg);
		}

		this.currentModalPath = cleanRelPath;
		this.currentModalTitle = title;
		this.currentModalBody = body;
		this.currentModalSvg = modalSvg;

		dialog.appendChild(header);
		dialog.appendChild(body);
		backdrop.appendChild(dialog);

		let isConfirming = false;
		const closeModal = () => {
			this.cancelActiveOverlay();
			this.clearHover();
			backdrop.remove();
			if (this.activeModal === backdrop) this.activeModal = null;
			this.currentModalPath = null;
			this.currentModalTitle = null;
			this.currentModalBody = null;
			this.currentModalSvg = null;
			window.removeEventListener("keydown", keyHandler, { capture: true });
		};

		const requestClose = () => {
			if (isConfirming) return;
			this.commitActiveOverlay();
			this.clearHover();
			if (modalSvg && this.history.isDirty(modalSvg)) {
				isConfirming = true;
				this.promptSaveConfirmation(
					async () => {
						isConfirming = false;
						const ok = await this.persistSvg(modalSvg);
						if (ok) {
							this.history.markSaved(modalSvg);
							closeModal();
						} else {
							new Notice(getLocaleStrings().noticeSaveFailed);
							dialog.focus();
						}
					},
					() => {
						isConfirming = false;
						this.history.discard(modalSvg);
						closeModal();
					},
					() => {
						isConfirming = false;
						dialog.focus();
					}
				);
				return;
			}
			closeModal();
		};

		closeBtn.addEventListener("click", requestClose);
		backdrop.addEventListener("click", (e) => {
			if (e.target === backdrop) requestClose();
		});
		backdrop.addEventListener("contextmenu", (e) => {
			if (this.overlay) return;
			if (e.target === backdrop || (e.target as HTMLElement).closest(".a1-svg-modal-dialog")) {
				e.preventDefault();
				requestClose();
			}
		});

		const keyHandler = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {
				e.preventDefault();
				e.stopPropagation();
				if (modalSvg) {
					void this.saveCurrentSvg(modalSvg, true);
				}
				return;
			}
			if (!this.overlay && !isConfirming && this.isSmartLayoutHotkey(e)) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				if (modalSvg) {
					this.smartLayout(modalSvg);
				}
				return;
			}
			if (!this.overlay && !isConfirming && this.isDeleteSvgHotkey(e)) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				this.promptDeleteActiveSvg();
				return;
			}
			if (e.key === "Escape" && !this.overlay && !isConfirming) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				requestClose();
			}
		};
		window.addEventListener("keydown", keyHandler, { capture: true });

		document.body.appendChild(backdrop);
		this.activeModal = backdrop;
		dialog.focus();
	}

	public promptSaveConfirmation(
		onSave: () => void | Promise<void>,
		onDiscard: () => void,
		onCancel: () => void
	): void {
		const i18n = getLocaleStrings();
		const overlay = document.createElement("div");
		overlay.className = "a1-svg-confirm-overlay";

		const card = document.createElement("div");
		card.className = "a1-svg-confirm-dialog";

		const title = document.createElement("div");
		title.className = "a1-svg-confirm-title";
		title.textContent = i18n.confirmSaveTitle;

		const desc = document.createElement("div");
		desc.className = "a1-svg-confirm-desc";
		desc.textContent = i18n.confirmSaveDesc;

		const btnRow = document.createElement("div");
		btnRow.className = "a1-svg-confirm-buttons";

		const saveBtn = document.createElement("button");
		saveBtn.className = "mod-cta";
		saveBtn.textContent = i18n.btnSave;

		const discardBtn = document.createElement("button");
		discardBtn.className = "mod-warning";
		discardBtn.textContent = i18n.btnDiscard;

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "";
		cancelBtn.textContent = i18n.btnCancel;

		btnRow.appendChild(saveBtn);
		btnRow.appendChild(discardBtn);
		btnRow.appendChild(cancelBtn);

		card.appendChild(title);
		card.appendChild(desc);
		card.appendChild(btnRow);
		overlay.appendChild(card);
		document.body.appendChild(overlay);

		const cleanup = () => {
			overlay.remove();
			window.removeEventListener("keydown", onKey, true);
		};

		const doSave = async () => {
			cleanup();
			await onSave();
		};

		const doDiscard = () => {
			cleanup();
			onDiscard();
		};

		const doCancel = () => {
			cleanup();
			onCancel();
		};

		saveBtn.addEventListener("click", () => void doSave());
		discardBtn.addEventListener("click", doDiscard);
		cancelBtn.addEventListener("click", doCancel);
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) doCancel();
		});

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				void doSave();
			} else if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				doCancel();
			}
		};
		window.addEventListener("keydown", onKey, true);
		saveBtn.focus();
	}

	public isFluentTasksInstalled(): boolean {
		return isFluentTasksInstalled(this.app);
	}

	public isTodoDataSvg(targetPath: string): boolean {
		return isTodoDataSvg(targetPath);
	}

	public async getLinkedTasksInfo(targetPath: string): Promise<{ count: number; titles: string[] }> {
		return getLinkedTasksInfo(this.app, targetPath);
	}

	public promptDeleteActiveSvg(): void {
		const targetPath = this.currentModalPath ||
			(document.querySelector(".svg-lightbox-content svg, .a1-svg-modal-body svg")?.getAttribute("data-a1-svg-path") || "");
		if (!targetPath && !this.currentModalSvg) {
			new Notice(getLocaleStrings().noticeHoverSvgPrompt);
			return;
		}

		void (async () => {
			let linkedInfo: { count: number; titles: string[] } | undefined = undefined;

			// ONLY detect tasks if fluent-tasks plugin is installed AND the SVG is in a TodoData related folder!
			if (this.isFluentTasksInstalled() && this.isTodoDataSvg(targetPath)) {
				linkedInfo = await this.getLinkedTasksInfo(targetPath);
			}

			this.showDeleteConfirmDialog(
				targetPath,
				async () => {
					await this.deleteActiveSvg(linkedInfo);
				},
				() => {
					const dialog = this.activeModal?.querySelector(".a1-svg-modal-dialog") as HTMLElement | null;
					dialog?.focus();
				},
				linkedInfo
			);
		})();
	}

	private showDeleteConfirmDialog(
		targetPath: string,
		onConfirm: () => Promise<void> | void,
		onCancel: () => void,
		linkedInfo?: { count: number; titles: string[] }
	): void {
		const overlay = document.createElement("div");
		overlay.className = "a1-svg-confirm-overlay";

		const card = document.createElement("div");
		card.className = "a1-svg-confirm-dialog";

		const title = document.createElement("div");
		title.className = "a1-svg-confirm-title";
		title.style.color = "var(--text-error, #f87171)";
		title.textContent = "Delete SVG?";

		const desc = document.createElement("div");
		desc.className = "a1-svg-confirm-desc";
		const name = targetPath.split("/").pop() || "SVG";
		const text1 = document.createElement("div");
		text1.textContent = "Are you sure you want to permanently delete this SVG file?";
		const codeEl = document.createElement("code");
		codeEl.style.fontSize = "11.5px";
		codeEl.style.opacity = "0.85";
		codeEl.style.wordBreak = "break-all";
		codeEl.textContent = targetPath || name;

		const text2 = document.createElement("div");
		text2.style.marginTop = "6px";
		const count = linkedInfo?.count ?? 0;
		if (count > 0) {
			const countStr = count === 1 ? "1 task" : `${count} tasks`;
			const preview = linkedInfo?.titles?.[0] ? ` ("${linkedInfo.titles[0].slice(0, 36)}${linkedInfo.titles[0].length > 36 ? '...' : ''}")` : "";
			text2.textContent = `This file is linked to ${countStr}${preview}. Deleting it will also remove the link from the task${count > 1 ? "s" : ""}.`;
			text2.style.color = "var(--text-warning, #f59e0b)";
		} else {
			text2.textContent = "This action cannot be undone.";
			text2.style.color = "var(--text-muted, #9ca3af)";
		}

		desc.appendChild(text1);
		desc.appendChild(codeEl);
		desc.appendChild(text2);

		const btnRow = document.createElement("div");
		btnRow.className = "a1-svg-confirm-buttons";

		const deleteBtn = document.createElement("button");
		deleteBtn.className = "mod-warning";
		deleteBtn.style.backgroundColor = "var(--text-error, #ef4444)";
		deleteBtn.style.borderColor = "var(--text-error, #dc2626)";
		deleteBtn.style.color = "#ffffff";
		deleteBtn.textContent = "Delete (Enter)";

		const cancelBtn = document.createElement("button");
		cancelBtn.className = "";
		cancelBtn.textContent = "Cancel (Esc)";

		btnRow.appendChild(deleteBtn);
		btnRow.appendChild(cancelBtn);

		card.appendChild(title);
		card.appendChild(desc);
		card.appendChild(btnRow);
		overlay.appendChild(card);
		document.body.appendChild(overlay);

		const cleanup = () => {
			overlay.remove();
			window.removeEventListener("keydown", onKey, true);
		};

		const doDelete = async () => {
			cleanup();
			await onConfirm();
		};

		const doCancel = () => {
			cleanup();
			onCancel();
		};

		deleteBtn.addEventListener("click", () => void doDelete());
		cancelBtn.addEventListener("click", doCancel);
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) doCancel();
		});

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				void doDelete();
			} else if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				doCancel();
			}
		};
		window.addEventListener("keydown", onKey, true);
		deleteBtn.focus();
	}

	public async deleteActiveSvg(linkedInfo?: { count: number; titles: string[] }): Promise<void> {
		const targetPath = this.currentModalPath ||
			(document.querySelector(".svg-lightbox-content svg, .a1-svg-modal-body svg")?.getAttribute("data-a1-svg-path") || "");
		const name = targetPath ? (targetPath.split("/").pop() || "SVG") : "SVG";

		// 1. Delete physical file from vault
		if (targetPath) {
			try {
				const file = resolveVaultSvgFile(this.app, targetPath);
				if (file) {
					await this.app.vault.trash(file, true);
				} else if (await this.app.vault.adapter.exists(targetPath)) {
					await this.app.vault.adapter.remove(targetPath);
				}
			} catch (err) {
				console.error("Failed to delete SVG file:", err);
			}

			// 2. Scan and remove references from fluent-tasks (ONLY if fluent-tasks is installed and it's a TodoData file)
			if (this.isFluentTasksInstalled() && this.isTodoDataSvg(targetPath)) {
				await this.cleanupFluentTasksSvgLinks(targetPath);
			}

			// 3. Clean up any broken embeds in notes so no "could not be found" is left
			await this.cleanupSvgEmbedsInNotes(targetPath);
		}

		// 4. Close the modal dialog cleanly
		if (this.activeModal) {
			this.activeModal.remove();
			this.activeModal = null;
			this.currentModalPath = null;
			this.currentModalTitle = null;
			this.currentModalBody = null;
			this.currentModalSvg = null;
		}

		// 5. Dispatch events to notify all components and views
		window.dispatchEvent(new CustomEvent("a1-svg-updated", {
			detail: { path: targetPath, deleted: true }
		}));
		window.dispatchEvent(new CustomEvent("fluent-tasks-svg-deleted", {
			detail: { path: targetPath }
		}));

		const count = linkedInfo?.count ?? 0;
		if (count > 0) {
			new Notice(getLocaleStrings().noticeDeleted(name));
		} else {
			new Notice(getLocaleStrings().noticeDeletedNoLink(name));
		}
	}

	public async cleanupSvgEmbedsInNotes(targetPath: string): Promise<void> {
		await cleanupSvgEmbedsInNotes(this.app, targetPath);
	}

	public async cleanupFluentTasksSvgLinks(targetPath: string): Promise<void> {
		await cleanupFluentTasksSvgLinks(this.app, targetPath);
	}
}

class A1SvgQuickEditorSettingTab extends PluginSettingTab {
	plugin: A1SvgQuickEditorPlugin;

	constructor(app: App, plugin: A1SvgQuickEditorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const i18n = getLocaleStrings();

		new Setting(containerEl)
			.setName(i18n.settingHotkeyName)
			.setDesc(i18n.settingHotkeyDesc)
			.addText((text) => {
				text.setValue(this.plugin.settings.openEditorHotkey);
				text.inputEl.addEventListener("keydown", (e) => {
					if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
					e.preventDefault();
					e.stopPropagation();
					const parts: string[] = [];
					if (e.ctrlKey) parts.push("Ctrl");
					if (e.shiftKey) parts.push("Shift");
					if (e.altKey) parts.push("Alt");
					if (e.metaKey) parts.push("Cmd");
					parts.push(e.key.toUpperCase());
					const combination = parts.join("+");
					text.setValue(combination);
					this.plugin.settings.openEditorHotkey = combination;
					void (async () => {
						await this.plugin.saveSettings();
						new Notice(i18n.settingUpdatedNotice(combination));
					})();
				});
			})
			.addExtraButton((btn) => {
				btn.setIcon("reset")
					.setTooltip(i18n.settingResetTooltip)
					.onClick(async () => {
						this.plugin.settings.openEditorHotkey = DEFAULT_SETTINGS.openEditorHotkey;
						await this.plugin.saveSettings();
						this.display();
						new Notice(i18n.settingResetNotice);
					});
			});

		new Setting(containerEl)
			.setName(i18n.settingDeleteHotkeyName)
			.setDesc(i18n.settingDeleteHotkeyDesc)
			.addText((text) => {
				text.setValue(this.plugin.settings.deleteSvgHotkey);
				text.inputEl.addEventListener("keydown", (e) => {
					if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
					e.preventDefault();
					e.stopPropagation();
					const parts: string[] = [];
					if (e.ctrlKey) parts.push("Ctrl");
					if (e.shiftKey) parts.push("Shift");
					if (e.altKey) parts.push("Alt");
					if (e.metaKey) parts.push("Cmd");
					parts.push(e.key.toUpperCase());
					const combination = parts.join("+");
					text.setValue(combination);
					this.plugin.settings.deleteSvgHotkey = combination;
					void (async () => {
						await this.plugin.saveSettings();
						new Notice(i18n.settingDeleteUpdatedNotice(combination));
					})();
				});
			})
			.addExtraButton((btn) => {
				btn.setIcon("reset")
					.setTooltip(i18n.settingDeleteResetTooltip)
					.onClick(async () => {
						this.plugin.settings.deleteSvgHotkey = DEFAULT_SETTINGS.deleteSvgHotkey;
						await this.plugin.saveSettings();
						this.display();
						new Notice(i18n.settingDeleteResetNotice);
					});
			});

		new Setting(containerEl)
			.setName(i18n.settingSmartLayoutHotkeyName)
			.setDesc(i18n.settingSmartLayoutHotkeyDesc)
			.addText((text) => {
				text.setValue(this.plugin.settings.smartLayoutHotkey);
				text.inputEl.addEventListener("keydown", (e) => {
					if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
					e.preventDefault();
					e.stopPropagation();
					const parts: string[] = [];
					if (e.ctrlKey) parts.push("Ctrl");
					if (e.shiftKey) parts.push("Shift");
					if (e.altKey) parts.push("Alt");
					if (e.metaKey) parts.push("Cmd");
					parts.push(e.key.toUpperCase());
					const combination = parts.join("+");
					text.setValue(combination);
					this.plugin.settings.smartLayoutHotkey = combination;
					void (async () => {
						await this.plugin.saveSettings();
						new Notice(i18n.settingSmartLayoutUpdatedNotice(combination));
					})();
				});
			})
			.addExtraButton((btn) => {
				btn.setIcon("reset")
					.setTooltip(i18n.settingSmartLayoutResetTooltip)
					.onClick(async () => {
						this.plugin.settings.smartLayoutHotkey = DEFAULT_SETTINGS.smartLayoutHotkey;
						await this.plugin.saveSettings();
						this.display();
						new Notice(i18n.settingSmartLayoutResetNotice);
					});
			});
	}
}

function fileStamp(file: TFile | null): string {
	if (!file) return "x";
	let h = 0;
	const s = file.path;
	for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
	return h.toString(36);
}

export { commitText, resolveHit, type TextHit };
