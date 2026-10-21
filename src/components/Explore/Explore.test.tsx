import {fireEvent, render, screen} from '@testing-library/react-native'

import {makeAccount} from '#/components/__tests__/fixtures'

import {ExploreSearchBar} from './ExploreSearchBar'
import {ExploreSuggestPopup} from './ExploreSuggestPopup'
import {ExploreTabBar} from './ExploreTabBar'
import {suggestTrigger, applySuggestion} from './suggest'

describe('suggestTrigger', () => {
  it('finds a trailing #tag token', () => {
    expect(suggestTrigger('hello #ca', 9)).toEqual({kind: 'tag', prefix: 'ca', start: 6})
  })

  it('finds a trailing @account token', () => {
    expect(suggestTrigger('@bo', 3)).toEqual({kind: 'account', prefix: 'bo', start: 0})
  })

  it('returns null without a trigger token', () => {
    expect(suggestTrigger('hello world', 11)).toBeNull()
    expect(suggestTrigger('', 0)).toBeNull()
  })

  it('returns null for a bare # with no prefix', () => {
    expect(suggestTrigger('hello #', 7)).toBeNull()
  })

  it('uses the cursor, not the end of the string', () => {
    expect(suggestTrigger('hello #ca world', 9)).toEqual({kind: 'tag', prefix: 'ca', start: 6})
    expect(suggestTrigger('hello #ca world', 15)).toBeNull()
  })
})

describe('applySuggestion', () => {
  it('splices the completion over the token with a trailing space', () => {
    const trigger = suggestTrigger('hello #ca', 9)!
    expect(applySuggestion('hello #ca', 9, trigger, '#cats')).toEqual({
      value: 'hello #cats ',
      cursor: 12,
    })
  })

  it('does not double a space already after the cursor', () => {
    const trigger = suggestTrigger('hi @bo there', 6)!
    expect(applySuggestion('hi @bo there', 6, trigger, '@bob')).toEqual({
      value: 'hi @bob there',
      cursor: 7,
    })
  })
})

describe('ExploreSearchBar', () => {
  it('disables submit on an empty query and calls submit/clear', () => {
    const onSubmit = jest.fn()
    const onClear = jest.fn()
    const onChangeText = jest.fn()
    const {rerender} = render(
      <ExploreSearchBar value="" onChangeText={onChangeText} onSubmit={onSubmit} onClear={onClear} />,
    )
    expect(screen.getByTestId('explore-search-submit').props.accessibilityState.disabled).toBe(true)
    expect(screen.queryByTestId('explore-search-clear')).toBeNull()
    fireEvent.changeText(screen.getByTestId('explore-search-input'), 'cats')
    expect(onChangeText).toHaveBeenCalledWith('cats')
    rerender(
      <ExploreSearchBar value="cats" onChangeText={onChangeText} onSubmit={onSubmit} onClear={onClear} />,
    )
    fireEvent.press(screen.getByTestId('explore-search-submit'))
    expect(onSubmit).toHaveBeenCalled()
    fireEvent.press(screen.getByTestId('explore-search-clear'))
    expect(onClear).toHaveBeenCalled()
  })
})

describe('ExploreTabBar', () => {
  it('renders only the given tabs and reports presses', () => {
    const onChange = jest.fn()
    render(<ExploreTabBar tabs={['users', 'tags', 'posts']} active="posts" onChange={onChange} />)
    expect(screen.getByTestId('explore-tab-users')).toBeTruthy()
    expect(screen.queryByTestId('explore-tab-news')).toBeNull()
    fireEvent.press(screen.getByTestId('explore-tab-tags'))
    expect(onChange).toHaveBeenCalledWith('tags')
  })
})

describe('ExploreSuggestPopup', () => {
  it('renders nothing without suggestions', () => {
    render(<ExploreSuggestPopup tags={null} accounts={null} activeIndex={0} onPick={() => {}} />)
    expect(screen.queryByTestId('explore-suggest')).toBeNull()
  })

  it('lists tag names and picks by index', () => {
    const onPick = jest.fn()
    render(
      <ExploreSuggestPopup tags={['cats', 'catstodon']} accounts={null} activeIndex={0} onPick={onPick} />,
    )
    expect(screen.getByTestId('explore-suggest-0')).toBeTruthy()
    fireEvent.press(screen.getByTestId('explore-suggest-1'))
    expect(onPick).toHaveBeenCalledWith(1)
  })

  it('lists account candidates', () => {
    const onPick = jest.fn()
    const account = makeAccount({id: 'b1', username: 'bob', acct: 'bob@example.social'})
    render(<ExploreSuggestPopup tags={null} accounts={[account]} activeIndex={0} onPick={onPick} />)
    expect(screen.getByText('@bob@example.social')).toBeTruthy()
    fireEvent.press(screen.getByTestId('explore-suggest-0'))
    expect(onPick).toHaveBeenCalledWith(0)
  })
})
