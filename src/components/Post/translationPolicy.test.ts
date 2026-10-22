import {
  decideTranslation,
  hasForeignScript,
  normalizeForCompare,
  translationDiffers,
  viewerPrimaryOf,
} from './translationPolicy'

describe('normalizeForCompare', () => {
  it('lowercase-collapses whitespace and trims', () => {
    expect(normalizeForCompare('  Hello   WORLD\n')).toBe('hello world')
  })
})

describe('hasForeignScript', () => {
  it('latin-only text is not foreign', () => {
    expect(hasForeignScript('Hello world 123')).toBe(false)
  })
  it('cyrillic text is foreign', () => {
    expect(hasForeignScript('Привіт світ')).toBe(true)
  })
})

describe('translationDiffers', () => {
  it('iso code equal to the viewer primary does not differ', () => {
    expect(translationDiffers('en', 'en')).toBe(false)
  })
  it('display name equal to the viewer language does not differ', () => {
    expect(translationDiffers('English', 'en')).toBe(false)
    expect(translationDiffers('Chinese', 'zh')).toBe(false)
  })
  it('other languages differ', () => {
    expect(translationDiffers('es', 'en')).toBe(true)
    expect(translationDiffers('German', 'en')).toBe(true)
  })
  it('null sourceLang shows rather than hides', () => {
    expect(translationDiffers(null, 'en')).toBe(true)
  })
})

describe('viewerPrimaryOf', () => {
  it('takes the primary subtag, lowercased', () => {
    expect(viewerPrimaryOf('zh-CN')).toBe('zh')
    expect(viewerPrimaryOf('en')).toBe('en')
    expect(viewerPrimaryOf('pt_BR')).toBe('pt')
  })
  it('falls back to en', () => {
    expect(viewerPrimaryOf(null)).toBe('en')
    expect(viewerPrimaryOf('')).toBe('en')
  })
})

describe('decideTranslation', () => {
  it('hides byte-equal output even with a foreign sourceLang claim', () => {
    expect(decideTranslation('Hello world', {sourceLang: 'German', text: '  hello   WORLD '}, 'en')).toEqual({
      show: false,
    })
  })
  it('shows a differing language with its label', () => {
    expect(decideTranslation('Hello world', {sourceLang: 'es', text: 'Hola mundo'}, 'en')).toEqual({
      show: true,
      label: 'es',
    })
  })
  it('hides a same-language rewrite of same-script text', () => {
    expect(decideTranslation('webdev tools', {sourceLang: 'English', text: 'web dev tools v2'}, 'en')).toEqual({
      show: false,
    })
  })
  it('shows a substantially rewritten foreign-script post with a generic label', () => {
    expect(
      decideTranslation('Привіт, як справи у світі програмування', {sourceLang: 'English', text: 'Completely different english text about cats'}, 'en'),
    ).toEqual({show: true, label: null})
  })
  it('hides empty results', () => {
    expect(decideTranslation('Hello', {sourceLang: 'es', text: '   '}, 'en')).toEqual({show: false})
  })
})
