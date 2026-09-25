/**
 * Backwards-compatible storage facade.
 *
 * New application code should import focused repositories directly. Existing
 * callers keep this module so existing imports and storage tests remain compatible.
 */
export {
  deleteScript,
  isFavorite,
  listScripts,
  renameScript,
  saveScript,
  toggleFavorite,
  type SavedScript,
} from './integrations/storage/script-repository.ts';

export {
  loadEditorSnapshot,
  saveEditorSnapshot,
  type EditorSnapshot,
} from './integrations/storage/editor-repository.ts';

export {
  loadLayout,
  saveLayout,
  type LayoutItem,
} from './integrations/storage/legacy-layout-repository.ts';

export {
  listIndicatorFavorites,
  toggleIndicatorFavorite,
  type IndicatorFavorite,
} from './integrations/storage/favorite-repository.ts';

export {
  deleteWorkspaceTemplate,
  listWorkspaceTemplates,
  saveWorkspaceTemplate,
  type WorkspaceTemplate,
} from './integrations/storage/template-repository.ts';
