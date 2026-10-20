// Feed descriptor guard (slice 3.3). The query key lives in
// `#/state/queries` (`feedQueryKey`, sessionId first) — slice 3.11 removed
// the duplicate builder that used to sit here.

/** True for non-empty descriptors (full validation: `isFeedDescriptor` in `@keystone/fedi`). */
export function isFeedDescriptor(descriptor: string): boolean {
  return descriptor.trim().length > 0
}
