// Floating-composer (post box) UI state: opened from the sidebar rail,
// closed after posting or dismissing. The provider only owns the
// open/closed flag — the modal itself renders inside the router (see
// `FloatingComposer`, mounted by `Layout`) so posting can land on the
// new note's detail view.

import { createContext, createSignal, useContext } from "solid-js";
import type { JSX } from "solid-js";

interface PostboxState {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
}

const PostboxContext = createContext<PostboxState>();

export function PostboxProvider(props: { children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  const state: PostboxState = {
    isOpen: open,
    open: () => setOpen(true),
    close: () => setOpen(false),
  };
  return (
    <PostboxContext.Provider value={state}>
      {props.children}
    </PostboxContext.Provider>
  );
}

export function usePostbox(): PostboxState {
  const state = useContext(PostboxContext);
  if (!state) throw new Error("usePostbox must be used inside PostboxProvider");
  return state;
}
