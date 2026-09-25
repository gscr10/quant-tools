import { registerWidgetAction } from '@luxalgo/vela/plugin';

export function registerTemplateContribution(toggle: () => void): () => void {
  return registerWidgetAction({
    id: 'quant-templates',
    target: 'topbar',
    label: 'Indicator Templates',
    icon: 'quant-template',
    iconOnly: true,
    align: 'left',
    run: toggle,
  });
}
