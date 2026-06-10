import { z } from 'zod';

export const CreateProjectSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  site_url: z.string().url('Invalid site URL'),
  client_name: z.string().optional(),
  is_woocommerce: z.boolean().default(false),
  is_pre_release: z.boolean().default(false),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  status: z.enum(['active', 'archived']).optional(),
  figma_access_token: z.string().optional(),
  basecamp_account_id: z.string().optional(),
  basecamp_project_id: z.string().optional(),
  basecamp_todo_list_id: z.string().optional(),
  basecamp_post_todo_list_id: z.string().optional(),
  basecamp_api_token: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
