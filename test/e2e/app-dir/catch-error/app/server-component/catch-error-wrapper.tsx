'use client'

export function ErrorFallback(
  props: { title: string },
  {
    error,
    reset,
    retry,
  }: { error: Error; reset: () => void; retry: () => void }
) {
  return (
    <>
      <p id="error-boundary-message">{error.message}</p>
      <p id="error-boundary-title">{props.title}</p>
      <button id="reset" onClick={() => reset()}>
        Reset
      </button>
      <button id="retry" onClick={() => retry()}>
        Retry
      </button>
    </>
  )
}
