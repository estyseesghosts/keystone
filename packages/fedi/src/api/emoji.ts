// Emoji picker data + device-local list helpers. All pure.
//
// Ported from old Keystone `frontend/src/api/emoji.ts`, MINUS the seven
// code helpers slice 2.2 already ported to `misskey/emoji.ts` (re-exported
// here so picker call sites keep one import — never forked). The only
// behavioural change: `groupCustomByCategory` takes its "Uncategorized"
// label as a plain string (the data layer returns no localized strings;
// the UI localizes).

import {
  bareEmojiName,
  customEmojiNameFromReaction,
  stripEmojiColons,
} from "../misskey/emoji";
import type { CustomEmoji } from "../misskey/emoji";

export {
  bareEmojiName,
  customEmojiNameFromReaction,
  customReactionCode,
  isLocalEmojiHost,
  parseEmojiCode,
  stripEmojiColons,
} from "../misskey/emoji";
export type { CustomEmoji, ParsedEmojiCode } from "../misskey/emoji";

// Two emoji kinds flow through the picker:
// - Unicode presets: client-side, no server dependency. `QUICK_REACTIONS`
//   is the reaction picker's quick row (hearts live on the like button,
//   so they are excluded here); `COMPOSER_EMOJI` is the insert pool.
// - Custom emoji: `:name:` codes with packed image URLs from
//   `POST /api/emojis` (public, no auth — verified live on Sharkey).
//   Unknown `:code:` strings are never resolved to fabricated URLs:
//   without a packed URL they render as literal text.

/** The like reaction. The server normalizes ❤️ (U+2764 U+FE0F) to ❤
 * (U+2764), so the normalized form is canonical — optimistic client
 * state then matches the reconciled server state exactly. */
export const HEART_REACTION = "❤";

export function isHeartReaction(reaction: string | null): boolean {
  return reaction === "❤" || reaction === "❤️";
}

/** Whether the like button counts as active for the viewer's reaction:
 * the same emoji (bare `:name:` and local `:name@.:` compare equal),
 * or either heart form when the configured like is itself a heart
 * (covers ❤️→❤ server normalization). A legacy heart under a custom
 * like reads as unliked: clicking it upgrades the reaction via the
 * usual delete-then-create path. */
export function isLikeActive(
  likeEmoji: string,
  myReaction: string | null,
): boolean {
  if (myReaction == null) return false;
  if (sameEmojiKey(myReaction, likeEmoji)) return true;
  return isHeartReaction(myReaction) && isHeartReaction(likeEmoji);
}

/** Chip-row exclusion: hearts always (they live on the like button),
 * plus the configured custom like emoji (owner decision 2026-10-16:
 * the chosen like never appears as a chip either). Local `:name@.:`
 * and bare `:name:` compare equal; distinct remote hosts never do. */
export function shouldHideChip(key: string, likeEmoji: string): boolean {
  return isHeartReaction(key) || sameEmojiKey(key, likeEmoji);
}

/** Chips-row entries: every reaction with a positive count except the
 * like-kind ones (see `shouldHideChip`), sorted by count descending.
 * Tolerates a null/undefined map (servers can transiently pack one). */
export function visibleReactions(
  reactions: Record<string, number> | null | undefined,
  likeEmoji: string = HEART_REACTION,
): [string, number][] {
  return Object.entries(reactions ?? {})
    .filter(([key, count]) => count > 0 && !shouldHideChip(key, likeEmoji))
    .sort((a, b) => b[1] - a[1]);
}

/** Reaction quick row (unicode only — no server dependency). */
export const QUICK_REACTIONS = ["👍", "😆", "🤔", "😮", "🎉", "💢", "😥", "😇", "🍮"];

/** Composer insert pool (unicode only — no server dependency). */
export const COMPOSER_EMOJI = [
  "😀", "😂", "🥲", "😉", "😮", "😢", "🤔", "🙏",
  "👏", "👍", "🔥", "❤", "🎉", "👀", "💯", "💭",
];

export interface UnicodeEmojiGroup {
  category: string;
  items: string[];
}

/** Universal default unicode emojis available on any server, grouped the
 * way Misskey groups them. */
export const UNICODE_EMOJI_GROUPS: UnicodeEmojiGroup[] = [
  { category: "face", items: ["😀", "😬", "😁", "😂", "🤣", "🥳", "😃", "😄", "😅", "🥲", "😆", "😇", "😉", "😊", "🙂", "🙃", "☺️", "😋", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😜", "🤪", "🤨", "🧐", "😝", "😛", "🤑", "🤓", "🥸", "😎", "🤩", "🤡", "🤠", "🤗", "😏", "😶", "😐", "😑", "😒", "🙄", "🙂‍↔️", "🙂‍↕️", "🤔", "🤥", "🤭", "🤫", "🤬", "🤯", "😳", "🫪", "😞", "😟", "😠", "😡", "😔", "😕", "🙁", "☹", "😣", "😖", "😫", "😩", "🥺", "😤", "😮", "😱", "😨", "😰", "😯", "😦", "😧", "😢", "😥", "🤤", "😪", "🫩", "😓", "🥵", "🥶", "😭", "😵", "😲", "🤐", "🤢", "🤧", "🤮", "😷", "🤒", "🤕", "🥴", "🥱", "😴", "🫯", "👁️‍🗨️", "💤", "😶‍🌫️", "😮‍💨", "😵‍💫", "🫠", "🫢", "🫣", "🫡", "🫥", "🫤", "🥹", "🫨", "💩", "😈", "👿", "👹", "👺", "💀", "👻", "👽", "🤖", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾"] },
  { category: "people", items: ["🤲", "🙌", "👏", "👋", "🤙", "👍", "👎", "👊", "✊", "🤛", "🤜", "🫷", "🫸", "✌", "👌", "✋", "🤚", "👐", "💪", "🦾", "🙏", "🦶", "🦵", "🦿", "🤝", "☝", "👆", "👇", "👈", "👉", "🖕", "🖐", "🤟", "🤘", "🤞", "🖖", "✍", "🫰", "🫱", "🫲", "🫳", "🫴", "🫵", "🫶", "🤏", "🤌", "🤳", "💅", "👄", "🫦", "🦷", "👅", "👂", "🦻", "👃", "👁", "👀", "🧠", "🫀", "🫁", "👤", "👥", "🗣", "🫆", "👶", "🧒", "👦", "👧", "🧑", "👨", "👩", "🧑‍🦱", "👩‍🦱", "👨‍🦱", "🧑‍🦰", "👩‍🦰", "👨‍🦰", "👱", "👱‍♀️", "👱‍♂️", "🧑‍🦳", "👩‍🦳", "👨‍🦳", "🧑‍🦲", "👩‍🦲", "👨‍🦲", "🧔", "🧔‍♀️", "🧔‍♂️", "🧓", "👴", "👵", "👲", "🧕", "👳", "👳‍♀️", "👳‍♂️", "👮", "👮‍♀️", "👮‍♂️", "👷", "👷‍♀️", "👷‍♂️", "💂", "💂‍♀️", "💂‍♂️", "🕵", "🕵️‍♀️", "🕵️‍♂️", "🧑‍⚕️", "👩‍⚕️", "👨‍⚕️", "🧑‍🌾", "👩‍🌾", "👨‍🌾", "🧑‍🍳", "👩‍🍳", "👨‍🍳", "🧑‍🎓", "👩‍🎓", "👨‍🎓", "🧑‍🎤", "👩‍🎤", "👨‍🎤", "🧑‍🏫", "👩‍🏫", "👨‍🏫", "🧑‍🏭", "👩‍🏭", "👨‍🏭", "🧑‍💻", "👩‍💻", "👨‍💻", "🧑‍💼", "👩‍💼", "👨‍💼", "🧑‍🔧", "👩‍🔧", "👨‍🔧", "🧑‍🔬", "👩‍🔬", "👨‍🔬", "🧑‍🎨", "👩‍🎨", "👨‍🎨", "🧑‍🚒", "👩‍🚒", "👨‍🚒", "🧑‍✈️", "👩‍✈️", "👨‍✈️", "🧑‍🚀", "👩‍🚀", "👨‍🚀", "🧑‍⚖️", "👩‍⚖️", "👨‍⚖️", "🦸", "🦸‍♀️", "🦸‍♂️", "🦹", "🦹‍♀️", "🦹‍♂️", "🤶", "🧑‍🎄", "🎅", "🫈", "🥷", "🧙", "🧙‍♀️", "🧙‍♂️", "🧝", "🧝‍♀️", "🧝‍♂️", "🧛", "🧛‍♀️", "🧛‍♂️", "🧟", "🧟‍♀️", "🧟‍♂️", "🧞", "🧞‍♀️", "🧞‍♂️", "🧜", "🧜‍♀️", "🧜‍♂️", "🧚", "🧚‍♀️", "🧚‍♂️", "👼", "🧌", "🤰", "🫃", "🫄", "🫅", "🤱", "👩‍🍼", "👨‍🍼", "🧑‍🍼", "👸", "🤴", "👰", "👰‍♀️", "👰‍♂️", "🤵", "🤵‍♀️", "🤵‍♂️", "🏃", "🏃‍➡️", "🏃‍♀️", "🏃‍♀️‍➡️", "🏃‍♂️", "🏃‍♂️‍➡️", "🚶", "🚶‍➡️", "🚶‍♀️", "🚶‍♀️‍➡️", "🚶‍♂️", "🚶‍♂️‍➡️", "🧑‍🩰", "💃", "🕺", "👯", "👯‍♀️", "👯‍♂️", "👫", "🧑‍🤝‍🧑", "👬", "👭", "🫂", "🙇", "🙇‍♀️", "🙇‍♂️", "🤦", "🤦‍♂️", "🤦‍♀️", "🤷", "🤷‍♀️", "🤷‍♂️", "💁", "💁‍♀️", "💁‍♂️", "🙅", "🙅‍♀️", "🙅‍♂️", "🙆", "🙆‍♀️", "🙆‍♂️", "🙋", "🙋‍♀️", "🙋‍♂️", "🙎", "🙎‍♀️", "🙎‍♂️", "🙍", "🙍‍♀️", "🙍‍♂️", "💇", "💇‍♀️", "💇‍♂️", "💆", "💆‍♀️", "💆‍♂️", "🧖", "🧖‍♀️", "🧖‍♂️", "🧏", "🧏‍♀️", "🧏‍♂️", "🧍", "🧍‍♀️", "🧍‍♂️", "🧎", "🧎‍➡️", "🧎‍♀️", "🧎‍♀️‍➡️", "🧎‍♂️", "🧎‍♂️‍➡️", "🧑‍🦯", "🧑‍🦯‍➡️", "👩‍🦯", "👩‍🦯‍➡️", "👨‍🦯", "👨‍🦯‍➡️", "🧑‍🦼", "🧑‍🦼‍➡️", "👩‍🦼", "👩‍🦼‍➡️", "👨‍🦼", "👨‍🦼‍➡️", "🧑‍🦽", "🧑‍🦽‍➡️", "👩‍🦽", "👩‍🦽‍➡️", "👨‍🦽", "👨‍🦽‍➡️", "💑", "👩‍❤️‍👨", "👩‍❤️‍👩", "👨‍❤️‍👨", "💏", "👩‍❤️‍💋‍👨", "👩‍❤️‍💋‍👩", "👨‍❤️‍💋‍👨", "👨‍👩‍👦", "👨‍👩‍👧", "👨‍👩‍👧‍👦", "👨‍👩‍👦‍👦", "👨‍👩‍👧‍👧", "👩‍👩‍👦", "👩‍👩‍👧", "👩‍👩‍👧‍👦", "👩‍👩‍👦‍👦", "👩‍👩‍👧‍👧", "👨‍👨‍👦", "👨‍👨‍👧", "👨‍👨‍👧‍👦", "👨‍👨‍👦‍👦", "👨‍👨‍👧‍👧", "👩‍👦", "👩‍👧", "👩‍👧‍👦", "👩‍👦‍👦", "👩‍👧‍👧", "👨‍👦", "👨‍👧", "👨‍👧‍👦", "👨‍👦‍👦", "👨‍👧‍👧", "👪", "🧑‍🧑‍🧒", "🧑‍🧑‍🧒‍🧒", "🧑‍🧒", "🧑‍🧒‍🧒", "🧶", "🧵", "🧥", "🥼", "👚", "👕", "👖", "👔", "👗", "👙", "🩱", "👘", "🥻", "🩲", "🩳", "💄", "💋", "👣", "🥿", "👠", "👡", "👢", "👞", "👟", "🩴", "🩰", "🧦", "🧤", "🧣", "👒", "🎩", "🧢", "⛑", "🪖", "🎓", "👑", "🎒", "🧳", "👝", "👛", "👜", "💼", "👓", "🕶", "🥽", "💍", "🌂"] },
  { category: "animals_and_nature", items: ["🐶", "🐱", "🐈‍⬛", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🫍", "🦑", "🐙", "🪼", "🦐", "🐵", "🦍", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🪿", "🦆", "🐦‍⬛", "🦅", "🦉", "🐦‍🔥", "🦇", "🐺", "🐗", "🐴", "🦄", "🫎", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜", "🦗", "🕷", "🪲", "🪳", "🪰", "🪱", "🦂", "🦀", "🐍", "🦎", "🦖", "🦕", "🐢", "🐠", "🐟", "🐡", "🐬", "🦈", "🐳", "🐋", "🐊", "🐆", "🦓", "🐅", "🐃", "🐂", "🐄", "🦌", "🐪", "🐫", "🦒", "🐘", "🦏", "🐐", "🐏", "🐑", "🫏", "🐎", "🐖", "🐀", "🐁", "🐓", "🦃", "🕊", "🐕", "🐩", "🐈", "🐇", "🐿", "🦔", "🦝", "🦙", "🦛", "🦘", "🦡", "🦢", "🦚", "🦜", "🦞", "🦠", "🦟", "🦬", "🦣", "🦫", "🐻‍❄️", "🦤", "🪶", "🪽", "🦭", "🐾", "🐉", "🐲", "🦧", "🦮", "🐕‍🦺", "🦥", "🦦", "🦨", "🦩", "🌵", "🎄", "🌲", "🌳", "🌴", "🌱", "🌿", "☘", "🍀", "🪾", "🎍", "🎋", "🍃", "🍂", "🍁", "🌾", "🌺", "🌻", "🌹", "🥀", "🪻", "🌷", "🌼", "🌸", "💐", "🍄", "🪴", "🌰", "🎃", "🐚", "🕸", "🌎", "🌍", "🌏", "🪐", "🌕", "🌖", "🌗", "🌘", "🌑", "🌒", "🌓", "🌔", "🌚", "🌝", "🌛", "🌜", "🌞", "🌙", "⭐", "🌟", "💫", "✨", "☄", "☀️", "🌤", "⛅", "🌥", "🌦", "☁️", "🌧", "⛈", "🌩", "⚡", "🔥", "💥", "❄️", "🌨", "⛄", "☃", "🌬", "💨", "🌪", "🌫", "☂", "☔", "💧", "💦", "🌊", "🪷", "🪸", "🪹", "🪺"] },
  { category: "food_and_drink", items: ["🍋‍🟩", "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍈", "🍒", "🍑", "🍍", "🥥", "🥝", "🥭", "🥑", "🫛", "🥦", "🍄‍🟫", "🫜", "🍅", "🍆", "🥒", "🫐", "🫒", "🫑", "🥕", "🌶", "🥔", "🌽", "🥬", "🍠", "🫚", "🥜", "🧄", "🧅", "🍯", "🥐", "🍞", "🥖", "🥯", "🥨", "🧀", "🥚", "🥓", "🥩", "🥞", "🍗", "🍖", "🦴", "🍤", "🍳", "🍔", "🍟", "🥙", "🌭", "🍕", "🥪", "🥫", "🍝", "🌮", "🌯", "🥗", "🥘", "🍜", "🍲", "🍥", "🥠", "🍣", "🍱", "🍛", "🍙", "🍚", "🍘", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧", "🍰", "🧁", "🥮", "🎂", "🍮", "🍬", "🍭", "🍫", "🍿", "🥟", "🍩", "🍪", "🧇", "🧆", "🧈", "🦪", "🫓", "🫔", "🫕", "🥛", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🍾", "🍶", "🍵", "🥤", "☕", "🫖", "🧋", "🍼", "🧃", "🧉", "🧊", "🧂", "🥄", "🍴", "🍽", "🥣", "🥡", "🥢", "🫗", "🫘", "🫙"] },
  { category: "activity", items: ["⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "⛳", "🏌", "🏌️‍♀️", "🏌️‍♂️", "🏓", "🏸", "🥅", "🏒", "🏑", "🥍", "🏏", "🎿", "⛷", "🏂", "🤺", "🤼", "🤼‍♀️", "🤼‍♂️", "🤸", "🤸‍♀️", "🤸‍♂️", "🤾", "🤾‍♀️", "🤾‍♂️", "⛸", "🥌", "🛹", "🛷", "🏹", "🎣", "🥊", "🥋", "🚣", "🚣‍♀️", "🚣‍♂️", "🧗", "🧗‍♀️", "🧗‍♂️", "🏊", "🏊‍♀️", "🏊‍♂️", "🤽", "🤽‍♀️", "🤽‍♂️", "🧘", "🧘‍♀️", "🧘‍♂️", "🏄", "🏄‍♀️", "🏄‍♂️", "🛀", "⛹", "⛹️‍♀️", "⛹️‍♂️", "🏋", "🏋️‍♀️", "🏋️‍♂️", "🚴", "🚴‍♀️", "🚴‍♂️", "🚵", "🚵‍♀️", "🚵‍♂️", "🏇", "🤿", "🪀", "🪁", "🦺", "🪡", "🪢", "🕴", "🏆", "🎽", "🏅", "🎖", "🥇", "🥈", "🥉", "🎗", "🏵", "🎫", "🎟", "🎭", "🎨", "🎪", "🤹", "🤹‍♀️", "🤹‍♂️", "🎤", "🎧", "🎼", "🎹", "🪇", "🥁", "🎷", "🎺", "🪈", "🎸", "🎻", "🪕", "🪗", "🪘", "🪉", "🎬", "🎮", "👾", "🎯", "🎲", "♟️", "🎰", "🧩", "🎳", "🪄", "🪅", "🪆", "🪬", "🪩", "🛘"] },
  { category: "travel_and_places", items: ["🚗", "🚕", "🚙", "🚌", "🚎", "🏎", "🚓", "🚑", "🚒", "🚐", "🚚", "🚛", "🚜", "🛴", "🏍", "🚲", "🛵", "🦽", "🦼", "🛺", "🪂", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟", "🚃", "🚋", "🚝", "🚄", "🚅", "🚈", "🚞", "🚂", "🚆", "🚇", "🚊", "🚉", "🛸", "🚁", "🛩", "✈️", "🛫", "🛬", "⛵", "🛥", "🚤", "⛴", "🛳", "🚀", "🛰", "🛻", "🛼", "💺", "🛶", "⚓", "🚧", "⛽", "🚏", "🚦", "🚥", "🏁", "🚢", "🎡", "🎢", "🎠", "🏗", "🌁", "🏭", "⛲", "🎑", "⛰", "🏔", "🗻", "🌋", "🗾", "🏕", "⛺", "🏞", "🛣", "🛤", "🌅", "🌄", "🏜", "🏖", "🏝", "🌇", "🌆", "🏙", "🌃", "🌉", "🌌", "🌠", "🎇", "🎆", "🌈", "🏘", "🏰", "🏯", "🗼", "", "🏟", "🗽", "🏠", "🏡", "🏚", "🏢", "🏬", "🏣", "🏤", "🏥", "🏦", "🏨", "🏪", "🏫", "🏩", "💒", "🏛", "⛪", "🕌", "🕍", "🕋", "⛩", "🛕", "🪨", "🪵", "🛖", "🛝", "🛞", "🛟"] },
  { category: "objects", items: ["⌚", "📱", "📲", "💻", "⌨", "🖥", "🖨", "🖱", "🖲", "🕹", "🗜", "💽", "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥", "📽", "🎞", "📞", "☎️", "📟", "📠", "📺", "📻", "🎙", "🎚", "🎛", "🧭", "⏱", "⏲", "⏰", "🕰", "⏳", "⌛", "📡", "🔋", "🪫", "🔌", "💡", "🔦", "🕯", "🧯", "🗑", "🛢", "🪎", "💸", "💵", "💴", "💶", "💷", "💰", "🪙", "💳", "🪪", "🥾", "💎", "⚖", "⛓️‍💥", "🧰", "🔧", "🔨", "⚒", "🛠", "⛏", "🪓", "🦯", "🔩", "⚙", "🪃", "🪚", "🪛", "🪝", "🪜", "🪏", "🧱", "⛓", "🧲", "🔫", "💣", "🧨", "🔪", "🗡", "⚔", "🛡", "🚬", "☠", "⚰", "⚱", "🏺", "🔮", "📿", "🧿", "💈", "⚗", "🔭", "🔬", "🕳", "💊", "💉", "🩸", "🩹", "🩺", "🪒", "🪮", "🩻", "🩼", "🧬", "🧫", "🧪", "🌡", "🧹", "🧺", "🧻", "🏷", "🔖", "🚽", "🚿", "🛁", "🧼", "🧽", "🧴", "🔑", "🗝", "🛋", "🪔", "🛌", "🛏", "🚪", "🪑", "🛎", "🧸", "🖼", "🗺", "🛗", "🪞", "🪟", "🪠", "🪤", "🪣", "🪥", "🫧", "⛱", "🗿", "🛍", "🛒", "🎈", "🎏", "🎀", "🎁", "🎊", "🎉", "🎎", "🪭", "🎐", "🎌", "🏮", "🧧", "✉️", "📩", "📨", "📧", "💌", "📮", "📪", "📫", "📬", "📭", "📦", "📯", "📥", "📤", "📜", "📃", "📑", "🧾", "📊", "📈", "📉", "📄", "📅", "📆", "🗓", "📇", "🗃", "🗳", "🗄", "📋", "🗒", "📁", "📂", "🗂", "🗞", "📰", "📓", "📕", "📗", "📘", "📙", "📔", "📒", "📚", "📖", "🧷", "🔗", "📎", "🖇", "✂️", "📐", "📏", "🧮", "📌", "📍", "🚩", "🏳", "🏴", "🏳️‍🌈", "🏳️‍⚧️", "🔐", "🔒", "🔓", "🔏", "🖊", "🖋", "✒️", "📝", "✏️", "🖍", "🖌", "🔍", "🔎", "🪦", "🪧", "🪊"] },
  { category: "symbols", items: ["💯", "🔢", "🩷", "❤️", "🧡", "💛", "💚", "🩵", "💙", "💜", "🤎", "🖤", "🩶", "🤍", "💔", "❣", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "❤️‍🔥", "❤️‍🩹", "☮", "✝", "☪", "🕉", "☸", "🪯", "✡", "🔯", "🕎", "☯", "☦", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛", "♀️", "♂️", "⚧️", "🈳", "🈹", "☢", "☣", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "🉑", "💮", "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️", "🆘", "⛔", "📛", "🚫", "❌", "⭕", "🛑", "💢", "♨️", "🚷", "🚯", "🚳", "🚱", "🔞", "📵", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔅", "🔆", "🔱", "⚜", "〽️", "⚠️", "🚸", "🔰", "♻️", "🈯", "💹", "❇️", "✳️", "❎", "✅", "💠", "🌀", "➿", "🌐", "Ⓜ️", "🏧", "🈂️", "🛂", "🛃", "🛄", "🛅", "🛜", "♿", "🚭", "🚾", "🅿️", "🚰", "🚹", "🚺", "🚼", "🚻", "🚮", "🎦", "📶", "🈁", "🆖", "🆗", "🆙", "🆒", "🆕", "🆓", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "*⃣", "⏏️", "▶️", "⏸", "⏭", "⏹", "⏺", "⏯", "⏮", "⏩", "⏪", "🔀", "🔁", "🔂", "◀️", "🔼", "🔽", "⏫", "⏬", "➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "↙️", "↖️", "↕️", "↔️", "🔄", "↪️", "↩️", "⤴️", "⤵️", "#️⃣", "ℹ️", "🔤", "🔡", "🔠", "🔣", "🎵", "🎶", "〰️", "➰", "✔️", "🔃", "➕", "➖", "➗", "✖️", "🟰", "♾", "💲", "💱", "⚕️", "©️", "®️", "™️", "🫟", "🔚", "🔙", "🔛", "🔝", "🔜", "☑️", "🔘", "⚫", "⚪", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "🔸", "🔹", "🔶", "🔷", "🔺", "▪️", "▫️", "⬛", "⬜", "🟥", "🟧", "🟨", "🟩", "🟦", "🟪", "🟫", "🔻", "◼️", "◻️", "◾", "◽", "🔲", "🔳", "🔈", "🔉", "🔊", "🔇", "📣", "📢", "🔔", "🔕", "🃏", "🀄", "♠️", "♣️", "♥️", "♦️", "🎴", "💭", "🗯", "💬", "🗨", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛", "🕜", "🕝", "🕞", "🕟", "🕠", "🕡", "🕢", "🕣", "🕤", "🕥", "🕦", "🕧"] },
  { category: "flags", items: ["🇦🇫", "🇦🇽", "🇦🇱", "🇩🇿", "🇦🇸", "🇦🇩", "🇦🇴", "🇦🇮", "🇦🇶", "🇦🇬", "🇦🇷", "🇦🇲", "🇦🇼", "🇦🇨", "🇦🇺", "🇦🇹", "🇦🇿", "🇧🇸", "🇧🇭", "🇧🇩", "🇧🇧", "🇧🇾", "🇧🇪", "🇧🇿", "🇧🇯", "🇧🇲", "🇧🇹", "🇧🇴", "🇧🇻", "🇧🇶", "🇧🇦", "🇧🇼", "🇧🇷", "🇮🇴", "🇻🇬", "🇧🇳", "🇧🇬", "🇧🇫", "🇧🇮", "🇨🇻", "🇰🇭", "🇨🇲", "🇨🇦", "🇮🇨", "🇰🇾", "🇨🇫", "🇪🇦", "🇹🇩", "🇨🇱", "🇨🇳", "🇨🇽", "🇨🇵", "🇨🇨", "🇨🇴", "🇰🇲", "🇨🇬", "🇨🇩", "🇨🇰", "🇨🇷", "🇭🇷", "🇨🇺", "🇨🇼", "🇨🇾", "🇨🇿", "🇩🇰", "🇩🇬", "🇩🇯", "🇩🇲", "🇩🇴", "🇪🇨", "🇪🇬", "🇸🇻", "🇬🇶", "🇪🇷", "🇪🇪", "🇪🇹", "🇪🇺", "🇫🇰", "🇫🇴", "🇫🇯", "🇫🇮", "🇫🇷", "🇬🇫", "🇵🇫", "🇹🇫", "🇬🇦", "🇬🇲", "🇬🇪", "🇩🇪", "🇬🇭", "🇬🇮", "🇬🇷", "🇬🇱", "🇬🇩", "🇬🇵", "🇬🇺", "🇬🇹", "🇬🇬", "🇬🇳", "🇬🇼", "🇬🇾", "🇭🇹", "🇭🇲", "🇭🇳", "🇭🇰", "🇭🇺", "🇮🇸", "🇮🇳", "🇮🇩", "🇮🇷", "🇮🇶", "🇮🇪", "🇮🇲", "🇮🇱", "🇮🇹", "🇨🇮", "🇯🇲", "🇯🇵", "🇯🇪", "🇯🇴", "🇰🇿", "🇰🇪", "🇰🇮", "🇽🇰", "🇰🇼", "🇰🇬", "🇱🇦", "🇱🇻", "🇱🇧", "🇱🇸", "🇱🇷", "🇱🇾", "🇱🇮", "🇱🇹", "🇱🇺", "🇲🇴", "🇲🇰", "🇲🇬", "🇲🇼", "🇲🇾", "🇲🇻", "🇲🇱", "🇲🇹", "🇲🇭", "🇲🇶", "🇲🇷", "🇲🇺", "🇾🇹", "🇲🇽", "🇫🇲", "🇲🇩", "🇲🇨", "🇲🇳", "🇲🇪", "🇲🇸", "🇲🇦", "🇲🇿", "🇲🇲", "🇳🇦", "🇳🇷", "🇳🇵", "🇳🇱", "🇳🇨", "🇳🇿", "🇳🇮", "🇳🇪", "🇳🇬", "🇳🇺", "🇳🇫", "🇲🇵", "🇰🇵", "🇳🇴", "🇴🇲", "🇵🇰", "🇵🇼", "🇵🇸", "🇵🇦", "🇵🇬", "🇵🇾", "🇵🇪", "🇵🇭", "🇵🇳", "🇵🇱", "🇵🇹", "🇵🇷", "🇶🇦", "🇷🇪", "🇷🇴", "🇷🇺", "🇷🇼", "🇨🇶", "🇧🇱", "🇸🇭", "🇰🇳", "🇱🇨", "🇲🇫", "🇵🇲", "🇻🇨", "🇼🇸", "🇸🇲", "🇸🇹", "🇸🇦", "🇸🇳", "🇷🇸", "🇸🇨", "🇸🇱", "🇸🇬", "🇸🇽", "🇸🇰", "🇸🇮", "🇸🇧", "🇸🇴", "🇿🇦", "🇬🇸", "🇰🇷", "🇸🇸", "🇪🇸", "🇱🇰", "🇸🇩", "🇸🇷", "🇸🇿", "🇸🇯", "🇸🇪", "🇨🇭", "🇸🇾", "🇹🇼", "🇹🇯", "🇹🇿", "🇹🇭", "🇹🇱", "🇹🇬", "🇹🇰", "🇹🇴", "🇹🇹", "🇹🇦", "🇹🇳", "🇹🇷", "🇹🇲", "🇹🇨", "🇹🇻", "🇺🇬", "🇺🇦", "🇦🇪", "🇬🇧", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "🏴󠁧󠁢󠁷󠁬󠁳󠁿", "🇺🇸", "🇺🇲", "🇻🇮", "🇺🇾", "🇺🇿", "🇻🇺", "🇻🇦", "🇻🇪", "🇻🇳", "🇼🇫", "🇪🇭", "🇾🇪", "🇿🇲", "🇿🇼", "🇺🇳", "🏴‍☠️"] },
];

/** Flattened list for search/back-compat. */
export const UNICODE_EMOJIS = UNICODE_EMOJI_GROUPS.flatMap((g) => g.items).filter((e) => e.trim().length > 0 && !e.includes(" "));


/** Moved to `core/content/ast` (used by the MFM parser); re-exported here. */
export type { TextSegment } from "../core/content/ast";
export { splitRemoteEmojiCodes } from "../core/content/ast";

// --- Custom-emoji key shapes (verified live on Sharkey dvd.chat) ---
//
// Reaction keys pack the host: `:name@host:` for remote emoji (the
// common case in the wild). Display names, text, and the global
// `emojis` listing use bare `:name:`. Packed per-object maps
// (`note.reactionEmojis`, `note.emojis`, `user.emojis`) are keyed by
// the BARE inner (`name@host`, no colons) → URL and are the
// authoritative source wherever the object is in hand (they cover
// remote emoji too); the global listing is the fallback.

function splitEmojiInner(inner: string): { name: string; host: string } {
  const at = inner.indexOf("@");
  return at < 0
    ? { name: inner, host: "" }
    : { name: inner.slice(0, at), host: inner.slice(at + 1) };
}

/** Whether two reaction keys denote the same emoji: exact match, or
 * bare `:name:` vs local `:name@.:`. Distinct remote hosts
 * (`:x@a:` vs `:x@b:`) never equate. Pure. */
export function sameEmojiKey(a: string, b: string): boolean {
  if (a === b) return true;
  const innerA = stripEmojiColons(a);
  const innerB = stripEmojiColons(b);
  if (innerA == null || innerB == null) return false;
  const pa = splitEmojiInner(innerA);
  const pb = splitEmojiInner(innerB);
  if (pa.name !== pb.name) return false;
  if (pa.host === pb.host) return true;
  const localA = pa.host === "" || pa.host === ".";
  const localB = pb.host === "" || pb.host === ".";
  return localA && localB;
}

/** Resolve a code against a packed per-object map (`reactionEmojis`,
 * `emojis`): tries the exact inner (`name@host`) first, then — for
 * LOCAL codes only (`:name:`, `:name@.:`) — the bare name, plus
 * colon-wrapped variants of each (tolerant of either key shape).
 * Remote codes (`:name@host:`) never fall back to the bare name: a
 * packed bare key is a *local* emoji and rendering it under a remote
 * code would show the wrong image. Accepts the code with or without
 * surrounding colons. Pure. */
export function lookupPackedEmojis(
  packed: Record<string, string> | null | undefined,
  code: string,
): string | null {
  if (!packed) return null;
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  const inner = stripEmojiColons(trimmed) ?? trimmed;
  const { host } = splitEmojiInner(inner);
  const local = host === "" || host === ".";
  const bare = bareEmojiName(inner);
  const candidates = local
    ? [inner, bare, `:${inner}:`, `:${bare}:`]
    : [inner, `:${inner}:`];
  for (const key of candidates) {
    const url = packed[key];
    if (typeof url === "string" && url.length > 0) return url;
  }
  return null;
}

export interface CustomEmojiGroup {
  category: string;
  items: CustomEmoji[];
}

/** Group custom emoji by category (null/blank → the `uncategorized`
 * bucket), groups sorted alphabetically, items sorted by name. Pure:
 * the caller passes the localized bucket label (the data layer holds
 * no locales). */
export function groupCustomByCategory(
  list: CustomEmoji[],
  uncategorized: string = "Uncategorized",
): CustomEmojiGroup[] {
  const fallback = uncategorized;
  const byCategory = new Map<string, CustomEmoji[]>();
  for (const emoji of list) {
    const category =
      emoji.category && emoji.category.trim().length > 0
        ? emoji.category
        : fallback;
    const group = byCategory.get(category);
    if (group) group.push(emoji);
    else byCategory.set(category, [emoji]);
  }
  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/** Substring filter over custom emoji names + aliases,
 * case-insensitive; surrounding colons are ignored so `:blob`
 * matches `blobcat`. Empty query returns the full list. Pure. */
export function filterCustomEmojis(
  list: CustomEmoji[],
  query: string,
): CustomEmoji[] {
  const q = query.trim().replace(/^:+|:+$/g, "").toLowerCase();
  if (q.length === 0) return list;
  return list.filter(
    (emoji) =>
      emoji.name.toLowerCase().includes(q) ||
      emoji.aliases.some((alias) => alias.toLowerCase().includes(q)),
  );
}

/** Substring filter over a unicode pool (typing the character itself
 * finds it). Empty query returns the pool. Pure. */
export function filterUnicode(pool: string[], query: string): string[] {
  const q = query.trim();
  if (q.length === 0) return pool;
  return pool.filter((emoji) => emoji.includes(q));
}

// --- Plain-text `:code:` splitting (display names, CWs, bios) ---
//
// Display names, content warnings, and (unfurl-card) bios are plain
// text, not MFM — but they can still carry `:code:` custom emoji,
// local or remote (`:name@host:` — mfm-js never parses those, so the
// splitter owns both). Splitter is pure (unit-checked); `DisplayName` in
// `components/EmojiPicker.tsx` renders the parts, resolving remote codes
// through the packed maps and the per-host listing cache.

export type NamePart =
  | { kind: "text"; text: string }
  | { kind: "emoji"; code: string };

/** Split `:code:` sequences out of plain text. Adjacent codes each
 * become their own part; everything else stays verbatim. Remote
 * `:name@host:` codes split too (they resolve through the per-object
 * packed maps and the per-host listing cache, never the local list). */
export function splitNameEmojis(name: string): NamePart[] {
  const parts: NamePart[] = [];
  const pattern = /:([A-Za-z0-9_+-]+(?:@[A-Za-z0-9.-]+)?):/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(name)) !== null) {
    if (match.index > last) {
      parts.push({ kind: "text", text: name.slice(last, match.index) });
    }
    parts.push({ kind: "emoji", code: match[0] });
    last = match.index + match[0].length;
  }
  if (last < name.length) parts.push({ kind: "text", text: name.slice(last) });
  return parts;
}

// --- Device-local lists (favourites + recently used) ---
//
// Persisted as JSON string arrays in localStorage (see
// `state/emojiPrefs.tsx`). Device-local for now; per-account storage
// arrives with the Pinetree server work (owner decision 2026-10-16).

export const MAX_RECENTS = 24;
export const MAX_FAVOURITES = 60;

/** Validated parse of a stored emoji list: non-array/missing → [];
 * non-string/blank entries dropped; first-seen order kept; capped. */
export function parseStoredList(raw: string | null, max: number): string[] {
  if (raw == null || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const emoji = entry.trim();
      if (emoji.length === 0 || seen.has(emoji)) continue;
      seen.add(emoji);
      out.push(emoji);
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** MRU touch: the picked emoji moves to the front, capped. Pure. */
export function touchRecent(
  list: string[],
  emoji: string,
  max: number = MAX_RECENTS,
): string[] {
  const clean = emoji.trim();
  if (clean.length === 0) return list;
  return [clean, ...list.filter((entry) => entry !== clean)].slice(0, max);
}

/** Favourite add: stuck in user order (appended, never reordered by
 * use); duplicates are no-ops; capped. Pure. */
export function addFavourite(
  list: string[],
  emoji: string,
  max: number = MAX_FAVOURITES,
): string[] {
  const clean = emoji.trim();
  if (clean.length === 0) return list;
  if (list.includes(clean)) return list;
  return [...list, clean].slice(0, max);
}

/** Favourite remove. Pure. */
export function removeFavourite(list: string[], emoji: string): string[] {
  return list.filter((entry) => entry !== emoji);
}

// --- Like emoji setting ---

export const DEFAULT_LIKE_EMOJI = HEART_REACTION;
const MAX_LIKE_EMOJI_LENGTH = 64;

/** Validated parse of the stored like emoji: blank/missing/too-long
 * falls back to the heart. Accepts any unicode emoji or `:code:`. */
export function parseLikeEmoji(raw: string | null): string {
  if (raw == null) return DEFAULT_LIKE_EMOJI;
  const clean = raw.trim();
  if (clean.length === 0 || clean.length > MAX_LIKE_EMOJI_LENGTH) {
    return DEFAULT_LIKE_EMOJI;
  }
  return clean;
}
