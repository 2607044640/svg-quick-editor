# SVG Quick Editor

Quickly edit text inside SVG graphics directly in Obsidian without needing external graphics software.

Supports inline SVGs in notes, embedded `.svg` files, and lightbox views.

## Features

- **In-Place Text Editing**: Hover over any text in an SVG and press **F2** (or your custom hotkey) to edit text in place. Press **Enter** or click outside to commit changes.
- **Smart Element Removal**: Clearing the text and committing will automatically remove the corresponding text chip and its background element.
- **Shift + Drag to Move**: Hold **Shift** and drag any card, badge, or text box to freely reposition it within the SVG diagram.
- **Alt + Drag Duplication**: Hold **Alt** and drag a card, badge, or chip to clone it within the SVG diagram.
- **Magnetic Auto Alignment**: Automatically snaps moving elements to adjacent card edges and sub-boxes with hierarchy-aware precision and visual guide lines.
- **Undo / Redo**: Supports **Ctrl + Z** and **Ctrl + Y** to undo or redo recent SVG modifications.
- **Full View & Lightbox Support**: Seamlessly works with inline note SVGs, embedded files, and modal lightboxes.

## Usage

1. Hover your cursor over any text in an SVG diagram. A dashed bounding box indicates the active element.
2. Press **F2** to open the inline text overlay.
3. Edit the text and press **Enter** to save, or **Esc** to cancel.
4. To move an element, hold **Shift** and drag it with the left mouse button.
5. To duplicate an element, hold **Alt** and drag it.
6. Toggle **Auto Align** in the modal toolbar to enable or disable magnetic snap guides.
7. Use **Ctrl + Z** to undo modifications, or **Ctrl + Y** to redo.

## Command

- **SVG Quick Editor: Edit SVG text under cursor**: Activates inline text editing for the currently hovered SVG element. You can assign any hotkey to this command in Obsidian Settings -> Hotkeys.

## License

MIT License. See [LICENSE](LICENSE) for details.
