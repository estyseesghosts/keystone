// Shared emoji picker: one floating panel for reactions (note action
// row) and inserts (composer toolbar), in the visual language of the
// audience menu (`VisibilityPicker` + `.vispick-*` styles — monochrome
// overlay card, never pushes content).
//
// Sections mirror the reference client: quick row, Favourites (stuck
// user order), Recently used (MRU), Custom Emoji (collapsible hosted
// categories from `POST /api/emojis`, omitted on backends without it),
// and a bottom Search. Right-clicking a picker cell (cells only —
// never chips or note text, owner decision 2026-10-16) opens a small
// `vispick`-styled menu: Add/Remove favourite + Use emoji as like.
//
// Picking records the emoji in Recently used (both modes).

import {
  createMemo,
  createSignal,
  createEffect,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type {
  CustomEmoji,
  NamePart,
} from "../api/emoji";
import {
  COMPOSER_EMOJI,
  QUICK_REACTIONS,
  customReactionCode,
  filterCustomEmojis,
  filterUnicode,
  groupCustomByCategory,
  lookupPackedEmojis,
  splitNameEmojis,
} from "../api/emoji";
import {
  customEmojis,
  customEmojiState,
  customEmojiUrl,
  loadCustomEmojis,
  retryCustomEmojis,
} from "../api/customEmoji";
import { useEmojiPrefs } from "../state/emojiPrefs";
import { SmileIcon } from "./icons";

const RESULT_CAP = 60;
const CATEGORY_GRID_CAP = 120;

/** One emoji glyph: the packed per-object URL when given (and known),
 * else the hosted image from the global listing, else the literal text
 * (never a fabricated URL). The image carries the code as alt text so
 * assistive tech hears the same thing sighted users see. */
export function EmojiGlyph(props: {
  emoji: string;
  packed?: Record<string, string> | null;
}) {
  const url = () =>
    lookupPackedEmojis(props.packed, props.emoji) ??
    customEmojiUrl(props.emoji);
  return (
    <Show
      when={url()}
      fallback={<>{props.emoji}</>}
    >
      {(src) => (
        <img
          class="emojiglyph"
          src={src()}
          alt={props.emoji}
          loading="lazy"
        />
      )}
    </Show>
  );
}

/** Plain text with hosted `:code:` custom emoji substituted inline
 * (display names, content warnings, unfurl-card bios). `packed` is the
 * owning object's packed map (`user.emojis`, `note.emojis`) — exact
 * intent, including remote emoji; the global listing is the fallback.
 * Unknown codes stay literal; remote `:name@host:` codes never split. */
export function DisplayName(props: {
  name: string;
  packed?: Record<string, string> | null;
}) {
  const parts = createMemo((): NamePart[] => splitNameEmojis(props.name));
  return (
    <For each={parts()}>
      {(part) =>
        part.kind === "text" ? (
          <>{part.text}</>
        ) : (
          <EmojiGlyph emoji={part.code} packed={props.packed} />
        )
      }
    </For>
  );
}

function EmojiCell(props: {
  emoji: string;
  label: string;
  onPick: (emoji: string) => void;
  onMenu: (emoji: string, x: number, y: number) => void;
}) {
  return (
    <button
      type="button"
      class="emojpick-cell"
      aria-label={props.label}
      title={props.label}
      onClick={() => props.onPick(props.emoji)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(props.emoji, e.clientX, e.clientY);
      }}
    >
      <EmojiGlyph emoji={props.emoji} />
    </button>
  );
}

function EmojiGrid(props: {
  items: string[];
  emptyLabel: string;
  cellLabel: (emoji: string) => string;
  onPick: (emoji: string) => void;
  onMenu: (emoji: string, x: number, y: number) => void;
}) {
  return (
    <Show
      when={props.items.length > 0}
      fallback={<p class="emojpick-hint">{props.emptyLabel}</p>}
    >
      <div class="emojpick-grid">
        <For each={props.items}>
          {(emoji) => (
            <EmojiCell
              emoji={emoji}
              label={props.cellLabel(emoji)}
              onPick={props.onPick}
              onMenu={props.onMenu}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

/** Right-click menu for a picker cell. `vispick` menu language
 * (card + rows); fixed at the cursor, clamped to the viewport. */
function EmojiCtxMenu(props: {
  emoji: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const prefs = useEmojiPrefs();
  const favourited = () => prefs.favourites().includes(props.emoji);
  const isLike = () => prefs.likeEmoji() === props.emoji;

  // Dismiss on outside click, Escape, scroll, or resize (renote-menu
  // pattern, plus scroll/resize since the menu is cursor-fixed).
  createEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".emojictx-menu"))
        props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", props.onClose, true);
    window.addEventListener("resize", props.onClose);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", props.onClose, true);
      window.removeEventListener("resize", props.onClose);
    });
  });

  // Clamp so the ~240px card never leaves the viewport.
  const left = () => Math.max(8, Math.min(props.x, window.innerWidth - 248));
  const top = () => Math.max(8, Math.min(props.y, window.innerHeight - 140));

  return (
    <div
      class="vispick-menu emojictx-menu"
      role="menu"
      aria-label={`Options for ${props.emoji}`}
      style={{ left: `${left()}px`, top: `${top()}px` }}
    >
      <button
        type="button"
        role="menuitem"
        class="vispick-item"
        onClick={() => {
          prefs.toggleFavourite(props.emoji);
          props.onClose();
        }}
      >
        <span class="vispick-icon" aria-hidden="true">
          <EmojiGlyph emoji={props.emoji} />
        </span>
        <span class="vispick-text">
          <span class="vispick-label">
            {favourited() ? "Remove from favourites" : "Add to favourites"}
          </span>
          <span class="vispick-desc">Keep it pinned in Favourites</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isLike()}
        class="vispick-item"
        onClick={() => {
          prefs.setLikeEmoji(props.emoji);
          props.onClose();
        }}
      >
        <span class="vispick-icon" aria-hidden="true">
          <EmojiGlyph emoji={props.emoji} />
        </span>
        <span class="vispick-text">
          <span class="vispick-label">Use emoji as like</span>
          <span class="vispick-desc">The like button reacts with this</span>
        </span>
        <span
          class={isLike() ? "vispick-radio on" : "vispick-radio"}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function CustomSection(props: {
  cellLabel: (emoji: string) => string;
  onPick: (emoji: string) => void;
  onMenu: (emoji: string, x: number, y: number) => void;
}) {
  const groups = createMemo(() => groupCustomByCategory(customEmojis()));
  const [openCats, setOpenCats] = createSignal<string[]>([]);

  const toggleCat = (category: string) => {
    setOpenCats((list) =>
      list.includes(category)
        ? list.filter((c) => c !== category)
        : [...list, category],
    );
  };

  const status = () => customEmojiState();
  return (
    <Show when={status() !== "unavailable"}>
      <div class="emojpick-sec">
        <div class="emojpick-label">Custom Emoji</div>
        <Show
          when={status() === "ready"}
          fallback={
            <Show
              when={status() === "error"}
              fallback={<p class="emojpick-hint">Loading custom emoji…</p>}
            >
              <div class="emojpick-error">
                <span>Could not load custom emoji.</span>
                <button type="button" onClick={() => retryCustomEmojis()}>
                  Retry
                </button>
              </div>
            </Show>
          }
        >
          <Show
            when={groups().length > 0}
            fallback={
              <p class="emojpick-hint">This server has no custom emoji.</p>
            }
          >
            <div class="emojpick-cats">
              <For each={groups()}>
                {(group) => (
                  <>
                    <button
                      type="button"
                      class="emojpick-cat"
                      aria-expanded={openCats().includes(group.category)}
                      onClick={() => toggleCat(group.category)}
                    >
                      <span aria-hidden="true">
                        {openCats().includes(group.category) ? "⌄" : "⌃"}
                      </span>
                      <span>
                        {group.category} ({group.items.length})
                      </span>
                    </button>
                    <Show when={openCats().includes(group.category)}>
                      <div class="emojpick-grid">
                        <For each={group.items.slice(0, CATEGORY_GRID_CAP)}>
                          {(item: CustomEmoji) => (
                            <EmojiCell
                              emoji={customReactionCode(item.name)}
                              label={props.cellLabel(
                                customReactionCode(item.name),
                              )}
                              onPick={props.onPick}
                              onMenu={props.onMenu}
                            />
                          )}
                        </For>
                      </div>
                      <Show when={group.items.length > CATEGORY_GRID_CAP}>
                        <p class="emojpick-hint">
                          +{group.items.length - CATEGORY_GRID_CAP} more —
                          refine with Search.
                        </p>
                      </Show>
                    </Show>
                  </>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </Show>
  );
}

function EmojiPanel(props: {
  mode: "reaction" | "insert";
  onPick: (emoji: string) => void;
  onClose: () => void;
  myReaction?: string | null;
  onUnreact?: () => void;
}) {
  const prefs = useEmojiPrefs();
  const [query, setQuery] = createSignal("");
  const [customCode, setCustomCode] = createSignal("");
  const [ctx, setCtx] = createSignal<{
    emoji: string;
    x: number;
    y: number;
  } | null>(null);

  // Kick the session-cached fetch (idempotent — one round-trip per
  // session no matter how many panels mount).
  loadCustomEmojis();

  const pool = () => (props.mode === "reaction" ? QUICK_REACTIONS : COMPOSER_EMOJI);
  const cellLabel = (emoji: string) =>
    props.mode === "reaction" ? `React ${emoji}` : `Insert ${emoji}`;
  const searching = () => query().trim().length > 0;

  // Search spans the unicode pool + both local lists + hosted custom
  // emoji (names/aliases), deduped and capped.
  const results = createMemo(() => {
    if (!searching()) return null;
    const q = query().trim();
    const unicode = [
      ...new Set([...pool(), ...prefs.favourites(), ...prefs.recents()]),
    ];
    const matched = filterUnicode(unicode, q);
    const customs = filterCustomEmojis(customEmojis(), q)
      .slice(0, 40)
      .map((item) => customReactionCode(item.name));
    return [...matched, ...customs.filter((c) => !matched.includes(c))].slice(
      0,
      RESULT_CAP,
    );
  });

  const pick = (emoji: string) => {
    prefs.touchRecent(emoji);
    setCtx(null);
    props.onPick(emoji);
    props.onClose();
  };

  const submitCustomCode = () => {
    const value = customCode().trim();
    if (value.length === 0) return;
    setCustomCode("");
    pick(value);
  };

  const openMenu = (emoji: string, x: number, y: number) =>
    setCtx({ emoji, x, y });

  return (
    <div
      class="emojpick popup"
      role="dialog"
      aria-label={
        props.mode === "reaction" ? "Choose a reaction" : "Choose an emoji"
      }
    >
      <Show
        when={searching()}
        fallback={
          <>
            <div class="emojpick-sec">
              <div class="emojpick-grid">
                <For each={pool()}>
                  {(emoji) => (
                    <EmojiCell
                      emoji={emoji}
                      label={cellLabel(emoji)}
                      onPick={pick}
                      onMenu={openMenu}
                    />
                  )}
                </For>
              </div>
            </div>
            <div class="emojpick-sec">
              <div class="emojpick-label">Favourites</div>
              <Show
                when={prefs.favourites().length > 0}
                fallback={
                  <p class="emojpick-hint">
                    Right-click any emoji to pin it here.
                  </p>
                }
              >
                <EmojiGrid
                  items={prefs.favourites()}
                  emptyLabel=""
                  cellLabel={cellLabel}
                  onPick={pick}
                  onMenu={openMenu}
                />
              </Show>
            </div>
            <div class="emojpick-sec">
              <div class="emojpick-label">Recently used</div>
              <Show when={prefs.recents().length > 0}>
                <EmojiGrid
                  items={prefs.recents()}
                  emptyLabel=""
                  cellLabel={cellLabel}
                  onPick={pick}
                  onMenu={openMenu}
                />
              </Show>
            </div>
            <CustomSection
              cellLabel={cellLabel}
              onPick={pick}
              onMenu={openMenu}
            />
            <Show when={props.mode === "reaction"}>
              <form
                class="reactcustom"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitCustomCode();
                }}
              >
                <input
                  type="text"
                  value={customCode()}
                  onInput={(e) => setCustomCode(e.currentTarget.value)}
                  placeholder=":custom_emoji:"
                  aria-label="Custom reaction"
                />
                <button
                  type="submit"
                  disabled={customCode().trim().length === 0}
                >
                  Send
                </button>
              </form>
            </Show>
          </>
        }
      >
        <div class="emojpick-sec">
          <div class="emojpick-label">Results</div>
          <EmojiGrid
            items={results() ?? []}
            emptyLabel="No matches."
            cellLabel={cellLabel}
            onPick={pick}
            onMenu={openMenu}
          />
        </div>
      </Show>
      <Show when={props.mode === "reaction" && props.myReaction}>
        <button
          type="button"
          class="emojpick-footbtn"
          onClick={() => {
            setCtx(null);
            props.onUnreact?.();
            props.onClose();
          }}
        >
          Remove reaction
        </button>
      </Show>
      <div class="emojpick-search">
        <input
          type="text"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search"
          aria-label="Search emoji"
        />
      </div>
      <button
        type="button"
        class="emojpick-footbtn"
        onClick={() => props.onClose()}
      >
        Close
      </button>
      <Show when={ctx()}>
        {(menu) => (
          <EmojiCtxMenu
            emoji={menu().emoji}
            x={menu().x}
            y={menu().y}
            onClose={() => setCtx(null)}
          />
        )}
      </Show>
    </div>
  );
}

/** Trigger + floating panel. Reaction mode anchors to the note action
 * row (`.emojwrap`, opens upward); insert mode to the composer
 * toolbar (`.compose-emoji-wrap`). The panel closes on outside click
 * or Escape (audience-menu pattern). */
export function EmojiPickerButton(props: {
  mode: "reaction" | "insert";
  onPick: (emoji: string) => void;
  triggerClass: string;
  label: string;
  title?: string;
  myReaction?: string | null;
  onUnreact?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const wrapClass = () =>
    props.mode === "reaction" ? "emojwrap" : "compose-emoji-wrap";

  // The popup closes on outside click or Escape.
  createEffect(() => {
    if (!open()) return;
    const scope = wrapClass();
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(`.${scope}`)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  return (
    <span class={wrapClass()}>
      <button
        type="button"
        class={props.triggerClass}
        aria-haspopup="dialog"
        aria-expanded={open()}
        aria-label={props.label}
        title={props.title ?? props.label}
        onClick={() => setOpen((v) => !v)}
      >
        <SmileIcon />
      </button>
      <Show when={open()}>
        <EmojiPanel
          mode={props.mode}
          onPick={(emoji) => props.onPick(emoji)}
          onClose={() => setOpen(false)}
          myReaction={props.myReaction}
          onUnreact={props.onUnreact}
        />
      </Show>
    </span>
  );
}
