// P6.6 slice 2: selection reducer — click/toggle/range/all/clear,
// filter-change pruning, anchor survival.

import {initSelection, isSelected, selectionReducer} from './useSelection';

const ORDER = ['a', 'b', 'c', 'd'];

describe('selectionReducer', () => {
  it('click selects one and sets the anchor', () => {
    const st = selectionReducer(initSelection(ORDER), {type: 'click', key: 'b'});
    expect(st.selected).toEqual(['b']);
    expect(st.anchor).toBe('b');
  });

  it('toggle adds/removes, keeps anchor, empties mode', () => {
    let st = selectionReducer(initSelection(ORDER), {type: 'enterMode', key: 'a'});
    st = selectionReducer(st, {type: 'toggle', key: 'c'});
    expect(st.selected).toEqual(['a', 'c']);
    expect(st.mode).toBe(true);
    st = selectionReducer(st, {type: 'toggle', key: 'a'});
    expect(st.selected).toEqual(['c']);
    expect(st.anchor).toBe('a');
    st = selectionReducer(st, {type: 'toggle', key: 'c'});
    expect(st.selected).toEqual([]);
    expect(st.mode).toBe(false);
  });

  it('range spans anchor to key in both directions', () => {
    const st0 = selectionReducer(initSelection(ORDER), {type: 'click', key: 'c'});
    expect(selectionReducer(st0, {type: 'range', key: 'a'}).selected).toEqual(['a', 'b', 'c']);
    expect(selectionReducer(st0, {type: 'range', key: 'd'}).selected).toEqual(['c', 'd']);
  });

  it('all selects everything; clear empties; exitMode drops mode', () => {
    let st = selectionReducer(initSelection(ORDER), {type: 'all'});
    expect(st.selected).toEqual(ORDER);
    expect(st.mode).toBe(true);
    st = selectionReducer(st, {type: 'clear'});
    expect(st.selected).toEqual([]);
    expect(st.anchor).toBeNull();
    st = selectionReducer(selectionReducer(initSelection(ORDER), {type: 'enterMode', key: 'a'}), {type: 'exitMode'});
    expect(st).toEqual({order: ORDER, selected: [], anchor: null, mode: false});
  });

  it('setOrder drops vanished keys and a lost anchor; keeps survivors', () => {
    let st = selectionReducer(initSelection(ORDER), {type: 'click', key: 'b'});
    st = selectionReducer(st, {type: 'toggle', key: 'd'});
    // Anchor follows the last interaction ('d'), which the new order drops.
    st = selectionReducer(st, {type: 'setOrder', order: ['b', 'e']});
    expect(st.selected).toEqual(['b']);
    expect(st.anchor).toBeNull();
    st = selectionReducer(st, {type: 'setOrder', order: ['e']});
    expect(st.selected).toEqual([]);
    expect(st.anchor).toBeNull();
  });

  it('isSelected reads the set', () => {
    const st = selectionReducer(initSelection(ORDER), {type: 'click', key: 'a'});
    expect(isSelected(st, 'a')).toBe(true);
    expect(isSelected(st, 'b')).toBe(false);
  });
});
