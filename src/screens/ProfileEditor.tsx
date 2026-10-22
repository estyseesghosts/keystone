// Profile editor screen (C13, route `ProfileEdit`): name, bio, locked,
// bot, profile fields, plus the Misskey-family extras (location,
// birthday, followed message, language) where the backend supports them.
// Avatar and banner are REAL uploads on both families (clickstone §1.8):
// the picker only appears when the backend implements
// `uploadProfileImage`, the file goes through that seam (never a family
// wire type here), progress and failures are shown on the row, and the
// image is uploaded on pick — no full save round-trip, and the unsaved
// text fields are never re-seeded. Where a family has no image endpoint
// the row stays visible, disabled, with its reason.
//
// Save calls `backend.updateProfile` with only the keys the active
// family accepts, surfaces permission/validation errors honestly, and
// navigates back on success.
//
// Consumes the frozen interfaces as-is: session/backend via the existing
// `useActiveBackend()` (`#/screens/HomeFeed`) and `useActiveSession()`
// (`#/state/session/SessionProvider`), exit via `navigation.goBack()`.
import {useContext, useEffect, useState, type ReactNode} from 'react'
import {Pressable, ScrollView, StyleSheet, View} from 'react-native'
import {QueryClientContext} from '@tanstack/react-query'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {
  displayNameOf,
  isPermissionError,
  type Account,
  type ProfileImageKind,
  type ProfileUpdate,
} from '@keystone/fedi'

import {useTheme as useAlfTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {overlayChrome} from '#/alf/themes'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {ProfileAvatar} from '#/components/Profile/ProfileAvatar'
import {ProfileBanner} from '#/components/Profile/ProfileBanner'
import {
  EditorImageRow,
  EditorSwitchRow,
  EditorTextRow,
} from '#/components/Profile/ProfileEditorRows'
import {pickProfileImage} from '#/components/Profile/pickProfileImage'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useActiveSession} from '#/state/session/SessionProvider'
import {accountQueryKey, meQueryKey} from '#/state/queries/keys'

interface FieldPair {
  name: string
  value: string
}

function pairsOf(account: Account, cap: number): FieldPair[] {
  return account.fields.slice(0, cap).map(f => ({name: f.name, value: f.value}))
}

function extStr(account: Account, key: string): string {
  const v: unknown = (account.ext.me ?? {})[key]
  return typeof v === 'string' ? v : ''
}

export function ProfileEditorScreen() {
  const nav = useNavigation<NavigationProp<RootParamList>>()
  const alf = useAlfTheme()
  const {backend} = useActiveBackend()
  const session = useActiveSession()
  const isMastodon = (session?.family ?? backend?.family) === 'mastodon'
  const fieldCap = isMastodon ? 4 : 16

  const [me, setMe] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [locked, setLocked] = useState(false)
  const [bot, setBot] = useState(false)
  const [location, setLocation] = useState('')
  const [birthday, setBirthday] = useState('')
  const [followedMessage, setFollowedMessage] = useState('')
  const [lang, setLang] = useState('')
  const [fields, setFields] = useState<FieldPair[]>([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Profile images (clickstone §1.8). One upload at a time: `uploading`
  // names the image in flight, so both rows show why they cannot start a
  // second one. Previews are local-first (the picked URI) and then switch
  // to the URL the server returned; an error reverts to the last confirmed
  // picture rather than leaving a lie on screen.
  const [uploading, setUploading] = useState<ProfileImageKind | null>(null)
  const [imageErrors, setImageErrors] = useState<Record<ProfileImageKind, string | null>>({
    avatar: null,
    banner: null,
  })
  const [imagePreviews, setImagePreviews] = useState<Record<ProfileImageKind, string | null>>({
    avatar: null,
    banner: null,
  })
  // Optional provider (bare test trees have none): the cache refresh is a
  // best-effort courtesy, never a reason to fail the upload.
  const queryClient = useContext(QueryClientContext)

  useEffect(() => {
    let cancelled = false
    if (!backend) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    backend
      .me()
      .then(account => {
        if (cancelled) return
        setMe(account)
        setName(account.name ?? '')
        setBio(account.bio.plain ?? '')
        setLocked(account.locked)
        setBot(account.bot)
        setLocation(account.location ?? '')
        setBirthday(account.birthday ?? '')
        setFollowedMessage(extStr(account, 'followedMessage'))
        setLang(extStr(account, 'lang'))
        setFields(pairsOf(account, fieldCap))
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Could not load your profile.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Load once per backend identity; the family switch re-seeds the form.
  }, [backend])

  // v1-style overlay: the `ProfileEdit` route is a transparent modal, so
  // this screen renders as a floating card over a dismissible scrim. Every
  // body branch (signed-out, loading, error, form) renders inside it, so all
  // fields, gating, and testIDs stay exactly where they were.
  const overlay = (content: ReactNode) => (
    <View testID="profile-editor-overlay" style={styles.overlay}>
      <Pressable
        testID="profile-editor-backdrop"
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel="Close editor"
        onPress={() => nav.goBack()}
      />
      <View
        testID="profile-editor-card"
        style={[styles.card, {backgroundColor: alf.palette.bg, borderColor: alf.palette.border}]}>
        <View style={styles.cardBar}>
          <Pressable
            testID="profile-editor-close"
            accessibilityRole="button"
            accessibilityLabel="Close editor"
            hitSlop={8}
            onPress={() => nav.goBack()}>
            <Body>Close</Body>
          </Pressable>
        </View>
        {content}
      </View>
    </View>
  )

  if (!backend) {
    return overlay(
      <View testID="profile-editor" style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>Sign in to edit your profile.</Body>
        <Button label="Back" variant="secondary" onPress={() => nav.goBack()} testID="profile-editor-back" />
      </View>,
    )
  }

  if (loading) {
    return overlay(
      <View testID="profile-editor" style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Loader testID="profile-editor-loading" />
      </View>,
    )
  }

  if (loadError || !me) {
    return overlay(
      <View testID="profile-editor" style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>Could not load your profile.</Body>
        <Caption color="faint">{loadError}</Caption>
        <Button label="Back" variant="secondary" onPress={() => nav.goBack()} testID="profile-editor-back" />
      </View>,
    )
  }

  const setField = (index: number, patch: Partial<FieldPair>) => {
    setFields(prev => prev.map((f, i) => (i === index ? {...f, ...patch} : f)))
  }

  const save = () => {
    if (saving) return
    setSaving(true)
    setError(null)
    const patch: ProfileUpdate = {
      name: name.trim(),
      bio: bio.trim(),
      locked,
      bot,
      fields: fields
        .filter(f => f.name.trim().length > 0 || f.value.trim().length > 0)
        .map(f => ({name: f.name.trim(), value: f.value.trim()})),
    }
    if (!isMastodon) {
      // Misskey-family `i/update` keys (the backend passes them through;
      // Mastodon's `update_credentials` has no equivalent, so these rows
      // render disabled there instead of being silently dropped).
      patch.location = location.trim()
      patch.birthday = birthday.trim() === '' ? null : birthday.trim()
      patch.followedMessage = followedMessage === '' ? null : followedMessage
      patch.lang = lang.trim() === '' ? null : lang.trim()
    }
    void backend
      .updateProfile(patch)
      .then(
        () => {
          nav.goBack()
        },
        (err: unknown) => {
          if (isPermissionError(err)) {
            setError('You do not have permission to update this profile. Sign in again and retry.')
          } else if (err instanceof Error) {
            setError(err.message)
          } else {
            setError('Could not save your profile.')
          }
        },
      )
      .finally(() => {
        setSaving(false)
      })
  }

  const misskeyOnlyReason = 'Only available on Misskey-family servers.'
  const uploadProfileImage = backend.uploadProfileImage
  const imageDisabledReason = uploadProfileImage
    ? undefined
    : 'This server has no endpoint for profile pictures, so they cannot be changed here.'

  /** Pick and upload one image. Uploads on pick — the text fields below
   * keep their unsaved values because nothing here re-seeds them. */
  const changeImage = async (kind: ProfileImageKind) => {
    if (!backend || uploading) return
    const setImageError = (message: string | null) =>
      setImageErrors(prev => ({...prev, [kind]: message}))
    setImageError(null)
    let picked: Awaited<ReturnType<typeof pickProfileImage>>
    try {
      picked = await pickProfileImage()
    } catch (err) {
      setImageError(
        err instanceof Error ? err.message : 'Could not open the photo picker.',
      )
      return
    }
    if (picked.kind === 'cancelled') return
    if (picked.kind === 'denied') {
      setImageError(
        picked.canAskAgain
          ? 'Photo access was denied. Try again and allow access when your device asks.'
          : 'Photo access is off for this app. Allow it in your device settings to change your picture.',
      )
      return
    }
    if (!uploadProfileImage) {
      setImageError(imageDisabledReason ?? 'Profile pictures cannot be changed on this server.')
      return
    }

    const localUri = picked.file.previewUri
    if (localUri) setImagePreviews(prev => ({...prev, [kind]: localUri}))
    setUploading(kind)
    try {
      const updated = await uploadProfileImage(kind, picked.file.file)
      setMe(updated)
      // The server's URL is the truth (Mastodon processing can still answer
      // null: keep the local pick visible rather than blanking the row).
      const serverUri = kind === 'avatar' ? updated.avatarUrl : updated.headerUrl
      setImagePreviews(prev => ({...prev, [kind]: serverUri ?? prev[kind]}))
      if (queryClient && session) {
        queryClient.setQueryData(meQueryKey(session.id), updated)
        // The profile header/other screens read the account row.
        void queryClient.invalidateQueries({
          queryKey: accountQueryKey(session.id, updated.id),
        })
      }
    } catch (err) {
      if (isPermissionError(err)) {
        setImageError(
          'Your sign-in is missing the permission to change profile pictures. Sign in again and retry.',
        )
      } else if (err instanceof Error) {
        setImageError(err.message)
      } else {
        setImageError('Could not upload that picture.')
      }
      // Nothing changed server-side: fall back to the last confirmed image.
      setImagePreviews(prev => ({...prev, [kind]: null}))
    } finally {
      setUploading(null)
    }
  }

  const previewUriFor = (kind: ProfileImageKind) =>
    imagePreviews[kind] ?? (kind === 'avatar' ? me.avatarUrl : me.headerUrl)

  return overlay(
    <ScrollView testID="profile-editor" style={atoms.flex1}>
      <View style={[atoms.gap_sm, atoms.p_md]}>
        <Heading>Edit profile</Heading>
        <Caption color="faint">
          {isMastodon ? 'Mastodon server' : 'Misskey-family server'} · @{me.acct}
        </Caption>

        <EditorTextRow
          label="Display name"
          value={name}
          onChangeText={setName}
          placeholder={me.username}
          testID="profile-editor-name"
        />
        <EditorTextRow
          label={isMastodon ? 'Bio' : 'Bio (MFM)'}
          value={bio}
          onChangeText={setBio}
          multiline
          testID="profile-editor-bio"
        />
        <EditorSwitchRow
          label="Locked account"
          hint="Require approval for new followers."
          value={locked}
          onValueChange={setLocked}
          testID="profile-editor-locked"
        />
        <EditorSwitchRow
          label="Automated account"
          hint="Mark this account as a bot."
          value={bot}
          onValueChange={setBot}
          testID="profile-editor-bot"
        />

        <EditorTextRow
          label="Location"
          value={location}
          onChangeText={isMastodon ? undefined : setLocation}
          editable={!isMastodon}
          disabledReason={isMastodon ? misskeyOnlyReason : undefined}
          testID="profile-editor-location"
        />
        <EditorTextRow
          label="Birthday"
          value={birthday}
          onChangeText={isMastodon ? undefined : setBirthday}
          placeholder="YYYY-MM-DD"
          editable={!isMastodon}
          disabledReason={isMastodon ? misskeyOnlyReason : undefined}
          testID="profile-editor-birthday"
        />
        <EditorTextRow
          label="Followed message"
          value={followedMessage}
          onChangeText={isMastodon ? undefined : setFollowedMessage}
          editable={!isMastodon}
          disabledReason={isMastodon ? misskeyOnlyReason : undefined}
          testID="profile-editor-followedMessage"
        />
        <EditorTextRow
          label="Language"
          value={lang}
          onChangeText={isMastodon ? undefined : setLang}
          placeholder="en"
          editable={!isMastodon}
          disabledReason={isMastodon ? misskeyOnlyReason : undefined}
          testID="profile-editor-lang"
        />

        <View style={atoms.gap_sm}>
          <Caption>
            Profile fields ({fields.length}/{fieldCap})
          </Caption>
          {fields.map((f, i) => (
            <View key={i} style={atoms.gap_sm}>
              <EditorTextRow
                label={`Field ${i + 1} name`}
                value={f.name}
                onChangeText={text => setField(i, {name: text})}
                testID={`profile-editor-field-name-${i}`}
              />
              <EditorTextRow
                label={`Field ${i + 1} value`}
                value={f.value}
                onChangeText={text => setField(i, {value: text})}
                testID={`profile-editor-field-value-${i}`}
              />
              <Button
                label="Remove field"
                variant="secondary"
                onPress={() => setFields(prev => prev.filter((_, j) => j !== i))}
                testID={`profile-editor-field-remove-${i}`}
              />
            </View>
          ))}
          {fields.length < fieldCap ? (
            <Button
              label="Add field"
              variant="secondary"
              onPress={() => setFields(prev => [...prev, {name: '', value: ''}])}
              testID="profile-editor-field-add"
            />
          ) : (
            <Caption color="faint">
              This server allows at most {fieldCap} profile fields.
            </Caption>
          )}
        </View>

        <EditorImageRow
          label="Avatar"
          preview={
            <ProfileAvatar
              uri={previewUriFor('avatar')}
              name={displayNameOf(me)}
              testID="profile-editor-avatar-preview"
            />
          }
          chooseLabel={previewUriFor('avatar') ? 'Replace avatar' : 'Choose avatar'}
          uploading={uploading === 'avatar'}
          error={imageErrors.avatar}
          disabledReason={uploading === 'banner' ? 'Finish the banner upload first.' : imageDisabledReason}
          onChoose={() => void changeImage('avatar')}
          testID="profile-editor-avatar"
          errorTestID="profile-editor-avatar-error"
          progressTestID="profile-editor-avatar-progress"
        />
        <EditorImageRow
          label="Banner"
          preview={
            <ProfileBanner
              uri={previewUriFor('banner')}
              testID="profile-editor-banner-preview"
            />
          }
          chooseLabel={previewUriFor('banner') ? 'Replace banner' : 'Choose banner'}
          uploading={uploading === 'banner'}
          error={imageErrors.banner}
          disabledReason={uploading === 'avatar' ? 'Finish the avatar upload first.' : imageDisabledReason}
          onChoose={() => void changeImage('banner')}
          testID="profile-editor-banner"
          errorTestID="profile-editor-banner-error"
          progressTestID="profile-editor-banner-progress"
        />

        {error ? <Body testID="profile-editor-error">{error}</Body> : null}
        <Button
          label={saving ? 'Saving' : 'Save'}
          onPress={save}
          disabled={saving}
          testID="profile-editor-save"
        />
        <Button
          label="Cancel"
          variant="secondary"
          onPress={() => nav.goBack()}
          testID="profile-editor-cancel"
        />
      </View>
    </ScrollView>,
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    // Fixed light-on-dark chrome (`overlayChrome`): the scrim stays black
    // in both themes. No foreground text ever renders on it — the card
    // above carries its own paired theme background.
    backgroundColor: overlayChrome.backdrop,
    opacity: 0.5,
  },
  card: {
    flex: 1,
    width: '100%',
    maxWidth: 560,
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
})
