import {safeDescriptorArg} from './safeDescriptor'

// R2.4: Tag and Explore search tabs share one sanitizer — `|` is the
// descriptor segment separator, never content.
describe('safeDescriptorArg', () => {
  it('leaves plain tags and queries untouched', () => {
    expect(safeDescriptorArg('cats')).toBe('cats')
    expect(safeDescriptorArg('hello world')).toBe('hello world')
  })

  it('replaces pipe separators so a tag cannot inject segments', () => {
    expect(safeDescriptorArg('a|b')).toBe('a b')
    expect(safeDescriptorArg('tag|search|x')).toBe('tag search x')
  })

  it('trims surrounding whitespace', () => {
    expect(safeDescriptorArg('  cats  ')).toBe('cats')
    expect(safeDescriptorArg('|||')).toBe('')
  })
})
