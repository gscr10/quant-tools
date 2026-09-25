export type Disposer = () => void;

export class DisposerStack {
  private readonly disposers: Disposer[] = [];
  private disposed = false;

  add(disposer: Disposer): Disposer {
    if (this.disposed) {
      disposer();
      return disposer;
    }
    this.disposers.push(disposer);
    return disposer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let firstError: unknown;
    while (this.disposers.length > 0) {
      try {
        this.disposers.pop()?.();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }
}
