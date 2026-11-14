/**
 * Wraps a query function so that it reads TanStack Query's AbortSignal one microtask after the
 * query starts, instead of immediately.
 *
 * Why: TanStack Query aborts an in-flight fetch when its last observer unmounts, but only if the
 * query function has already read `signal`. React Strict Mode (development only) mounts every
 * component, unmounts it and mounts it again synchronously; with an immediate read, that simulated
 * unmount aborted every first request (a "(canceled)" request in DevTools, then a second, identical
 * one). Deferring the read lets the remount re-attach to the same in-flight request, so nothing is
 * cancelled or repeated. Real cancellations are unaffected: once the request is under way, the
 * signal has been read, and leaving the view or changing its parameters aborts it as before.
 *
 * Important: do not destructure `signal` in the wrapper's caller; that would read it immediately.
 */
export function withSignal<
  T,
  C extends { readonly signal: AbortSignal } = { readonly signal: AbortSignal },
>(run: (signal: AbortSignal, context: C) => Promise<T>) {
  return async (context: C): Promise<T> => {
    await Promise.resolve();
    // Other context fields (e.g. an infinite query's pageParam) can be read freely: only the
    // signal getter marks the signal as consumed.
    return run(context.signal, context);
  };
}
