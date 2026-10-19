# SVG Quick Editor

Quickly edit text inside SVG graphics directly in Obsidian without needing external graphics software.

Supports inline SVGs in notes, embedded `.svg` files, and lightbox views.

## Features

- **In-Place Text Editing**: Hover over any text in an SVG and press **F2** (or your custom hotkey) to edit text in place. Press **Enter** or click outside to commit changes.
- **Ctrl + Scroll UI Box Scaling**: Hold **Ctrl** and scroll the mouse wheel over any hovered card or UI element to smoothly scale it in place around its center.
- **Delete Key Direct Removal**: Hover over any UI box or card and press **Delete** to directly remove it without entering text edit mode.
- **Smart Layout**: Automatically aligns horizontal card/chip rows to common baseline Y coordinates and uniform gap spacing, as well as vertically balancing card columns. Trigger via toolbar button or customizable shortcut (**Ctrl + Shift + S**).
- **In-Modal Delete SVG**: Delete an entire SVG diagram directly from within the editor modal with a confirmation dialog (**Delete SVG** button or customizable shortcut).
- **Smart Element Removal**: Clearing the text and committing will automatically remove the corresponding text chip and its background element.
- **In-Place Ctrl+S Save**: Press **Ctrl + S** (or **Cmd + S**) to overwrite and save changes directly to disk while keeping full Undo / Redo history.
- **Disk Change Auto-Reload**: Automatically detects disk file modifications (e.g. from external AI tools) and hot-reloads SVGs upon returning to Obsidian or opening the modal.
- **Shift + Drag to Move**: Hold **Shift** and drag any card, badge, or text box to freely reposition it within the SVG diagram.
- **Alt + Drag Duplication**: Hold **Alt** and drag a card, badge, or chip to clone it within the SVG diagram.
- **Magnetic Auto Alignment**: Automatically snaps moving elements to adjacent card edges and sub-boxes with hierarchy-aware precision and visual guide lines.
- **Dirty State Exit Confirmation**: Pressing **Esc** or right-clicking on modified SVGs prompts whether to save changes before exiting, while unmodified SVGs close instantly.
- **Undo / Redo**: Supports **Ctrl + Z** and **Ctrl + Y** to undo or redo recent SVG modifications.
- **Full View & Lightbox Support**: Seamlessly works with inline note SVGs, embedded files, and modal lightboxes.

## Usage

1. Hover your cursor over any text in an SVG diagram. A dashed bounding box indicates the active element.
2. Press **F2** or double-click to open the inline text overlay.
3. Edit the text and press **Enter** to save, or **Esc** to cancel.
4. Press **Ctrl + S** at any time to save changes directly to disk without losing Ctrl+Z / Ctrl+Y history.
5. Hold **Ctrl** and scroll the mouse wheel to scale the hovered UI box up or down.
6. Hover over any box and press **Delete** to instantly remove it.
7. To move an element, hold **Shift** and drag it with the left mouse button.
8. To duplicate an element, hold **Alt** and drag it.
9. Press **Ctrl + Shift + S** (or click the Smart Layout icon) to auto-align horizontal chips and balance columns.
10. Toggle **Auto Align** in the modal toolbar to enable or disable magnetic snap guides.
11. Use **Ctrl + Z** to undo modifications, or **Ctrl + Y** to redo.

## Command

- **SVG Quick Editor: Edit SVG text under cursor**: Activates inline text editing for the currently hovered SVG element. You can assign any hotkey to this command in Obsidian Settings -> Hotkeys.

## License

MIT License. See [LICENSE](LICENSE) for details.
