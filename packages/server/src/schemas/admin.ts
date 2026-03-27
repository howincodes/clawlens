import { z } from 'zod';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginRequestBody = z.infer<typeof LoginRequest>;

export const TokenResponse = z.object({
  token: z.string(),
  expires_in: z.number(),
});

export type TokenResponseBody = z.infer<typeof TokenResponse>;

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const CreateTeam = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

export type CreateTeamBody = z.infer<typeof CreateTeam>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const CreateUser = z.object({
  team_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  default_model: z.string().optional(),
  deployment_tier: z.enum(['standard', 'enforced', 'locked']).optional(),
});

export type CreateUserBody = z.infer<typeof CreateUser>;

export const UpdateUser = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  status: z.enum(['active', 'paused', 'killed']).optional(),
  default_model: z.string().optional(),
  deployment_tier: z.enum(['standard', 'enforced', 'locked']).optional(),
  subscription_id: z.string().optional(),
});

export type UpdateUserBody = z.infer<typeof UpdateUser>;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const LimitRule = z.object({
  type: z.enum(['total_credits', 'per_model', 'time_of_day']),
  model: z.string().optional(),
  value: z.number().positive(),
  window: z.enum(['hourly', 'daily', 'monthly']).optional(),
  start_hour: z.number().int().min(0).max(23).optional(),
  end_hour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().optional(),
});

export type LimitRuleBody = z.infer<typeof LimitRule>;

export const UpdateLimits = z.object({
  limits: z.array(LimitRule).min(1),
});

export type UpdateLimitsBody = z.infer<typeof UpdateLimits>;

// ---------------------------------------------------------------------------
// Pagination (shared query params)
// ---------------------------------------------------------------------------

export const PaginationQuery = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().positive().max(100).optional().default(25),
});

export type PaginationParams = z.infer<typeof PaginationQuery>;

// ---------------------------------------------------------------------------
// Date range filter (shared query params)
// ---------------------------------------------------------------------------

export const DateRangeQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type DateRangeParams = z.infer<typeof DateRangeQuery>;
