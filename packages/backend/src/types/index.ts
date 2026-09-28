export const INDUSTRIES = [
  'Utilities (Electric, Gas, Water)',
  'Defense & Shipbuilding',
  'Healthcare',
  'Manufacturing',
  'Oil & Gas',
  'Financial Services',
  'Transportation & Logistics',
  'State & Local Government',
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
  // 'service' is a non-human service-principal grant (an MCP agent bearer):
  // long-lived, revocable via its grant row, and org-scoped explicitly rather
  // than through the email→person path humans use. See routes/service-principals.
  type?: 'access' | 'refresh' | 'service';
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
