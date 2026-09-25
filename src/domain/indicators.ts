export type IndicatorFavorite = {
  key: string;
  name: string;
  savedAt: number;
} & (
  | { kind: 'native'; nativeType: string }
  | { kind: 'script'; script: string; language?: string }
);

export type WorkspaceIndicatorSource =
  | { kind: 'native'; nativeType: string }
  | { kind: 'script'; script: string; language: string };

export interface WorkspaceIndicatorItem {
  name: string;
  beta?: boolean;
  source: WorkspaceIndicatorSource;
  add?: () => void;
  remove?: () => void;
}

export interface NativeIndicatorIdentity {
  title: string;
  type: string;
}

export function indicatorSourceKey(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function nativeFavorite(name: string, nativeType: string): IndicatorFavorite {
  return {
    key: `native:${nativeType}`,
    kind: 'native',
    name,
    nativeType,
    savedAt: Date.now(),
  };
}

export function scriptFavorite(
  name: string,
  script: string,
  language = 'pine',
): IndicatorFavorite {
  return {
    key: `script:${indicatorSourceKey(script)}`,
    kind: 'script',
    name,
    script,
    language,
    savedAt: Date.now(),
  };
}
