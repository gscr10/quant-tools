import type { WorkspaceTemplate } from '../templates.ts';

export interface TemplateRepository {
  list(): WorkspaceTemplate[];
  save(name: string, state: unknown): WorkspaceTemplate[];
  delete(name: string): WorkspaceTemplate[];
}
