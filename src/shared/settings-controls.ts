/** Public DOM seam for a host's themed select presentation. No engine types. */
export interface SettingsSelectPopover {
  readonly el: HTMLElement;
  readonly trigger: HTMLElement;
  destroy(): void;
  reposition(): void;
}

export interface SettingsControlsPort {
  dismissedPopover(event: Event): boolean;
  openSelect(
    trigger: HTMLElement,
    options: readonly { value: string; label: string }[],
    current: string,
    onPick: (value: string, label: string) => void,
    placement: {
      host: HTMLElement;
      boundary: HTMLElement;
      position: 'fixed';
      gap: number;
      onClose: () => void;
    },
  ): SettingsSelectPopover;
  /** Optional typed-input popovers, rendered by the host's existing UI kit. */
  openContent?(
    trigger: HTMLElement,
    content: HTMLElement,
    placement: { host: HTMLElement; boundary: HTMLElement; onClose: () => void },
  ): SettingsSelectPopover;
  colorPicker?(value: string, host: HTMLElement, onChange: (value: string) => void): HTMLElement;
}
