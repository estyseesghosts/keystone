// Page editor formatting toolbar (P6.5 Pages, slice 5): the §1 MFM
// subset controls. Applies via `mfmFormat.applyFormat`; active state via
// `activeFormats`. Web buttons use `onMouseDown preventDefault` so the
// press never steals the input's selection (falls back to the last
// stored selection). Link prompts for an http(s) URL (`safeHttpUrl`).

import {useState} from 'react'
import {Platform, ScrollView, View} from 'react-native'
import {msg} from '@lingui/macro'

import {activeFormats, applyFormat, safeHttpUrl, type FormatControl, type TextSelection} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {Dialog} from '#/components/Dialog'
import {
  BoldIcon,
  CenterIcon,
  CodeBlockIcon,
  CodeIcon,
  ItalicIcon,
  LinkIcon,
  QuoteIcon,
  SmallIcon,
  StrikeIcon,
  type IconProps,
} from '#/components/icons'
import {Pressable} from '#/components/Pressable'
import {i18n} from '#/locale/i18n'

export const FORMAT_CONTROLS: FormatControl[] = [
  'bold',
  'italic',
  'strike',
  'code',
  'codeblock',
  'quote',
  'link',
  'center',
  'small',
]

const FORMAT_ICON: Record<FormatControl, (p: IconProps) => React.ReactElement> = {
  bold: BoldIcon,
  italic: ItalicIcon,
  strike: StrikeIcon,
  code: CodeIcon,
  codeblock: CodeBlockIcon,
  quote: QuoteIcon,
  link: LinkIcon,
  center: CenterIcon,
  small: SmallIcon,
}

export function formatControlLabel(control: FormatControl): string {
  switch (control) {
    case 'bold':
      return i18n._(msg`Bold`)
    case 'italic':
      return i18n._(msg`Italic`)
    case 'strike':
      return i18n._(msg`Strikethrough`)
    case 'code':
      return i18n._(msg`Code`)
    case 'codeblock':
      return i18n._(msg`Code block`)
    case 'quote':
      return i18n._(msg`Quote`)
    case 'link':
      return i18n._(msg`Link`)
    case 'center':
      return i18n._(msg`Center`)
    case 'small':
      return i18n._(msg`Small`)
  }
}

/** Apply one control; returns the next text + caret. Pure. */
export function applyFormatControl(
  text: string,
  selection: TextSelection,
  control: FormatControl,
  url?: string,
): {text: string; selection: TextSelection} {
  const out = applyFormat(text, selection, control, url)
  return {text: out.text, selection: out.selection}
}

export function FormatToolbar({
  text,
  selection,
  onApply,
  testID,
}: {
  text: string
  selection: TextSelection
  /** Apply `control` to the current text+selection (link opens the URL dialog first). */
  onApply: (control: FormatControl, url?: string) => void
  testID?: string
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const active = activeFormats(text, selection)
  const theme = useTheme()

  const press = (control: FormatControl) => {
    if (control === 'link') {
      const sel = text.slice(selection.start, selection.end)
      setLinkUrl(safeHttpUrl(sel) ?? '')
      setLinkError(null)
      setLinkOpen(true)
      return
    }
    onApply(control)
  }

  const submitLink = () => {
    const url = safeHttpUrl(linkUrl)
    if (!url) {
      setLinkError(i18n._(msg`Enter an http(s) URL.`))
      return
    }
    setLinkOpen(false)
    onApply('link', url)
  }

  return (
    <View testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{flexDirection: 'row', alignItems: 'center', gap: 2}}>
        {FORMAT_CONTROLS.map(control => {
          const Icon = FORMAT_ICON[control]
          const on = active.includes(control)
          return (
            <Pressable
              key={control}
              onPress={() => press(control)}
              // Web: keep the input's selection (the button must not focus).
              {...(Platform.OS === 'web'
                ? {onMouseDown: (e: {preventDefault: () => void}) => e.preventDefault()}
                : {})}
              accessibilityRole="button"
              accessibilityState={{selected: on}}
              accessibilityLabel={formatControlLabel(control)}
              hitSlop={6}
              style={{width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center'}}
              testID={testID ? `${testID}-${control}` : undefined}>
              <Icon size={18} color={on ? theme.palette.text : theme.palette.muted} />
            </Pressable>
          )
        })}
      </ScrollView>
      {linkOpen ? (
        <Dialog open onClose={() => setLinkOpen(false)} title={i18n._(msg`Link URL`)} testID={testID ? `${testID}-link` : undefined}>
          <TextField
            label={i18n._(msg`URL`)}
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="https://"
            error={linkError ?? undefined}
            testID={testID ? `${testID}-link-url` : undefined}
          />
          <Button
            label={i18n._(msg`Insert link`)}
            variant="primary"
            onPress={submitLink}
            testID={testID ? `${testID}-link-insert` : undefined}
          />
        </Dialog>
      ) : null}
    </View>
  )
}
