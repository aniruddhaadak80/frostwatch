'use client'

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="state" data-kind="error" style={{ marginTop: '2rem' }}>
      <span className="state-title">Something failed while rendering this page.</span>
      <p style={{ fontSize: '0.9rem' }}>
        The error has been reported to the server log. Retrying re-runs the same code path.
      </p>
      <button className="btn" data-variant="primary" onClick={reset} type="button">
        Try again
      </button>
    </div>
  )
}
