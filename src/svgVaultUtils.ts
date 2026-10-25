import type { App, TFile } from "obsidian";

export const MARK = "data-a1-svg";
export const SVG_PATH_ATTR = "data-a1-svg-path";

function isTFile(file: unknown): file is TFile {
	return !!file && typeof file === "object" && "path" in file && "extension" in file && typeof (file as TFile).extension === "string";
}

export function isDiagramSvg(el: Element | null): el is SVGSVGElement {
	if (!el) return false;
	const hasInstanceOf = "instanceOf" in el && typeof (el as { instanceOf?: (cls: unknown) => boolean }).instanceOf === "function";
	const isSvg = (hasInstanceOf ? (el as { instanceOf: (cls: unknown) => boolean }).instanceOf(SVGSVGElement) : false) || (el.localName || el.tagName.toLowerCase()).endsWith("svg");
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

/**
 * Normalizes SVG XML markup for modal/lightbox rendering:
 * - Removes any pre-existing data-a1-svg-path attributes to prevent duplicate XML attribute errors.
 * - Injects viewBox from width/height if missing.
 * - Stamps data-a1-svg-path when relPath is provided.
 */
export function prepareSvgMarkup(rawSvgContent: string, relPath?: string): string {
	let processed = rawSvgContent.trim();
	// Strip any pre-existing data-a1-svg-path on root <svg> so we never produce duplicate attributes
	processed = processed.replace(/(<svg\b[^>]*?)\s+data-a1-svg-path="[^"]*"/gi, "$1");

	const svgTagMatch = processed.match(/<svg\b[^>]*>/i);
	if (svgTagMatch && !/\bviewBox\s*=/i.test(svgTagMatch[0])) {
		const widthMatch = svgTagMatch[0].match(/\bwidth=["']?(\d+(?:\.\d+)?)(?:px)?["']?/i);
		const heightMatch = svgTagMatch[0].match(/\bheight=["']?(\d+(?:\.\d+)?)(?:px)?["']?/i);
		if (widthMatch && heightMatch) {
			processed = processed.replace(/<svg\b/i, `<svg viewBox="0 0 ${widthMatch[1]} ${heightMatch[1]}"`);
		}
	}

	if (relPath) {
		const safePath = relPath.replace(/"/g, "&quot;");
		processed = processed.replace(/<svg\b/i, `<svg ${SVG_PATH_ATTR}="${safePath}"`);
	}

	return processed;
}

export function sanitizeSvgLinkPath(raw: string): string {
	if (!raw) return "";
	return raw
		.replace(/\\/g, "/")
		.replace(/^\[\[/, "")
		.replace(/\]\]$/, "")
		.split("|")[0]
		.trim()
		.replace(/^\/+/, "");
}

/**
 * Single authoritative resolver for a vault .svg TFile.
 */
export function resolveVaultSvgFile(app: App, rawPathOrLink: string, sourcePath = ""): TFile | null {
	const clean = sanitizeSvgLinkPath(rawPathOrLink);
	if (!clean) return null;

	const direct = app.vault.getAbstractFileByPath(clean);
	if (isTFile(direct)) return direct;

	if (sourcePath) {
		const linked = app.metadataCache.getFirstLinkpathDest(clean, sourcePath);
		if (isTFile(linked)) return linked;
	}

	const globalLinked = app.metadataCache.getFirstLinkpathDest(clean, "");
	if (isTFile(globalLinked)) return globalLinked;

	const cleanLower = clean.toLowerCase();
	const filenameLower = (cleanLower.split("/").pop() || "").toLowerCase();
	const allFiles = app.vault.getFiles();

	// 1. Exact path match (case-insensitive)
	const exactMatch = allFiles.find((f) => f.path.replace(/\\/g, "/").toLowerCase() === cleanLower);
	if (exactMatch) return exactMatch;

	// 2. Suffix path match (e.g. relative subpath)
	const suffixMatch = allFiles.find((f) => f.path.replace(/\\/g, "/").toLowerCase().endsWith("/" + cleanLower));
	if (suffixMatch) return suffixMatch;

	// 3. Basename match for .svg files
	if (filenameLower) {
		const nameMatch = allFiles.find((f) => f.extension === "svg" && f.name.toLowerCase() === filenameLower);
		if (nameMatch) return nameMatch;
	}

	return null;
}

export async function readVaultSvgFile(app: App, fileOrPath: TFile | string, sourcePath = ""): Promise<{ content: string; path: string; file: TFile | null }> {
	if (typeof fileOrPath !== "string" && isTFile(fileOrPath)) {
		try {
			if (await app.vault.adapter.exists(fileOrPath.path)) {
				return { content: await app.vault.adapter.read(fileOrPath.path), path: fileOrPath.path, file: fileOrPath };
			}
			return { content: await app.vault.read(fileOrPath), path: fileOrPath.path, file: fileOrPath };
		} catch {
			return { content: "", path: fileOrPath.path, file: fileOrPath };
		}
	}

	const clean = sanitizeSvgLinkPath(typeof fileOrPath === "string" ? fileOrPath : "");
	const resolved = resolveVaultSvgFile(app, clean, sourcePath);
	if (resolved) {
		try {
			if (await app.vault.adapter.exists(resolved.path)) {
				return { content: await app.vault.adapter.read(resolved.path), path: resolved.path, file: resolved };
			}
			return { content: await app.vault.read(resolved), path: resolved.path, file: resolved };
		} catch {}
	}

	if (clean) {
		try {
			if (await app.vault.adapter.exists(clean)) {
				return { content: await app.vault.adapter.read(clean), path: clean, file: null };
			}
		} catch {}
	}

	return { content: "", path: clean, file: null };
}

export async function writeVaultSvgFile(
	app: App,
	rawPath: string,
	content: string,
	sourcePath = ""
): Promise<{ ok: boolean; resolvedPath: string }> {
	const clean = sanitizeSvgLinkPath(rawPath);
	if (!clean) return { ok: false, resolvedPath: "" };

	const file = resolveVaultSvgFile(app, clean, sourcePath);
	const targetPath = file ? file.path : clean;

	if (isTFile(file)) {
		try {
			await app.vault.modify(file, content);
			return { ok: true, resolvedPath: file.path };
		} catch (err) {
			console.warn("vault.modify failed, falling back to adapter.write:", err);
		}
	}

	try {
		await app.vault.adapter.write(targetPath, content);
		return { ok: true, resolvedPath: targetPath };
	} catch (err) {
		console.error("Failed to write SVG file via adapter:", err);
		return { ok: false, resolvedPath: targetPath };
	}
}

export function isFluentTasksInstalled(app: App): boolean {
	const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown>; enabledPlugins?: Set<string> } }).plugins;
	if (!plugins) return false;
	return !!(
		plugins.plugins?.["fluent-tasks"] ||
		plugins.enabledPlugins?.has?.("fluent-tasks")
	);
}

export function isTodoDataSvg(targetPath: string): boolean {
	if (!targetPath) return false;
	const clean = targetPath.replace(/\\/g, "/").toLowerCase();
	return clean.startsWith("tododata/") || clean.includes("/tododata/") || clean === "tododata";
}

export async function getLinkedTasksInfo(app: App, targetPath: string): Promise<{ count: number; titles: string[] }> {
	if (!targetPath) return { count: 0, titles: [] };
	const cleanTarget = sanitizeSvgLinkPath(targetPath);
	const filename = cleanTarget.split("/").pop() || "";
	if (!filename) return { count: 0, titles: [] };

	const titles: string[] = [];
	try {
		const files = app.vault.getFiles();
		const todoFiles = files.filter((f) => f.extension === "md" && (f.path.startsWith("TodoData/") || f.path.includes("TodoData")));
		for (const file of todoFiles) {
			const content = await app.vault.read(file);
			if (!content.includes("%%{") || !content.includes("svgs")) continue;
			const lines = content.split("\n");
			for (const line of lines) {
				const match = line.match(/%%(\{.*?\})%%/);
				if (!match) continue;
				try {
					const meta = JSON.parse(match[1]);
					if (Array.isArray(meta.svgs) && meta.svgs.length > 0) {
						const isLinked = meta.svgs.some((s: string) => {
							if (typeof s !== "string") return false;
							const clean = sanitizeSvgLinkPath(s);
							return clean === cleanTarget ||
								clean.endsWith("/" + filename) ||
								cleanTarget.endsWith("/" + clean) ||
								clean.split("/").pop() === filename;
						});
						if (isLinked) {
							const rawTitle = line.replace(/^- \[([ x])\]\s*/, "").replace(/\s*%%\{.*?\}%%/, "").trim();
							titles.push(rawTitle || "Untitled task");
						}
					}
				} catch {}
			}
		}
	} catch (err) {
		console.error("Failed to detect linked tasks:", err);
	}
	return { count: titles.length, titles };
}

export async function cleanupFluentTasksSvgLinks(app: App, targetPath: string): Promise<void> {
	if (!targetPath) return;
	const cleanTarget = sanitizeSvgLinkPath(targetPath);
	const filename = cleanTarget.split("/").pop() || "";
	if (!filename) return;

	try {
		const files = app.vault.getFiles();
		const todoFiles = files.filter((f) => f.extension === "md" && (f.path.startsWith("TodoData/") || f.path.includes("TodoData")));
		for (const file of todoFiles) {
			const content = await app.vault.read(file);
			if (!content.includes("%%{") || !content.includes("svgs")) continue;

			let modified = false;
			const newLines = content.split("\n").map((line) => {
				const match = line.match(/%%(\{.*?\})%%/);
				if (!match) return line;
				try {
					const meta = JSON.parse(match[1]);
					if (Array.isArray(meta.svgs) && meta.svgs.length > 0) {
						const originalLen = meta.svgs.length;
						const remaining = meta.svgs.filter((s: string) => {
							if (typeof s !== "string") return false;
							const clean = sanitizeSvgLinkPath(s);
							if (clean === cleanTarget) return false;
							if (clean.endsWith("/" + filename) || cleanTarget.endsWith("/" + clean)) return false;
							if (clean.split("/").pop() === filename) return false;
							return true;
						});
						if (remaining.length !== originalLen) {
							modified = true;
							if (remaining.length > 0) {
								meta.svgs = remaining;
							} else {
								delete meta.svgs;
							}
							return line.replace(/%%\{.*?\}%%/, `%%${JSON.stringify(meta)}%%`);
						}
					}
				} catch {}
				return line;
			});

			if (modified) {
				await app.vault.modify(file, newLines.join("\n"));
			}
		}
	} catch (err) {
		console.error("Failed to clean up fluent-tasks SVG links:", err);
	}
}

export async function cleanupSvgEmbedsInNotes(app: App, targetPath: string): Promise<void> {
	if (!targetPath) return;
	const cleanTarget = sanitizeSvgLinkPath(targetPath);
	const filename = cleanTarget.split("/").pop() || "";
	if (!filename) return;

	const escapedName = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const embedRegexes = [
		new RegExp(`!?\\[\\[(?:[^\\]]*\\/)?${escapedName}(?:\\|[^\\]]*)?\\]\\]`, "gi"),
		new RegExp(`!?\\[[^\\]]*\\]\\([^)]*${escapedName}[^)]*\\)`, "gi"),
	];

	try {
		const files = app.vault.getFiles().filter((f) => f.extension === "md");
		for (const file of files) {
			const content = await app.vault.read(file);
			if (!content.includes(filename)) continue;

			let modified = false;
			const lines = content.split("\n");
			const newLines: string[] = [];

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				let isPureEmbed = false;
				for (const rx of embedRegexes) {
					rx.lastIndex = 0;
					const match = rx.exec(line.trim());
					if (match && match[0] === line.trim()) {
						isPureEmbed = true;
						break;
					}
				}

				if (isPureEmbed) {
					modified = true;
					continue;
				}

				let newLine = line;
				for (const rx of embedRegexes) {
					rx.lastIndex = 0;
					if (rx.test(newLine)) {
						newLine = newLine.replace(rx, "").trimEnd();
						modified = true;
					}
				}
				newLines.push(newLine);
			}

			if (modified) {
				await app.vault.modify(file, newLines.join("\n"));
			}
		}
	} catch (err) {
		console.error("Failed to clean up SVG embeds in notes:", err);
	}
}
