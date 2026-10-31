// P6.6 slice 8: DnD factories — file/item routing, invalid rejection,
// text ignored. The DropZone wrapper renders its DOM handlers as props,
// so jsdom-style tests invoke them directly with fake dataTransfer.

import React from 'react';
import {Platform, View} from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';

import {dragSourceDomProps} from './Tile';
import {DropZone, dropTargetDomProps} from './DropZone.web';

const OS = Platform.OS;

beforeEach(() => {
  Platform.OS = 'web';
});

afterEach(() => {
  Platform.OS = OS;
});

function fileDt(files: Array<{name: string}>) {
  return {types: ['Files'], files};
}

function keysDt(keys: string[]) {
  return {types: ['application/x-keystone-keys'], getData: () => JSON.stringify(keys)};
}

describe('dragSourceDomProps', () => {
  it('sets the key payload and move effect', () => {
    const setData = jest.fn();
    const dt = {setData, effectAllowed: ''};
    const props = dragSourceDomProps(['a', 'b']);
    (props.onDragStart as (e: unknown) => void)({dataTransfer: dt});
    expect(setData).toHaveBeenCalledWith('application/x-keystone-keys', '["a","b"]');
    expect(dt.effectAllowed).toBe('move');
    // Reset the module in-flight drag so later tests start clean.
    (props.onDragEnd as () => void)();
  });
});

describe('dropTargetDomProps', () => {
  it('routes OS files to onFiles with the target folder', () => {
    const onFiles = jest.fn();
    const onItems = jest.fn();
    const props = dropTargetDomProps({
      targetKey: 'd9',
      getDraggedKeys: () => [],
      isValidTarget: () => true,
      onFiles,
      onItems,
    });
    const preventDefault = jest.fn();
    const stopPropagation = jest.fn();
    (props.onDrop as (e: unknown) => void)({
      preventDefault,
      stopPropagation,
      dataTransfer: fileDt([{name: 'a.png'}]),
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(onFiles).toHaveBeenCalledWith([{name: 'a.png'}], 'd9');
    expect(onItems).not.toHaveBeenCalled();
  });

  it('routes our key payload to onItems, ignored when the target is invalid', () => {
    const onFiles = jest.fn();
    const onItems = jest.fn();
    const valid = dropTargetDomProps({
      targetKey: 'd2',
      getDraggedKeys: () => ['d1'],
      isValidTarget: (t, keys) => !(t != null && keys.includes(t as string)),
      onFiles,
      onItems,
    });
    const over = {preventDefault: jest.fn(), dataTransfer: {dropEffect: ''}};
    (valid.onDragOver as (e: unknown) => void)(over);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    (valid.onDrop as (e: unknown) => void)({
      preventDefault: jest.fn(),
      dataTransfer: keysDt(['d1']),
    });
    expect(onItems).toHaveBeenCalledWith(['d1'], 'd2');

    const invalid = dropTargetDomProps({
      targetKey: 'd1',
      getDraggedKeys: () => ['d1'],
      isValidTarget: (t, keys) => !(t != null && keys.includes(t as string)),
      onFiles,
      onItems,
    });
    const overBad = {preventDefault: jest.fn(), dataTransfer: {dropEffect: ''}};
    (invalid.onDragOver as (e: unknown) => void)(overBad);
    expect(overBad.dataTransfer.dropEffect).toBe('none');
    (invalid.onDrop as (e: unknown) => void)({
      preventDefault: jest.fn(),
      dataTransfer: keysDt(['d1']),
    });
    expect(onItems).toHaveBeenCalledTimes(1);
  });

  it('ignores text/link drags', () => {
    const onFiles = jest.fn();
    const onItems = jest.fn();
    const props = dropTargetDomProps({
      targetKey: null,
      getDraggedKeys: () => [],
      isValidTarget: () => true,
      onFiles,
      onItems,
    });
    (props.onDrop as (e: unknown) => void)({
      preventDefault: jest.fn(),
      dataTransfer: {types: ['text/plain'], getData: () => 'https://example.com'},
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(onItems).not.toHaveBeenCalled();
  });
});

describe('DropZone wrapper', () => {
  it('shows the target overlay while dragging over, hides on drop', () => {
    render(
      <DropZone
        targetKey="d9"
        targetName="Nine"
        draggedKeys={() => []}
        onFiles={() => {}}
        onItems={() => {}}
        testID="dz">
        <View testID="dz-child" />
      </DropZone>,
    );
    expect(screen.queryByTestId('dz-overlay')).toBeNull();
    fireEvent(screen.getByTestId('dz'), 'dragEnter', {preventDefault: () => {}});
    expect(screen.getByTestId('dz-overlay')).toBeTruthy();
    fireEvent(screen.getByTestId('dz'), 'dragLeave', {preventDefault: () => {}});
    expect(screen.queryByTestId('dz-overlay')).toBeNull();
  });
});
