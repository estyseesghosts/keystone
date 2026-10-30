// Collection selection (P6.6 slice 2): pure reducer over ordered keys.
// Click = single, toggle = ctrl/cmd-click or native selection tap,
// range = shift-click from the anchor, all/clear. Esc clears (web, wired
// by the screens). A filter change (`setOrder`) drops selected keys that
// vanished, keeping the anchor when it survives.

export interface CollectionSelection {
  /** Ordered keys (filter order). */
  order: string[];
  /** Selected keys, in order. */
  selected: string[];
  /** Shift-range anchor (last clicked key). */
  anchor: string | null;
  /** Native long-press selection mode. */
  mode: boolean;
}

export type SelectionAction =
  | {type: 'setOrder'; order: string[]}
  | {type: 'click'; key: string}
  | {type: 'toggle'; key: string}
  | {type: 'range'; key: string}
  | {type: 'all'}
  | {type: 'clear'}
  | {type: 'enterMode'; key: string}
  | {type: 'exitMode'};

export function initSelection(order: string[] = []): CollectionSelection {
  return {order, selected: [], anchor: null, mode: false};
}

function inOrder(state: CollectionSelection, selected: string[]): string[] {
  const rank = new Map(state.order.map((k, i) => [k, i]));
  return [...selected].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

function span(order: string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return order.slice(lo, hi + 1);
}

export function selectionReducer(state: CollectionSelection, action: SelectionAction): CollectionSelection {
  switch (action.type) {
    case 'setOrder': {
      const keep = new Set(action.order);
      const selected = state.selected.filter(k => keep.has(k));
      return {
        order: action.order,
        selected,
        anchor: state.anchor && keep.has(state.anchor) ? state.anchor : null,
        mode: state.mode && selected.length > 0,
      };
    }
    case 'click':
      return {...state, selected: [action.key], anchor: action.key, mode: false};
    case 'toggle': {
      const has = state.selected.includes(action.key);
      const selected = has
        ? state.selected.filter(k => k !== action.key)
        : inOrder(state, [...state.selected, action.key]);
      // Selection mode (native) survives toggles until the set empties;
      // web ctrl/cmd-click never enters it (stays as it was).
      return {...state, selected, anchor: action.key, mode: state.mode && selected.length > 0};
    }
    case 'range': {
      const anchor = state.anchor ?? action.key;
      return {...state, selected: span(state.order, anchor, action.key), anchor, mode: true};
    }
    case 'all':
      return {...state, selected: [...state.order], anchor: state.order[state.order.length - 1] ?? null, mode: state.order.length > 0};
    case 'clear':
      return {...state, selected: [], anchor: null, mode: false};
    case 'enterMode': {
      const selected = state.selected.includes(action.key)
        ? state.selected
        : inOrder(state, [...state.selected, action.key]);
      return {...state, selected, anchor: action.key, mode: true};
    }
    case 'exitMode':
      return {...state, selected: [], anchor: null, mode: false};
  }
}

/** True when the checkbox/selection UI shows (native mode or web hover is
 * component state; this is the data half). Pure. */
export function isSelected(state: CollectionSelection, key: string): boolean {
  return state.selected.includes(key);
}
