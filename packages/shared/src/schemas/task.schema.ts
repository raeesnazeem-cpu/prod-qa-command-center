import { z } from 'zod';

export const TaskStatusSchema = z.enum(['open', 'in_progress', 'resolved', 'closed']);
export const TaskSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const CreateTaskSchema = z.object({
  finding_id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  severity: TaskSeveritySchema,
  assigned_to: z.string().uuid().optional(),
  gallery_images: z.array(z.string()).max(10).optional(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial().extend({
  status: TaskStatusSchema.optional(),
});

export const CreateCommentSchema = z.object({
  task_id: z.string().uuid(),
  content: z.string().min(1, 'Comment cannot be empty').max(2000, 'Comment is too long'),
});

export const RebuttalSchema = z.object({
  task_id: z.string().uuid(),
  text: z.string().min(1, 'Rebuttal text is required'),
  screenshot_url: z.string().url().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
export type RebuttalInput = z.infer<typeof RebuttalSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskSeverity = z.infer<typeof TaskSeveritySchema>;
