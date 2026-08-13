import { z } from 'zod';

export const FindingStatusSchema = z.enum(['open', 'confirmed', 'false_positive']);

export const FindingSchema = z.object({
  id: z.string().uuid().optional(),
  page_id: z.string().uuid().optional(),
  run_id: z.string().uuid().optional(),
  check_factor: z.string(),
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
export type FindingStatus = z.infer<typeof FindingStatusSchema>;
