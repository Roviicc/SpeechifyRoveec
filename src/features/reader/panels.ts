/** Which overlay (sheet or menu) the reader is showing. */
export type Panel = null | 'speed' | 'text' | 'toc' | 'sleep' | 'search' | 'notes' | 'menu' | 'note-edit'

/** Panels reachable from the "•••" menu. */
export type MenuPanel = 'search' | 'notes' | 'sleep'
