/** Calendar/time fields shared by input.time and input.session. Values remain
 * Pine epoch milliseconds and session strings; display uses browser local time
 * like Vela's native indicator dialog, without rounding stored timestamps. */
export interface TemporalPopoverHost {
  open(trigger: HTMLElement, content: HTMLElement, name: string): void;
  choices(trigger: HTMLElement, values: readonly string[], current: string, pick: (value: string) => void): void;
  close(): void;
}

const pad = (value: number) => String(value).padStart(2, '0');
const dateString = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const times = Array.from({ length: 48 }, (_, index) => `${pad(Math.floor(index / 2))}:${index % 2 ? '30' : '00'}`);

function normalizeTime(value: string): string | null {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(value.trim()) ?? /^(\d{2})(\d{2})$/.exec(value.trim());
  return parts && +parts[1]! < 24 && +parts[2]! < 60 ? `${pad(+parts[1]!)}:${parts[2]}` : null;
}

function normalizeDate(value: string): string | null {
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(value.trim())) return null;
  const [year, month, day] = value.trim().split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day
    ? dateString(date) : null;
}

function button(doc: Document, name: string, text: string): HTMLButtonElement {
  const result = doc.createElement('button');
  result.type = 'button'; result.setAttribute('aria-label', name); result.textContent = text;
  return result;
}

/** The reference calendar exposes date, month and decade selection. */
function calendar(doc: Document, current: string, onPick: (date: string) => void): HTMLElement {
  const root = doc.createElement('div'); root.className = 'quant-backtest-settings-calendar';
  const selected = normalizeDate(current);
  const initial = selected ? new Date(`${selected}T12:00:00`) : new Date();
  let year = initial.getFullYear(); let month = initial.getMonth();
  let mode: 'date' | 'month' | 'year' = 'date';
  const months = Array.from({ length: 12 }, (_, index) => new Date(2024, index, 1).toLocaleString('en-US', { month: 'long' }));
  const head = doc.createElement('div'); head.className = 'quant-backtest-settings-calendar-head';
  const previous = button(doc, 'Previous month', ''); const next = button(doc, 'Next month', '');
  previous.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>';
  next.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>';
  const title = doc.createElement('span');
  const monthButton = button(doc, 'Choose month', ''); const yearButton = button(doc, 'Choose year', '');
  title.append(monthButton, yearButton); head.append(previous, title, next);
  const weekdays = doc.createElement('div'); weekdays.className = 'quant-backtest-settings-calendar-week';
  for (const text of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
    const day = doc.createElement('span'); day.textContent = text; weekdays.append(day);
  }
  const grid = doc.createElement('div');
  const paint = () => {
    const decade = Math.floor(year / 10) * 10;
    monthButton.hidden = mode !== 'date'; monthButton.textContent = months[month]!;
    yearButton.disabled = mode === 'year';
    yearButton.textContent = mode === 'year' ? `${decade}-${decade + 9}` : String(year);
    weekdays.hidden = mode !== 'date'; grid.replaceChildren();
    grid.className = `quant-backtest-settings-calendar-${mode === 'date' ? 'grid' : 'cells'}`;
    previous.setAttribute('aria-label', `Previous ${mode === 'date' ? 'month' : mode === 'month' ? 'year' : 'decade'}`);
    next.setAttribute('aria-label', `Next ${mode === 'date' ? 'month' : mode === 'month' ? 'year' : 'decade'}`);
    if (mode === 'date') {
      for (let i = 0; i < new Date(year, month, 1).getDay(); i++) grid.append(doc.createElement('span'));
      const today = dateString(new Date());
      for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
        const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
        const choice = button(doc, iso, String(day));
        choice.dataset.checked = String(iso === selected); choice.dataset.today = String(iso === today);
        choice.addEventListener('click', () => onPick(iso)); grid.append(choice);
      }
    } else if (mode === 'month') {
      months.forEach((label, index) => {
        const choice = button(doc, label, label.slice(0, 3));
        choice.addEventListener('click', () => { month = index; mode = 'date'; paint(); monthButton.focus(); });
        grid.append(choice);
      });
    } else {
      for (let value = decade - 1; value <= decade + 10; value++) {
        const choice = button(doc, String(value), String(value));
        if (value < decade || value > decade + 9) choice.dataset.outside = '';
        choice.addEventListener('click', () => { year = value; mode = 'month'; paint(); yearButton.focus(); });
        grid.append(choice);
      }
    }
  };
  const step = (direction: number) => {
    if (mode === 'date') { const date = new Date(year, month + direction, 1); year = date.getFullYear(); month = date.getMonth(); }
    else year += direction * (mode === 'year' ? 10 : 1);
    paint();
  };
  previous.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
  monthButton.addEventListener('click', () => { mode = 'month'; paint(); yearButton.focus(); });
  yearButton.addEventListener('click', () => { mode = 'year'; paint(); grid.querySelector('button')?.focus(); });
  paint(); root.append(head, weekdays, grid); return root;
}

function combo(
  doc: Document, name: string, value: string, kind: 'date' | 'time', disabled: boolean,
  host: TemporalPopoverHost, onChange: (value: string) => void,
): HTMLElement {
  const wrap = doc.createElement('span'); wrap.className = `quant-backtest-settings-combo quant-backtest-settings-combo-${kind}`;
  const input = doc.createElement('input'); input.type = 'text'; input.value = value;
  input.disabled = disabled; input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('aria-label', name);
  input.dataset.settingTemporal = kind;
  const trigger = button(doc, kind === 'date' ? `Open calendar for ${name}` : `Open time list for ${name}`, '');
  trigger.tabIndex = -1; trigger.disabled = disabled;
  trigger.innerHTML = kind === 'date'
    ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.4"/><path d="M5.2 1.8v2.8M10.8 1.8v2.8M2.2 6.8h11.6"/></svg>'
    : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.8V8l2.4 1.6"/></svg>';
  let committed = value;
  const pick = (next: string) => { committed = next; input.value = next; onChange(next); };
  const typed = () => {
    const next = kind === 'date' ? normalizeDate(input.value) : normalizeTime(input.value);
    if (!next) { input.value = committed; return; }
    input.value = next;
    if (next !== committed) pick(next);
  };
  const open = () => {
    if (disabled) return;
    if (kind === 'date') host.open(input, calendar(doc, committed, (next) => { pick(next); host.close(); input.focus(); }), `${name} calendar`);
    else host.choices(input, times, committed, (next) => { pick(next); input.focus(); });
  };
  input.addEventListener('change', typed);
  input.addEventListener('blur', typed);
  input.addEventListener('click', open);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); }
    if (event.key === 'Enter') { event.preventDefault(); typed(); host.close(); }
  });
  trigger.addEventListener('pointerdown', (event) => event.preventDefault());
  trigger.addEventListener('click', open);
  wrap.append(input, trigger); return wrap;
}

export function temporalField(model: HTMLInputElement, title: string, host: TemporalPopoverHost): HTMLElement {
  const isTime = model.dataset.settingType === 'time';
  const session = /^(\d{2})(\d{2})-(\d{2})(\d{2})(:[1-7]+)?$/.exec(model.value);
  // Keep more complex Pine sessions directly editable instead of silently
  // dropping day masks or extra intraday windows while merely opening them.
  if (!isTime && !session) return model;
  const doc = model.ownerDocument;
  const wrapper = doc.createElement('span'); wrapper.className = 'quant-backtest-settings-temporal';
  const raw = Number(model.value); const date = new Date(raw);
  if (isTime && !Number.isFinite(date.getTime())) return model;
  const emit = (value: string) => { model.value = value; model.dispatchEvent(new Event('change', { bubbles: true })); };
  let first = isTime ? dateString(date) : `${session![1]}:${session![2]}`;
  let last = isTime ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${session![3]}:${session![4]}`;
  const commit = () => emit(isTime ? String(new Date(`${first}T${last}:00`).getTime()) : `${first.replace(':', '')}-${last.replace(':', '')}${session![5] ?? ''}`);
  model.type = 'hidden'; model.tabIndex = -1;
  wrapper.append(model,
    combo(doc, `${title} ${isTime ? 'date' : 'start'}`, first, isTime ? 'date' : 'time', model.disabled, host, (value) => { first = value; commit(); }),
    combo(doc, `${title} ${isTime ? 'time' : 'end'}`, last, 'time', model.disabled, host, (value) => { last = value; commit(); }));
  return wrapper;
}
