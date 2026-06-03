import { useEffect, useState, useRef } from 'react';
import { apiClient } from '../api/client';
import Modal from './Modal';

interface Attachment {
  id: string;
  entityType: string;
  entityId: string;
  type: 'FILE' | 'URL';
  name: string;
  description: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  url?: string;
  createdAt: string;
}

interface AttachmentsPanelProps {
  entityType: string;
  entityId: string;
  orgId?: string;
  disabled?: boolean;
  /** Suppress the internal "Attachments (N)" title — used when an outer
   *  collapsible section already renders the title. The Add button is kept. */
  hideHeader?: boolean;
  /** Reports the current attachment count to a parent (for a section badge). */
  onCount?: (n: number) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType?: string, type?: string): string {
  if (type === 'URL') return '\u{1F517}'; // link
  if (!mimeType) return '\u{1F4C4}'; // generic file
  if (mimeType.includes('pdf')) return '\u{1F4D5}'; // red book
  if (mimeType.includes('word') || mimeType.includes('document')) return '\u{1F4DD}';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '\u{1F4CA}';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '\u{1F4C8}';
  if (mimeType.startsWith('image/')) return '\u{1F5BC}';
  if (mimeType.startsWith('text/')) return '\u{1F4C3}';
  return '\u{1F4C4}';
}

export default function AttachmentsPanel({ entityType, entityId, orgId, disabled, hideHeader, onCount }: AttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: Attachment[] }>(
        `/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      );
      setAttachments(res.data || []);
      onCount?.((res.data || []).length);
    } catch { /* */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId, entityType]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this attachment?')) return;
    try {
      await apiClient.delete(`/attachments/${id}`);
      load();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete');
    }
  };

  const handleFileUpload = async (file: File, name: string, description: string) => {
    setUploading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        entityType,
        entityId,
        name: name || file.name,
        description: description || '',
      });
      if (orgId) params.set('orgId', orgId);
      await apiClient.upload(`/attachments/upload?${params.toString()}`, file);
      setShowModal(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleUrlSubmit = async (name: string, description: string, url: string) => {
    setUploading(true);
    setError(null);
    try {
      await apiClient.post('/attachments/url', {
        entityType, entityId, name, description, url,
        ...(orgId ? { orgId } : {}),
      });
      setShowModal(false);
      load();
    } catch (e: any) {
      setError(e?.message || 'Failed to save link');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = (a: Attachment) => {
    if (a.type === 'URL' && a.url) {
      window.open(a.url, '_blank', 'noopener,noreferrer');
    } else {
      // Need to open with auth header — fetch as blob then download
      apiClient.get<Blob>(`/attachments/${a.id}/download`).catch(() => {
        // Simpler approach: open in new tab with token in query (dev only) or let browser handle it
      });
      // Actually for file download, we can just navigate — browser uses cookies/auth headers isn't possible without JS
      // Use fetch with auth and trigger download
      fetch(`/api/v1/attachments/${a.id}/download`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth-storage') ? JSON.parse(localStorage.getItem('auth-storage')!).state.accessToken : ''}` },
      }).then((r) => r.blob()).then((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = a.fileName || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    }
  };

  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: '#fafbfc', borderRadius: 4, border: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: hideHeader ? 'flex-end' : 'space-between', marginBottom: 6 }}>
        {!hideHeader && (
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Attachments ({attachments.length})
          </div>
        )}
        {!disabled && (
          <button onClick={() => setShowModal(true)}
            style={{ fontSize: 10, padding: '2px 8px', background: 'transparent', border: '1px dashed var(--color-border)', borderRadius: 3, cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            + Add Attachment
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Loading...</div>
      ) : attachments.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          No attachments yet. Attach process documentation, diagrams, SOPs, or external links.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {attachments.map((a) => (
            <div key={a.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', background: 'var(--color-surface)',
                borderRadius: 4, border: '1px solid var(--color-border)', fontSize: 11,
              }}
            >
              <span style={{ fontSize: 16 }}>{getFileIcon(a.mimeType, a.type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                {a.description && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description}</div>
                )}
                <div style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 1 }}>
                  {a.type === 'URL' ? (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 300 }}>{a.url}</span>
                  ) : (
                    <>
                      {a.fileName} &middot; {a.fileSize ? formatSize(a.fileSize) : ''}
                    </>
                  )}
                </div>
              </div>
              <button onClick={() => handleDownload(a)}
                style={{ fontSize: 10, padding: '2px 8px', background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
                {a.type === 'URL' ? 'Open' : 'Download'}
              </button>
              {!disabled && (
                <button onClick={() => handleDelete(a.id)}
                  aria-label="Delete attachment"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-error)', padding: '0 4px' }}
                  title="Delete">
                  &times;
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 6, padding: '4px 8px', background: '#fee2e2', color: '#991b1b', borderRadius: 3, fontSize: 11 }}>
          {error}
        </div>
      )}

      {showModal && (
        <AttachmentModal
          onClose={() => setShowModal(false)}
          onUploadFile={handleFileUpload}
          onSubmitUrl={handleUrlSubmit}
          uploading={uploading}
          error={error}
        />
      )}
    </div>
  );
}

// ── Modal ──

function AttachmentModal({ onClose, onUploadFile, onSubmitUrl, uploading, error }: {
  onClose: () => void;
  onUploadFile: (file: File, name: string, description: string) => void;
  onSubmitUrl: (name: string, description: string, url: string) => void;
  uploading: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (tab === 'file') {
      if (!file) return;
      onUploadFile(file, name, description);
    } else {
      if (!name.trim() || !url.trim()) return;
      onSubmitUrl(name, description, url);
    }
  };

  const canSubmit = tab === 'file' ? !!file : (name.trim() && url.trim());

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Add Attachment"
      footer={
        <>
          <button onClick={onClose} disabled={uploading}
            style={{ padding: '6px 14px', fontSize: 13, background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit || uploading}
            style={{
              padding: '6px 14px', fontSize: 13, background: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 4, cursor: canSubmit && !uploading ? 'pointer' : 'default',
              opacity: canSubmit && !uploading ? 1 : 0.5,
            }}>
            {uploading ? 'Saving...' : tab === 'file' ? 'Upload' : 'Add Link'}
          </button>
        </>
      }
    >
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
          <button onClick={() => setTab('file')}
            style={{
              padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === 'file' ? 600 : 400,
              color: tab === 'file' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              borderBottom: tab === 'file' ? '2px solid var(--color-primary)' : '2px solid transparent',
            }}
          >
            Upload File
          </button>
          <button onClick={() => setTab('url')}
            style={{
              padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === 'url' ? 600 : 400,
              color: tab === 'url' ? 'var(--color-primary)' : 'var(--color-text-muted)',
              borderBottom: tab === 'url' ? '2px solid var(--color-primary)' : '2px solid transparent',
            }}
          >
            Link to URL
          </button>
        </div>

        {tab === 'file' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>File *</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.png,.jpg,.jpeg,.gif,.svg,.webp,.json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setFile(f);
                    if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
                  }
                }}
                style={{ fontSize: 13 }}
              />
              {file && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {file.name} &middot; {formatSize(file.size)}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Max 10 MB. Allowed: PDF, Word, Excel, PowerPoint, TXT, CSV, MD, images, JSON.
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Display Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Defaults to filename if blank"
                style={{ width: '100%', fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — e.g. 'SOP v2.3 for customer onboarding'"
                style={{ width: '100%', fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 4 }} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Display Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 'Customer Onboarding SOP (Confluence)'"
                style={{ width: '100%', fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>URL *</label>
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                style={{ width: '100%', fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }}>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                style={{ width: '100%', fontSize: 13, padding: '6px 10px', border: '1px solid var(--color-border)', borderRadius: 4 }} />
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: '6px 10px', background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontSize: 12 }}>
            {error}
          </div>
        )}
    </Modal>
  );
}
