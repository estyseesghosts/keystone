# SolidJS Guide for AI Agent Implementers

**Purpose:** Prevent React assumptions from producing incorrect or unnecessarily complex SolidJS code. Solid uses JSX and function components, but its runtime model is different: a component normally runs once per instance, while reactive expressions update the DOM independently.

> **Version gate:** This guide describes the familiar SolidJS 1.x API (`createSignal`, `createEffect`, `createStore`, `<For>`, etc.). Before changing code, inspect `package.json`, the lockfile, imports, and existing project patterns. Follow the installed Solid version and the project's framework (Solid, SolidStart, or another integration); do not upgrade or scaffold a project unless asked.

## 1. The mental model

Solid does not use React's virtual-DOM reconciliation model. JSX is compiled into DOM creation and targeted updates. Signals, stores, and other reactive sources notify computations that read them in tracked contexts.

- A component function is **setup code**, normally executed once when that component instance is created—not again whenever state changes.
- Reactive expressions in JSX, memos, and effects can be re-evaluated when the values they read change.
- Ordinary JavaScript runs normally. A local variable assigned from a signal or prop is just a value unless it remains an accessor or is recomputed in a reactive computation.
- A component can run again when a new instance is created, such as when a conditional branch is mounted again. “Runs once” means once per instance, not once for the entire application.

```tsx
function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = count() * 2; // snapshot: computed once during setup

  return (
    <button onClick={() => setCount((n) => n + 1)}>
      Current: {count()} / doubled snapshot: {doubled}
    </button>
  );
}
```

Here, `count()` in JSX updates. `doubled` does not. Derive it in JSX (`{count() * 2}`) or use a memo if the derived result is reused or worth caching:

```tsx
const doubled = createMemo(() => count() * 2);
// Read it as doubled(), like a signal getter.
```

Do not assume Solid is automatically faster in every situation or that every expression needs a memo. Its key distinction is fine-grained updates rather than rerunning and diffing a component tree.

## 2. Props are reactive; don't snapshot them accidentally

Solid component props are exposed through a reactive props object. Read properties from `props` where they are used. Destructuring or assigning a property to a normal local variable reads it immediately and can lose later prop updates.

```tsx
// BAD: name is a one-time value, not a live prop
function Greeting({ name }) {
  return <p>Hello {name}</p>;
}

// GOOD
function Greeting(props: { name: string }) {
  return <p>Hello {props.name}</p>;
}

// GOOD: preserve a live accessor when a local name is useful
function Greeting(props: { name: string }) {
  const name = () => props.name;
  return <p>Hello {name()}</p>;
}
```

Use Solid's `splitProps` to partition props while preserving reactive property access, and `mergeProps` for reactive defaults:

```tsx
import { mergeProps, splitProps } from "solid-js";

function Card(props) {
  const [local, rest] = splitProps(props, ["title"]);
  const withDefaults = mergeProps({ size: "medium" }, rest);
  return <section data-size={withDefaults.size}><h2>{local.title}</h2></section>;
}
```

Nuance: **not every spread is wrong.** Spreading props in JSX can be a valid Solid pattern. The risky operation is copying reactive props into a normal JavaScript object—for example, `const copy = { ...props }` or `Object.assign({}, props)`—which snapshots the current values. Prefer direct access, `splitProps`, or `mergeProps` when forwarding or partitioning props.

A value initialized from a prop is also only initialized once:

```tsx
const [name, setName] = createSignal(props.initialName);
```

That is correct when the prop is an *initial value*. It does **not** make `name` follow later changes to `props.initialName`. For a controlled value, read the prop directly; for a genuinely local editable value, define the intended synchronization behavior explicitly.

## 3. Conditional rendering: JSX expressions are reactive

This distinction is essential. **Ternaries and `&&` inside JSX are valid Solid patterns**; expressions such as these are tracked by Solid and can update:

```tsx
return (
  <div>
    {count() > 5 ? <p>Limit reached</p> : <p>Keep going</p>}
    {isAdmin() && <AdminTools />}
  </div>
);
```

What fails is ordinary setup-time control flow whose result is assigned or returned only once:

```tsx
// BAD for a condition that can change later: this if runs only during setup
function Panel() {
  if (isOpen()) return <div>Open</div>;
  return <div>Closed</div>;
}
```

Use JSX expressions or Solid's control-flow components to express dynamic content. `<Show>` is useful for a condition with a fallback; `<Switch>` and `<Match>` are useful for ordered alternatives:

```tsx
import { Match, Show, Switch } from "solid-js";

<Show when={user()} fallback={<p>Please sign in.</p>}>
  {(currentUser) => <p>Welcome, {currentUser().name}</p>}
</Show>

<Switch fallback={<p>Unknown status</p>}>
  <Match when={status() === "loading"}><p>Loading…</p></Match>
  <Match when={status() === "ready"}><Results /></Match>
  <Match when={status() === "error"}><ErrorMessage /></Match>
</Switch>
```

Choose the construct that makes the lifecycle and intent clear. Do not mechanically replace every ternary with `<Show>`; ternaries are not inherently broken. Be aware that `<Show>` has `keyed` behavior options when a truthy value changes but remains truthy; consult its documentation when branch-local state or remounting matters.

## 4. Lists: prefer `<For>` or `<Index>` for dynamic collections

`Array.map()` is valid JavaScript and can be used in JSX, but it is not the default choice for a collection that changes. A JSX `items().map(...)` expression can be re-evaluated when the array signal changes, but it may rebuild the mapped output rather than manage item DOM nodes by identity. Solid's list components make update behavior explicit.

```tsx
import { For, Index } from "solid-js";

// For: item identity matters; the list may grow, shrink, or reorder
<For each={items()}>
  {(item) => <TodoRow todo={item} />}
</For>

// Index: positions are stable, but each position's value may change
<Index each={cells()}>
  {(cell, index) => <GridCell value={cell()} index={index} />}
</Index>
```

Important API difference:

- `<For>` gives an item value and an **index accessor** (`index()`). It tracks items by identity and can move existing DOM nodes when order changes.
- `<Index>` gives an item **accessor** (`item()`) and a fixed numeric index. It is useful when position, rather than item identity, is stable.

Do not write `<For each={items}>` when `items` is a signal accessor; pass its current value as `items()`. Choose `<Index>` only when index-based identity is actually right for the UI.

## 5. Signals and stores

### Signals

`createSignal(value)` returns `[getter, setter]`. Call the getter to read the current value: `count()`. Use the setter to update it.

```tsx
const [count, setCount] = createSignal(0);
setCount(count() + 1);
setCount((previous) => previous + 1); // usually safer for updates based on old state
```

A signal can hold a primitive, object, array, or any other value. If it holds an object or array, mutate it in place and expect subscribers to update is **not** a safe pattern. Replace the value through the setter:

```tsx
const [items, setItems] = createSignal(["a", "b"]);
setItems((current) => [...current, "c"]);
```

### Stores

Use `createStore` when property-level reactivity and nested updates make an object or array convenient. Store values are read through properties (for example, `state.user.name`), not by calling a getter. Reads are tracked when performed in reactive contexts such as JSX, memos, or effects.

```tsx
import { createStore } from "solid-js/store";

const [state, setState] = createStore({ user: { name: "Ada" }, enabled: true });
setState("user", "name", "Grace");
```

Do not treat stores as mandatory for every object or array. A signal holding an immutable object/array can be simpler, and stores are most useful when granular nested updates are beneficial. Do not mutate a `createStore` proxy by direct assignment; update it with `setState`.

Prefer Solid's built-in reactive primitives for ordinary component state. Reach for Redux, Zustand, or another state library only when the project already uses it or has a concrete integration requirement—not by importing React state patterns by habit.

## 6. Effects, memos, and lifecycle

### `createEffect` has automatic dependency tracking

Solid tracks reactive reads made synchronously during an effect execution. No React-style dependency array is used.

```tsx
createEffect(() => {
  console.log(count()); // re-runs when count changes
});
```

**Do not pass `[count()]` as a dependency array.** Solid's `createEffect` has a second parameter for its initial/previous value. A React-style array in that position is treated as that value, not as dependencies, which can cause confusing behavior.

When you need an explicit dependency list, use `on`:

```tsx
import { createEffect, on } from "solid-js";

createEffect(on(count, (value) => {
  console.log("count changed:", value);
}, { defer: true })); // skip the initial callback; run on later changes
```

By default, `on(...)` runs on the initial effect execution too; `{ defer: true }` skips that first callback. For a store property, pass a getter such as `() => state.user.name`, not the already-read value `state.user.name`.

Only reads made while the computation is tracking are dependencies. Reads in event handlers, in `untrack(...)`, or after an asynchronous suspension such as `await` do not magically become dependencies of the original synchronous run.

### Use memos for derived values; effects for side effects

```tsx
const fullName = createMemo(() => `${firstName()} ${lastName()}`);
// Read it as fullName(). The memo is read-only.
```

Do not normally create a third signal and synchronize it with `createEffect` just to derive a value from other signals. That adds an unnecessary update step and can cause loops. Use `createMemo` for derived reactive values; use `createEffect` for actual side effects such as logging, imperative APIs, or synchronizing with something outside Solid. Simple one-off calculations can remain inline and do not need a memo.

### Cleanup belongs to `onCleanup`

The function returned by an effect callback is **not** a React-style cleanup function. In Solid, the callback's return value is the effect's next previous-value argument. Register cleanup explicitly:

```tsx
import { createEffect, onCleanup } from "solid-js";

createEffect(() => {
  const id = setInterval(() => console.log(count()), 1000);
  onCleanup(() => clearInterval(id));
});
```

`onCleanup` runs when its owning scope is disposed; inside an effect, it also runs before that effect reruns. It must be registered within the relevant reactive owner/scope.

Use `onMount` for one-time client-only setup that needs initialized refs or browser APIs. `onMount` does not run during server-side rendering, and returning a function from it does not register cleanup—call `onCleanup` inside it if necessary.

### Async work

Avoid making `createEffect` itself `async` as a shortcut for fetching data. Tracking is synchronous, async race/cancellation behavior needs care, and a returned promise is not cleanup. Prefer `createResource` for reactive async data and loading/error states, with `Suspense` or explicit loading/error UI as appropriate. For event-triggered work, handle loading, errors, cancellation, and stale responses explicitly.

## 7. JSX, events, and DOM access

- **Events:** JSX syntax like `onClick={handler}` is correct in Solid, but event handlers are not reactive dependencies. If a handler needs current state, read the signal in the handler (`count()`), not in a setup-time snapshot. Solid delegates many common events. For custom or non-delegated events, use the documented `on:eventName` form when appropriate. `onInput` fires as input changes; `onChange` follows the browser's native change behavior.
- **Refs:** Do not reach for React's `useRef`. Solid can assign a DOM node to a variable with `ref`, for example `let input!: HTMLInputElement; return <input ref={input} />;`, then access it in `onMount`. Use callback refs where needed. For conditional elements, do not access the DOM before the element exists.
- **Never name a component prop `ref`:** the compiler treats `ref={x}` on a component as a ref binding, not a plain prop — a non-function value passed from a callback param or `let` is replaced by a generated `ref(r$)` method, so `props.ref` arrives as a function and the data is silently lost (verified in `babel-plugin-jsx-dom-expressions`: non-`const` LVal values are wrapped). Name data props anything else (`profile`, `target`, …). DOM elements keep real `ref` usage.
- **Children:** `props.children` is JSX content, not necessarily a plain array or a cheap-to-evaluate value. If a component needs to resolve or consume children multiple times, use Solid's `children(() => props.children)` helper.
- **Fragments:** Components can return fragments (`<>...</>`). Do not add a wrapper element solely because of a React assumption that the return must be one DOM element.
- **DOM vs. components:** A Solid component call is generally evaluated as part of constructing the reactive tree, not rerun like a React component whenever a prop changes. Dynamic prop/JSX expressions are updated through Solid's reactive machinery.

## 8. Common React-to-Solid translations

| React habit | Solid approach |
|---|---|
| `useState(0)` | `const [count, setCount] = createSignal(0)` |
| Read `count` directly | Call accessor: `count()` |
| `useMemo(() => derive(x), [x])` | `createMemo(() => derive(x()))`, when memoization is useful |
| `useEffect(fn, [x])` | `createEffect(() => { x(); ... })`, or `createEffect(on(x, fn))` for explicit tracking |
| Return cleanup from `useEffect` | Register `onCleanup(cleanup)` in the relevant scope |
| Destructure component props | Read `props.foo`; use `splitProps`/`mergeProps` for reactive partitioning/defaults |
| Local value computed from a signal in setup | Keep an accessor, derive in JSX, or use `createMemo` |
| `array.map(...)` for a changing list | Usually `<For>` or `<Index>` |
| `useRef` for a DOM node | `ref={element}` and `onMount` where needed |
| `useContext` from React | Solid's own `createContext` / `useContext` from `solid-js` |
| Put derived state in another setter via an effect | Derive directly or use `createMemo` |
| Fetch in `useEffect` by habit | Consider `createResource` or explicit event-driven async state |

React's `useState`, `useEffect`, `useMemo`, and `useCallback` are not Solid core APIs. Solid does have APIs with `use` in their names, such as its own `useContext`; the rule is to use Solid's APIs, not to ban every identifier beginning with `use`.

## 9. Tooling and project boundaries

Before writing code:

1. Read `package.json`, TypeScript config, Vite/framework config, and nearby components. Match their Solid version, file conventions, routing, styling, data fetching, and test setup.
2. Keep imports from the right packages: core primitives and control-flow components from `solid-js`; stores from `solid-js/store`; router/framework APIs from the project's installed integration.
3. Do not introduce React, React DOM, React hooks, `create-react-app`, or React-oriented libraries into a Solid app unless the project explicitly supports an integration requiring them.
4. Do not replace project tooling just because a generic tutorial uses it. For a new project only, follow current Solid documentation for Vite/`vite-plugin-solid` or SolidStart setup.
5. Run the project's existing typecheck, lint, and tests when available. A build passing does not prove reactive behavior is correct; exercise prop changes, signal updates, list insert/remove/reorder, and cleanup paths.

## 10. Agent checklist

Before returning Solid code, verify:

- [ ] I checked the project's Solid version and existing conventions.
- [ ] No prop was accidentally snapshotted by destructuring or ordinary object copying.
- [ ] Any local variable derived from state is intentionally a snapshot; values that must change are read reactively.
- [ ] Conditional JSX is valid and reactive; setup-time `if`/early returns are not being mistaken for reactive branches.
- [ ] Dynamic lists use `<For>` or `<Index>` where identity-aware list behavior matters.
- [ ] Signal getters are called (`count()`); store properties are read directly in a tracked context.
- [ ] Object/array state is updated through a signal setter or store setter rather than unnoticed in-place mutation.
- [ ] `createEffect` has no React-style dependency array and is not being used merely to derive state.
- [ ] Cleanup uses `onCleanup`; async tracking and race handling are deliberate.
- [ ] DOM refs, event handlers, children, imports, and framework-specific APIs follow Solid conventions.

## 11. References

Prefer the official documentation, and use documentation matching the version installed in the project:

- [SolidJS documentation](https://docs.solidjs.com/)
- [Component basics and lifecycle](https://docs.solidjs.com/concepts/components/basics)
- [Props, `splitProps`, and `mergeProps`](https://docs.solidjs.com/concepts/components/props)
- [Understanding JSX](https://docs.solidjs.com/concepts/understanding-jsx)
- [Conditional rendering](https://docs.solidjs.com/concepts/control-flow/conditional-rendering)
- [List rendering: `<For>` and `<Index>`](https://docs.solidjs.com/concepts/control-flow/list-rendering)
- [Signals](https://docs.solidjs.com/concepts/signals)
- [Stores](https://docs.solidjs.com/concepts/stores)
- [`createMemo`](https://docs.solidjs.com/reference/basic-reactivity/create-memo)
- [`createEffect`](https://docs.solidjs.com/reference/basic-reactivity/create-effect)
- [`on` utility](https://docs.solidjs.com/reference/reactive-utilities/on-util)
- [`onCleanup`](https://docs.solidjs.com/reference/lifecycle/on-cleanup)
- [`onMount`](https://docs.solidjs.com/reference/lifecycle/on-mount)
- [`createResource` and async data](https://docs.solidjs.com/reference/basic-reactivity/create-resource)
- [Event handlers](https://docs.solidjs.com/concepts/components/event-handlers)
- [Refs](https://docs.solidjs.com/concepts/refs)
- [Context](https://docs.solidjs.com/concepts/context)
- [SolidJS for React developers (Marmelab)](https://marmelab.com/blog/2025/05/28/solidjs-for-react-developper.html)
- [SolidJS skill in rsc-harness](https://github.com/ericrisco/rsc-harness/tree/main/skills/solid-js)
- [SolidJS Claude Skill Package](https://github.com/Impertio-Studio/SolidJS-Claude-Skill-Package)
