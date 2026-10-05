import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="state" data-kind="error" style={{ marginTop: '2rem' }}>
      <span className="state-title">That route is not part of Frostwatch.</span>
      <p>
        <Link href="/">Back to the board</Link> · <Link href="/sheets">Frost sheets</Link>
      </p>
    </div>
  )
}
