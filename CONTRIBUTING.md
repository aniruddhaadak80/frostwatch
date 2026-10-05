# Contributing

## Setup

```bash
git clone https://github.com/aniruddhaadak80/frostwatch.git
cd frostwatch
npm install
npm run dev
```

No environment variables are required for local development. Local runs use an embedded SQLite
database created on first use at `.data/frostwatch.db`.

## The loop

1. Open an issue for anything beyond a trivial fix.
2. Branch: `feat/`, `fix/`, `docs/`, `chore/`.
3. Conventional commits.
4. `npm run check` must exit 0.

## What not to break

- **One engine.** `src/lib/engine.ts` is the only implementation. The UI, `/api/engine` and the
  MCP tool must all call it. A second implementation of the score is a bug even if it agrees.
- **Integrity.** Never edit an applied event. Events are appended, and a retired sheet is
  tombstoned rather than deleted.
- **Honest provenance.** A fallback forecast must always be labelled `fallback`. Never present
  bundled sample data as live.
- **Production storage.** Never make a production build fall back to SQLite. Fail loudly instead.
- **Ownership.** Every query stays scoped by owner id.

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
npm run build       # next build
npm run verify:live # real HTTP checks against a deployment
```

## License

By contributing you agree that your contribution is licensed under the MIT License.