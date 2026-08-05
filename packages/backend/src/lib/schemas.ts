import { z } from 'zod';

export const createValueStreamSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
});

export const createSystemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  systemType: z.string().optional(),
  owner: z.string().optional(),
  steward: z.string().optional(),
});

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  parentId: z.string().optional(),
  type: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
});

export const createPersonSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  orgId: z.string().min(1, 'Organization ID is required'),
  email: z.string().email().optional(),
  role: z.string().optional(),
  title: z.string().optional(),
});

export const createDataAssetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  systemId: z.string().optional(),
  owner: z.string().optional(),
  steward: z.string().optional(),
  governanceTier: z.enum(['BRONZE', 'SILVER', 'GOLD']),
  healthScore: z.number().min(0).max(100),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  name: z.string().min(1, 'Name is required'),
});
