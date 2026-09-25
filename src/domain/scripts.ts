export interface SavedScript {
  name: string;
  script: string;
  savedAt: number;
  favorite?: boolean;
}

export interface EditorSnapshot {
  script: string;
  name: string | null;
}
