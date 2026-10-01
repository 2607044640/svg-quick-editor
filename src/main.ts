import { App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, getLanguage } from "obsidian";
import { asText, cloneCard, commitText, findTextInCard, nudge, readText, resolveCloneTarget, resolveHit, serializeSvg, type TextHit } from "./svgCard";
import { openTextOverlay, type OverlayHandle } from "./editorOverlay";
import { ensureMarker, findSvgSpans, matchSpan, spliceSvg } from "./svgSource";
import { SvgHistoryManager } from "./svgHistory";
import "./styles.css";

const MARK = "data-a1-svg";
const SVG_PATH_ATTR = "data-a1-svg-path";

interface A1SvgQuickEditorSettings {
	openEditorHotkey: string; // e.g. "Ctrl+Shift+Alt+I"
}

const DEFAULT_SETTINGS: A1SvgQuickEditorSettings = {
	openEditorHotkey: "Ctrl+Shift+Alt+I",
};

export function isDiagramSvg(el: Element | null): el is SVGSVGElement {
	if (!el) return false;
	const isSvg = (typeof SVGSVGElement !== "undefined" && el instanceof SVGSVGElement) || (el.localName || el.tagName.toLowerCase()).endsWith("svg");
	if (!isSvg) return false;

	// Ignore toolbar icons, zoom buttons, close buttons, nav actions
	if (el.closest("button, .oit-floating-zoom-btn, .clickable-icon, .svg-lightbox-header, .a1-svg-modal-header, .nav-action-button, [class*='overlay'], [class*='toolbar'], .workspace-tab-header, .view-header")) {
		return false;
	}

	const cls = (el.getAttribute("class") || "").toLowerCase();
	if (cls.includes("svg-icon") || cls.includes("lucide") || cls.includes("oit-") || cls.includes("zoom") || cls.includes("icon")) {
		return false;
	}

	// Tiny icons with no text are never diagram SVGs
	const w = parseFloat(el.getAttribute("width") || "0");
	const h = parseFloat(el.getAttribute("height") || "0");
	const vb = (el.getAttribute("viewBox") || el.getAttribute("viewbox") || "").trim().split(/[\s,]+/);
	const vbw = vb.length === 4 ? parseFloat(vb[2]) : 0;
	const vbh = vb.length === 4 ? parseFloat(vb[3]) : 0;

	if (((w > 0 && w <= 64 && h > 0 && h <= 64) || (vbw > 0 && vbw <= 64 && vbh > 0 && vbh <= 64)) && el.querySelectorAll("text").length === 0) {
		return false;
	}

	if (el.querySelectorAll("text").length === 0 && (w <= 64 || vbw <= 64)) {
		return false;
	}

	return true;
}

export function getLocaleStrings() {
	let lang = "en";
	try {
		lang = (getLanguage?.() || window.localStorage?.getItem("language") || (window as any).moment?.locale() || "en").toLowerCase();
	} catch {}
	const isZh = lang === "zh" || lang.startsWith("zh-") || lang.startsWith("zh_");

	if (isZh) {
		return {
			modalTitleDefault: "SVG 图像编辑器",
			modalTitleNamed: (name: string) => `SVG 图像编辑器 — ${name}`,
			badgeEdit: "F2 / 双击文字编辑",
			badgeDelete: "清空文字即删UI框",
			badgeClone: "Alt + 拖拽复制UI框",
			badgeUndoRedo: "Ctrl+Z/Y 撤销重做",
			badgeAutoSave: "退出确认保存",
			closeTooltip: "关闭 (Esc)",
			noticeSaved: (name: string) => `SVG 已保存: ${name}`,
			noticeUndo: "已撤销",
			noticeRedo: "已重做",
			confirmSaveTitle: "是否保存？",
			confirmSaveDesc: "当前 SVG 图像已有改动，退出前是否保存更改？",
			btnSave: "保存 (Enter)",
			btnDiscard: "不保存 / 放弃",
			btnCancel: "继续编辑 (Esc)",
			openInTab: "在新标签页打开",
			noticeHoverSvgPrompt: "请将鼠标悬浮在笔记中的 SVG 图片上方",
			noticeHoverTextPrompt: "请将鼠标悬浮在 SVG 卡片、文字或图片上方",
			noticeCannotParse: "未能解析出有效的 SVG 数据",
			settingTabTitle: "A1 SVG Quick Editor 设置",
			settingHotkeyName: "打开 SVG 图像编辑器快捷键",
			settingHotkeyDesc: "当鼠标停留在笔记中的 SVG 图片上时按下此快捷键，打开全屏交互式 SVG 编辑器弹窗。默认：Ctrl+Shift+Alt+I。在输入框中可直接按下想要录制的快捷键。",
			settingResetTooltip: "恢复默认快捷键 (Ctrl+Shift+Alt+I)",
			settingUpdatedNotice: (hk: string) => `SVG 编辑快捷键已更新为: ${hk}`,
			settingResetNotice: "已恢复默认快捷键: Ctrl+Shift+Alt+I",
		};
	}

	return {
		modalTitleDefault: "SVG Image Editor",
		modalTitleNamed: (name: string) => `SVG Image Editor — ${name}`,
		badgeEdit: "F2 / Double-click to Edit",
		badgeDelete: "Clear Text to Delete Box",
		badgeClone: "Alt + Drag to Duplicate",
		badgeUndoRedo: "Ctrl+Z/Y Undo/Redo",
		badgeAutoSave: "Save on Exit",
		closeTooltip: "Close (Esc)",
		noticeSaved: (name: string) => `SVG saved: ${name}`,
		noticeUndo: "Undone",
		noticeRedo: "Redone",
		confirmSaveTitle: "Save changes?",
		confirmSaveDesc: "The SVG image has been modified. Do you want to save changes before exiting?",
		btnSave: "Save (Enter)",
		btnDiscard: "Don't Save",
		btnCancel: "Keep Editing (Esc)",
		openInTab: "Open in Tab",
		noticeHoverSvgPrompt: "Please hover cursor over an SVG image in the note",
		noticeHoverTextPrompt: "Please hover cursor over an SVG card, text, or image",
		noticeCannotParse: "Failed to resolve valid SVG data",
		settingTabTitle: "A1 SVG Quick Editor Settings",
		settingHotkeyName: "Open SVG Image Editor Hotkey",
		settingHotkeyDesc: "Press this hotkey while hovering over an SVG image in any note to open the interactive SVG editor. Default: Ctrl+Shift+Alt+I. Type directly in the input box to record your hotkey.",
		settingResetTooltip: "Reset to default hotkey (Ctrl+Shift+Alt+I)",
		settingUpdatedNotice: (hk: string) => `SVG editor hotkey updated to: ${hk}`,
		settingResetNotice: "Reset to default hotkey: Ctrl+Shift+Alt+I",
	};
}

export default class A1SvgQuickEditorPlugin extends Plugin {
	settings: A1SvgQuickEditorSettings = DEFAULT_SETTINGS;
	public history: SvgHistoryManager = new SvgHistoryManager();
	private overlay: OverlayHandle | null = null;
	private hovered: Element | null = null;
	private hoveredSvgTarget: Element | null = null;
	private lastPointerX = 0;
	private lastPointerY = 0;
	private dragging: { card: Element; svg: SVGSVGElement; pointerId: number; lastX: number; lastY: number; moved: boolean } | null = null;
	private activeModal: HTMLElement | null = null;

	async onload(): Promise<void> {
		(window as any).a1SvgQuickEditor = this;
		(window as any).svgQuickEditor = this;
		this.addSettingTab(new A1SvgQuickEditorSettingTab(this.app, this));
		await this.loadSettings();

		this.registerDomEvent(window, "pointermove", (evt) => this.onPointerMove(evt), { capture: true });
		this.registerDomEvent(window, "pointerdown", (evt) => this.onPointerDown(evt), { capture: true });
		this.registerDomEvent(window, "pointerup", (evt) => this.onPointerUp(evt), { capture: true });
		this.registerDomEvent(window, "keydown", (evt) => this.onKeyDown(evt), { capture: true });
		this.registerDomEvent(window, "dblclick", (evt) => {
			const text = this.textFromEvent(evt) ?? (evt.target instanceof Element ? findTextInCard(evt.target, evt.clientX, evt.clientY) : null);
			if (text && this.isInteractiveSvg(text)) {
				evt.preventDefault();
				evt.stopPropagation();
				evt.stopImmediatePropagation();
				void this.beginEdit(text);
			}
		}, { capture: true });

		this.registerDomEvent(window, "click", (evt) => {
			if (this.overlay) return;
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private matchesObsidianHotkey(evt: KeyboardEvent, hotkey: { modifiers?: string[]; key?: string }): boolean {
		if (!hotkey || !hotkey.key) return false;
		const isMac = typeof navigator !== "undefined" && navigator.platform?.toUpperCase().includes("MAC");
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
		const isMac = typeof navigator !== "undefined" && navigator.platform?.toUpperCase().includes("MAC");
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
		const hkMgr = (this.app as any)?.hotkeyManager;
		if (hkMgr) {
			const commandIds = [
				"svg-quick-editor:edit-svg-text",
				"svg-quick-editor:open-svg-image-editor",
				"a1-svg-quick-editor:edit-svg-text",
				"a1-svg-quick-editor:open-svg-image-editor"
			];
			for (const id of commandIds) {
				const list: any[] = [
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
			if (this.overlay) return;
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

		// 3. Undo (Ctrl+Z) and Redo (Ctrl+Y / Ctrl+Shift+Z)
		if ((evt.ctrlKey || evt.metaKey) && !evt.altKey && !this.overlay) {
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
	}

	public undo(svg?: SVGSVGElement | null): boolean {
		const res = this.history.undo(svg);
		if (res) {
			this.clearHover();
			new Notice(getLocaleStrings().noticeUndo);
		}
		return res;
	}

	public redo(svg?: SVGSVGElement | null): boolean {
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

	public async saveCurrentSvg(svg?: SVGSVGElement | null): Promise<void> {
		const target = svg ?? this.history.getActiveSvg();
		if (!target) return;
		await this.persistSvg(target);
		this.history.markSaved(target);
	}

	public discardCurrentSvg(svg?: SVGSVGElement | null): void {
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
				(typeof (svgTarget as any).matches === "function" && (svgTarget as any).matches(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body"));
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
				this.dragging.moved = true;
				this.dragging.lastX = evt.clientX;
				this.dragging.lastY = evt.clientY;
				this.translate(this.dragging.card, this.dragging.svg, dx, dy);
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
		if (!evt.altKey || evt.button !== 0) return;
		const target = evt.target instanceof Element ? evt.target : null;
		if (!target) return;

		let cloneTarget = resolveCloneTarget(target, evt.clientX, evt.clientY);
		if (!cloneTarget) {
			const text = this.textFromEvent(evt);
			if (text) {
				cloneTarget = resolveCloneTarget(text, evt.clientX, evt.clientY);
			}
		}
		if (!cloneTarget) return;

		const isSvg = (typeof SVGSVGElement !== "undefined" && cloneTarget instanceof SVGSVGElement) || (cloneTarget.localName || cloneTarget.tagName.toLowerCase()).endsWith("svg");
		const svg = (isSvg ? cloneTarget : (cloneTarget.ownerSVGElement ?? cloneTarget.closest("svg"))) as SVGSVGElement | null;
		if (!svg || !this.isInteractiveSvg(svg)) return;

		evt.preventDefault();
		evt.stopPropagation();
		evt.stopImmediatePropagation();

		// Record undo snapshot in memory before duplicating
		this.history.recordSnapshot(svg);

		const clone = cloneCard(cloneTarget, 12, 12);
		cloneTarget.parentElement?.appendChild(clone);
		this.dragging = {
			card: clone,
			svg,
			pointerId: evt.pointerId,
			lastX: evt.clientX,
			lastY: evt.clientY,
			moved: true,
		};
	}

	private onPointerUp(evt: PointerEvent): void {
		if (!this.dragging || evt.pointerId !== this.dragging.pointerId) return;
		const svg = this.dragging.svg;
		this.dragging = null;

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
		const svg = isSvg ? el : (el.ownerSVGElement ?? el.closest("svg") ?? el.querySelector("svg"));
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

	private clearHover(): void {
		this.hovered?.classList.remove("a1-svg-hover-text");
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
		}
		this.hoveredSvgTarget = null;
	}

	private async beginEdit(textEl: Element): Promise<void> {
		const hit = resolveHit(textEl);
		const svg = textEl.ownerSVGElement;
		if (!hit || !svg) return;
		this.overlay?.close();
		const rect = textEl.getBoundingClientRect();
		const cs = getComputedStyle(textEl);
		this.overlay = openTextOverlay(document.body, {
			rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
			value: readText(hit.textEl),
			fontSize: cs.fontSize,
			fontFamily: cs.fontFamily,
			color: cs.fill || cs.color,
			onCommit: (value) => {
				this.overlay = null;
				this.history.recordSnapshot(svg);
				commitText(hit, value);
				const inModal = !!svg.closest(".a1-svg-modal-body, .svg-lightbox-content, .svg-lightbox-modal, .svg-lightbox-body");
				if (!inModal) {
					void this.persistSvg(svg);
				}
			},
			onCancel: () => {
				this.overlay = null;
			},
		});
	}

	private translate(card: Element, svg: SVGSVGElement, dx: number, dy: number): void {
		const ctm = svg.getScreenCTM();
		if (!ctm) return;
		const inv = ctm.inverse();
		nudge(card, inv.a * dx + inv.c * dy, inv.b * dx + inv.d * dy);
	}

	/**
	 * Persists SVG changes.
	 * If the SVG was loaded from a standalone .svg vault file (marked with data-a1-svg-path),
	 * writes directly to that file and refreshes note images.
	 * Otherwise splices into the active Markdown note.
	 */
	public async persistSvg(svg: SVGSVGElement): Promise<void> {
		const svgPath = svg.getAttribute(SVG_PATH_ATTR);
		if (svgPath) {
			const file = this.app.vault.getAbstractFileByPath(svgPath);
			const live = serializeSvg(svg);
			if (file instanceof TFile) {
				await this.app.vault.modify(file, live);
			} else {
				try {
					await this.app.vault.adapter.write(svgPath, live);
				} catch (err) {
					console.error("Failed to write svg file via adapter:", err);
				}
			}
			// Refresh <img> embeds referencing this SVG in the DOM
			this.refreshImgEmbeds(svgPath);
			// Dispatch event for other plugins (fluent-tasks, etc.)
			window.dispatchEvent(new CustomEvent("a1-svg-updated", { detail: { path: svgPath, content: live } }));
			const name = svgPath.split("/").pop() || "SVG";
			new Notice(getLocaleStrings().noticeSaved(name));
			this.clearHover();
			return;
		}

		// Splicing inline SVG in active Markdown file
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file ?? this.app.workspace.getActiveFile();
		if (!file) return;
		const marker = this.markerFor(svg);
		const live = serializeSvg(svg);
		await this.app.vault.process(file, (data) => {
			const span = matchSpan(data, this.domIndex(svg), marker);
			if (!span) return data;
			const stamped = ensureMarker(live, marker);
			return spliceSvg(data, span, stamped);
		});
		this.clearHover();
	}

	private refreshImgEmbeds(filePath: string): void {
		const filename = filePath.split("/").pop() || "";
		const encoded = encodeURIComponent(filename);
		const imgs = Array.from(document.querySelectorAll("img"));
		for (const img of imgs) {
			const src = img.getAttribute("src") || "";
			if (src.includes(filename) || src.includes(encoded)) {
				const clean = src.split("?")[0];
				img.setAttribute("src", `${clean}?t=${Date.now()}`);
			}
		}
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
					const vaultBasePath = ((this.app.vault.adapter as any)?.basePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
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
				const clean = rawCand.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
				if (!clean) continue;

				if (sourcePath) {
					file = this.app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
				}
				if (!file) {
					file = this.app.metadataCache.getFirstLinkpathDest(clean, "");
				}
				if (!file) {
					file = this.app.vault.getAbstractFileByPath(clean) as TFile | null;
				}
				if (!file) {
					const allFiles = this.app.vault.getFiles();
					const cleanLower = clean.toLowerCase();
					file = allFiles.find((f) =>
						f.path.toLowerCase() === cleanLower ||
						f.name.toLowerCase() === cleanLower ||
						f.path.toLowerCase().endsWith("/" + cleanLower) ||
						(cleanLower.endsWith(".svg") && f.name.toLowerCase().endsWith(cleanLower)) ||
						(filenameFromSrc && f.name.toLowerCase() === filenameFromSrc.toLowerCase())
					) || null;
				}
				if (file && file.extension === "svg") {
					try {
						rawSvgContent = await this.app.vault.read(file);
						relPath = file.path;
						title = i18n.modalTitleNamed(file.name);
						break;
					} catch {}
				}

				// Direct vault adapter read (bypasses unindexed cache!)
				if (!rawSvgContent) {
					try {
						const exists = await this.app.vault.adapter.exists(clean);
						if (exists) {
							rawSvgContent = await this.app.vault.adapter.read(clean);
							relPath = clean;
							title = i18n.modalTitleNamed(clean.split("/").pop() || "SVG");
							break;
						}
					} catch {}
				}
			}
		}

		// 2. If not resolved from embed/img, check for live diagram <svg> element in modal/page (strictly excluding icon/zoom SVGs)
		if (!rawSvgContent && !img && !embed.classList?.contains("internal-embed") && !embed.classList?.contains("image-embed")) {
			const candidateSvg = target instanceof SVGSVGElement
				? target
				: (target.closest("svg") ?? target.querySelector("svg"));
			if (candidateSvg && isDiagramSvg(candidateSvg)) {
				const svgPath = candidateSvg.getAttribute(SVG_PATH_ATTR);
				if (svgPath) {
					const f = this.app.vault.getAbstractFileByPath(svgPath);
					if (f instanceof TFile) file = f;
					relPath = svgPath;
				}
				rawSvgContent = serializeSvg(candidateSvg);
				if (file) title = i18n.modalTitleNamed(file.name);
			}
		}

		if (!rawSvgContent) {
			new Notice(i18n.noticeCannotParse);
			return;
		}

		this.renderModalWithContent(rawSvgContent, relPath || file?.path || "", title);
	}

	public async openSvgEditorByPathOrLink(linkPath: string): Promise<void> {
		const clean = linkPath.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
		if (!clean) return;
		const i18n = getLocaleStrings();
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const sourcePath = activeView?.file?.path || this.app.workspace.getActiveFile()?.path || "";

		let file: TFile | null = null;
		if (sourcePath) file = this.app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
		if (!file) file = this.app.metadataCache.getFirstLinkpathDest(clean, "");
		if (!file) file = this.app.vault.getAbstractFileByPath(clean) as TFile | null;
		if (!file) {
			const cleanLower = clean.toLowerCase();
			file = this.app.vault.getFiles().find((f) =>
				f.path.toLowerCase() === cleanLower ||
				f.name.toLowerCase() === cleanLower ||
				f.path.toLowerCase().endsWith("/" + cleanLower)
			) || null;
		}

		let rawSvgContent = "";
		let relPath = file ? file.path : clean;
		if (file) {
			try {
				rawSvgContent = await this.app.vault.read(file);
			} catch {}
		}
		if (!rawSvgContent) {
			try {
				if (await this.app.vault.adapter.exists(clean)) {
					rawSvgContent = await this.app.vault.adapter.read(clean);
					relPath = clean;
				}
			} catch {}
		}

		if (!rawSvgContent) {
			new Notice(i18n.noticeCannotParse);
			return;
		}

		const name = file ? file.name : (clean.split("/").pop() || "SVG");
		this.renderModalWithContent(rawSvgContent, relPath, i18n.modalTitleNamed(name));
	}

	private renderModalWithContent(rawSvgContent: string, relPath: string, title: string): void {
		const i18n = getLocaleStrings();

		// Auto-inject viewBox if missing
		if (!rawSvgContent.includes("viewBox") && !rawSvgContent.includes("viewbox")) {
			const widthMatch = rawSvgContent.match(/width=["']?(\d+(?:\.\d+)?)px?["']?/i);
			const heightMatch = rawSvgContent.match(/height=["']?(\d+(?:\.\d+)?)px?["']?/i);
			if (widthMatch && heightMatch) {
				const w = widthMatch[1];
				const h = heightMatch[1];
				rawSvgContent = rawSvgContent.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
			}
		}

		// Stamp SVG_PATH_ATTR if path exists
		if (relPath) {
			rawSvgContent = rawSvgContent.replace(/<svg\b/i, `<svg ${SVG_PATH_ATTR}="${relPath}"`);
		}

		// Create Modal DOM
		const backdrop = document.createElement("div");
		backdrop.className = "a1-svg-modal-backdrop";

		const dialog = document.createElement("div");
		dialog.className = "a1-svg-modal-dialog";

		const header = document.createElement("div");
		header.className = "a1-svg-modal-header";

		const titleRow = document.createElement("div");
		titleRow.className = "a1-svg-modal-title-row";

		const titleDiv = document.createElement("div");
		titleDiv.className = "a1-svg-modal-title";
		titleDiv.innerHTML = `
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent, #7c9cff)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
				<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
				<circle cx="8.5" cy="8.5" r="1.5"/>
				<polyline points="21 15 16 10 5 21"/>
			</svg>
			<span>${title}</span>
		`;

		const hintsDiv = document.createElement("div");
		hintsDiv.className = "a1-svg-modal-hints";
		hintsDiv.innerHTML = `
			<span class="a1-svg-modal-badge">${i18n.badgeEdit}</span>
			<span class="a1-svg-modal-badge">${i18n.badgeDelete}</span>
			<span class="a1-svg-modal-badge">${i18n.badgeClone}</span>
			<span class="a1-svg-modal-badge">${i18n.badgeUndoRedo}</span>
		`;

		titleRow.appendChild(titleDiv);
		titleRow.appendChild(hintsDiv);

		const actionGroup = document.createElement("div");
		actionGroup.className = "a1-svg-modal-actions";

		if (relPath) {
			const openInTabBtn = document.createElement("button");
			openInTabBtn.type = "button";
			openInTabBtn.className = "a1-svg-modal-tab-btn";
			openInTabBtn.textContent = i18n.openInTab;
			openInTabBtn.title = "Open note/file in Obsidian";
			openInTabBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.app.workspace.openLinkText(relPath, "", false);
			});
			actionGroup.appendChild(openInTabBtn);
		}

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
		body.innerHTML = rawSvgContent;

		const modalSvg = body.querySelector("svg") as SVGSVGElement | null;
		if (modalSvg) {
			this.history.setActiveSvg(modalSvg);
		}

		dialog.appendChild(header);
		dialog.appendChild(body);
		backdrop.appendChild(dialog);

		let isConfirming = false;
		const closeModal = () => {
			this.clearHover();
			backdrop.remove();
			if (this.activeModal === backdrop) this.activeModal = null;
			window.removeEventListener("keydown", keyHandler);
		};

		const requestClose = () => {
			if (isConfirming) return;
			this.clearHover();
			if (modalSvg && this.history.isDirty(modalSvg)) {
				isConfirming = true;
				this.promptSaveConfirmation(
					async () => {
						isConfirming = false;
						await this.persistSvg(modalSvg);
						this.history.markSaved(modalSvg);
						closeModal();
					},
					() => {
						isConfirming = false;
						this.history.discard(modalSvg);
						closeModal();
					},
					() => {
						isConfirming = false;
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
			if (e.key === "Escape" && !this.overlay && !isConfirming) {
				e.preventDefault();
				requestClose();
			}
		};
		window.addEventListener("keydown", keyHandler);

		document.body.appendChild(backdrop);
		this.activeModal = backdrop;
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
				text.inputEl.addEventListener("keydown", async (e) => {
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
					await this.plugin.saveSettings();
					new Notice(i18n.settingUpdatedNotice(combination));
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
