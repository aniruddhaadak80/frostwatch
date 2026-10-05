# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

## Reporting a vulnerability

Do not open a public issue. Use GitHub Security Advisories ("Security" -> "Report a vulnerability").

Include what an attacker could do, the exact request to reproduce it, the commit, and whether a
session cookie is needed.

## What an attacker gets by default

Nothing. There are no accounts. Every record is scoped to an unguessable 128-bit owner id in an
HTTP-only cookie, and every read, update and delete is filtered by it. A valid sheet id belonging
to another session returns 404 rather than 403, so ids cannot be probed for existence.

## Measures in place

- Parameterised queries only; no string-built SQL anywhere.
- Every input validated with zod and bounded in length; query strings, notes and enums are
  length- and shape-checked before they reach the store.
- External requests are allowlisted to Open-Meteo and api.weather.gov, time-bounded to 8s, and
  retried at most twice.
- Error responses carry a stable code and a message. Stack traces and environment variables are
  never returned.
- A production build without DATABASE_URL refuses to start rather than silently degrading to an
  ephemeral store.
- The audit chain is append-only in application terms and tombstoned rather than deleted, so
  replay can detect tampering.

## Abuse controls on serverless

Per-session rate limiting is best-effort here: the owner id lives in a cookie, so clearing it
yields a fresh identity. That is acceptable for a read-mostly forecast product but is not a
substitute for a hosted rate limiter. Deployments expecting write traffic should put a limiter in
front of /api/sheets and /api/mcp.