import { apiClient } from '../api/client';

// ──────────────────────────────────────────────────────────────────────────
// Report folders — shared client types + fetch helper.
//
// A report's folder drives its audience: a report in a `shared` folder (the
// built-in "Public" folder, or a user folder toggled shared) is visible to
// the whole org; a report in a personal folder — or in no folder — is private
// to its owner. Both the Reports list (folder rail) and the Report Builder
// (folder picker) read the same folders, so the type + fetch live here.
// ──────────────────────────────────────────────────────────────────────────

export interface ReportFolder {
  id: string;
  orgId: string;
  name: string;
  /** Creator. null for the system Public folder. */
  ownerId: string | null;
  /** 'system' = the built-in Public folder (immutable); 'user' = user-created. */
  kind: 'system' | 'user';
  /** Reports in a shared folder are org-visible. Always true for Public. */
  shared: boolean;
  /** Manual rail order among user folders (drag-to-reorder). */
  orderIndex?: number;
  createdAt: string;
  updatedAt: string;
}

/** Rail/select sentinel: reports in no folder (uncategorized ⇒ private). */
export const NO_FOLDER = '__none__';

export async function fetchReportFolders(orgId: string): Promise<ReportFolder[]> {
  const r = await apiClient.get<{ success: boolean; data: ReportFolder[] }>(`/report-folders?orgId=${orgId}`);
  return r.data || [];
}
