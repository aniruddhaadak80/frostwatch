import { NextResponse } from 'next/server'
import { ZodError, z } from 'zod'
import { StoreError } from './store'

/**
 * One error envelope for every route, so the UI, curl and the agent surface all see the same
 * shape and can branch on `error.code` instead of parsing prose.
 */

export function ok<T>(data: T, init: number = 200): NextResponse {
  return NextResponse.json(data as unknown as Record<string, unknown>, {
    status: init,
    headers: { 'cache-control': 'no-store' },
  })
}

export function fail(code: string, message: string, status = 400, details?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}

/** Never leak a stack trace or an env var to the client. */
export function toErrorResponse(cause: unknown): NextResponse {
  if (cause instanceof ZodError) {
    return fail('VALIDATION_FAILED', 'The request body did not match the schema.', 422, {
      issues: cause.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  if (cause instanceof StoreError) return fail(cause.code, cause.message, cause.status)
  const message = cause instanceof Error ? cause.message : String(cause)
  return fail('INTERNAL', message, 500)
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') throw new StoreError('VALIDATION_FAILED', 'A JSON body is required.', 400)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new StoreError('BAD_JSON', 'The request body is not valid JSON.', 400)
  }
}

// ---------------------------------------------------------------- schemas

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const createSheetSchema = z.object({
  blockId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  nightOf: z.string().regex(ISO_DATE, 'nightOf must be YYYY-MM-DD'),
  notes: z.string().max(600, 'notes must be 600 characters or fewer').default(''),
  actor: z.string().min(1).max(60).default('grower'),
})

export const updateSheetSchema = z
  .object({
    status: z.enum(['watching', 'protected', 'stood-down', 'retired']).optional(),
    notes: z.string().max(600).optional(),
    actor: z.string().min(1).max(60).default('grower'),
  })
  .refine((value) => value.status !== undefined || value.notes !== undefined, {
    message: 'Provide a status or notes to update',
  })

export const engineSchema = z.object({
  blockId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  thresholdC: z.number().min(-10).max(15).optional(),
  cropStage: z.enum(['bud-break', 'flowering', 'fruit-set', 'veraison']).optional(),
})

export type CreateSheet = z.infer<typeof createSheetSchema>
export type UpdateSheet = z.infer<typeof updateSheetSchema>
