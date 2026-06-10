import { z } from 'zod';

export const FindingSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const FindingStatusSchema = z.enum(['open', 'confirmed', 'false_positive']);

export const FindingSchema = z.object({
  id: z.string().uuid().optional(),
  page_id: z.string().uuid().optional(),
  run_id: z.string().uuid().optional(),
  check_factor: z.string(),
  severity: FindingSeveritySchema,
  title: z.string(),
  description: z.string().nullable().optional(),
  context_text: z.string().nullable().optional(),
  screenshot_url: z.string().url().nullable().optional(),
  status: FindingStatusSchema.default('open'),
  ai_generated: z.boolean().default(false),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingStatus = z.infer<typeof FindingStatusSchema>;
