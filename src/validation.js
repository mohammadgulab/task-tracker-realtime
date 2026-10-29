const { z } = require('zod');

const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const assignee = z.number().int().positive().nullable();

const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  description: z.string().trim().max(2000).optional().default(''),
  priority: z.enum(PRIORITIES).optional().default('medium'),
  status: z.enum(STATUSES).optional().default('todo'),
  assignee_id: assignee.optional().default(null),
});

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120),
    description: z.string().trim().max(2000),
    priority: z.enum(PRIORITIES),
    status: z.enum(STATUSES),
    assignee_id: assignee,
    position: z.number().int().min(0),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field to update' });

const idParam = z.coerce.number().int().positive();

module.exports = {
  STATUSES,
  PRIORITIES,
  registerSchema,
  loginSchema,
  createTaskSchema,
  updateTaskSchema,
  idParam,
};
