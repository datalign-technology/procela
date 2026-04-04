export const INDUSTRIES = [
  'healthcare',
  'financial_services',
  'manufacturing',
  'retail',
  'technology',
  'energy',
  'telecommunications',
  'government',
  'education',
  'logistics',
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export interface ProcessContext {
  orgId: string;
  industry?: string;
  valueStreamId?: string;
  processId?: string;
  subProcessId?: string;
  processStepId?: string;
  processName?: string;
  processDescription?: string;
  existingDataAssets?: string[];
}

export interface OrgContext {
  orgId: string;
  industry?: string;
  orgName?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TokenPayload {
  sub: string;
  email: string;
  orgId: string;
  role: string;
  name?: string;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
