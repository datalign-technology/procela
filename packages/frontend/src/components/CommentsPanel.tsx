import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useOrgContext } from '../stores/orgContext';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';

// ──────────────────────────────────────────────────────────────────────────
// CommentsPanel — entity-agnostic threaded comments + @mention composer.
//
// Reused from System detail, Data Asset detail, Person detail, and
// process-node detail. The caller passes a stable {entityType, entityId}
// pair and an optional entityLabel (used inside @mention notifications,
// e.g. "mentioned you on System: SAP Finance"). Author identity comes
// from the authStore.
//
// Threading is one level deep, matching the backend contract: replies
// to replies collapse onto the original parent so we never nest more
// than two levels visually.
//
// Mention autocomplete: typing `@` opens a popover listing people in
// the active org whose names start with what the user types after the
// `@`. Arrow keys move selection, Enter / Tab inserts the full name,
// Escape closes the popover.
// ──────────────────────────────────────────────────────────────────────────

interface Comment {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  parentId: string | null;
  userId: string | null;
  userName: string;
  content: string;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface PersonOption {
  id: string;
  name: string;
}

interface Props {
  entityType: 'system' | 'dataAsset' | 'person' | 'processNode' | string;
  entityId: string;
  /** Optional - improves the @mention notification text. Defaults to "<entityType> <entityId>". */
  entityLabel?: string;
}

export default function CommentsPanel({ entityType, entityId, entityLabel }: Props) {
  const { activeOrgId } = useOrgContext();
  const currentUser = useAuthStore((s) => s.user);
  const addToast = useToastStore((s) => s.addToast);

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const refresh = async () => {
    if (!entityType || !entityId) return;
    try {
      const orgQ = activeOrgId ? `&orgId=${activeOrgId}` : '';
      const res = await apiClient.get<{ success: boolean; data: Comment[] }>(
        `/comments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}${orgQ}`,
      );
      setComments(res.data || []);
    } catch {
      setComments([]);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, activeOrgId]);

  useEffect(() => {
    // People list for @mention autocomplete. Fetched once per org.
    if (!activeOrgId) { setPeople([]); return; }
    let cancelled = false;
    apiClient
      .get<{ success: boolean; data: PersonOption[] }>(`/people?orgId=${activeOrgId}`)
      .then((res) => { if (!cancelled) setPeople((res.data || []).map((p) => ({ id: p.id, name: p.name }))); })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, [activeOrgId]);

  const topLevel = useMemo(
    () => (comments || []).filter((c) => c.parentId === null),
    [comments],
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<string, Comment[]>();
    for (const c of comments || []) {
      if (c.parentId) {
        if (!map.has(c.parentId)) map.set(c.parentId, []);
        map.get(c.parentId)!.push(c);
      }
    }
    return map;
  }, [comments]);

  const submit = async (content: string, parentId: string | null) => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await apiClient.post('/comments', {
        entityType, entityId, orgId: activeOrgId,
        content: content.trim(),
        parentId,
        userName: currentUser?.name,
        entityLabel,
      });
      setDraft('');
      setReplyTo(null);
      await refresh();
    } catch (e: any) {
      addToast('error', e?.message || 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId || !editDraft.trim()) return;
    try {
      await apiClient.patch(`/comments/${editingId}`, { content: editDraft.trim(), entityLabel });
      setEditingId(null);
      setEditDraft('');
      await refresh();
    } catch {
      addToast('error', 'Failed to save edit');
    }
  };

  const removeComment = async (id: string) => {
    try {
      await apiClient.delete(`/comments/${id}`);
      await refresh();
    } catch {
      addToast('error', 'Failed to delete comment');
    }
  };

  const canEditOrDelete = (c: Comment): boolean => {
    if (c.deletedAt) return false;
    if (!c.userId) return true;  // anonymous comments — anyone can clean up
    return !!currentUser && currentUser.id === c.userId;
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {comments === null ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading comments…</div>
        ) : topLevel.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            No comments yet. Be the first to start a thread.
          </div>
        ) : (
          topLevel.map((c) => (
            <CommentNode
              key={c.id}
              comment={c}
              replies={repliesByParent.get(c.id) || []}
              canEditOrDelete={canEditOrDelete}
              editingId={editingId}
              editDraft={editDraft}
              setEditingId={setEditingId}
              setEditDraft={setEditDraft}
              onSaveEdit={saveEdit}
              onDelete={removeComment}
              onReply={(target) => setReplyTo(target)}
              people={people}
              replyOpenFor={replyTo?.id === c.id ? c.id : (replyTo && replyTo.parentId === c.id ? c.id : null)}
              replyDraft={draft}
              setReplyDraft={setDraft}
              onSubmitReply={(content) => submit(content, c.id)}
              submitting={submitting}
              onCancelReply={() => { setReplyTo(null); setDraft(''); }}
            />
          ))
        )}
      </div>

      {/* New top-level composer */}
      {replyTo === null && (
        <Composer
          placeholder="Add a comment. Type @ to mention someone."
          value={draft}
          onChange={setDraft}
          people={people}
          submitting={submitting}
          onSubmit={() => submit(draft, null)}
        />
      )}
    </div>
  );
}

// ── Comment node (top-level + its replies) ──────────────────────────────

interface NodeProps {
  comment: Comment;
  replies: Comment[];
  canEditOrDelete: (c: Comment) => boolean;
  editingId: string | null;
  editDraft: string;
  setEditingId: (id: string | null) => void;
  setEditDraft: (s: string) => void;
  onSaveEdit: () => void;
  onDelete: (id: string) => void;
  onReply: (target: Comment) => void;
  people: PersonOption[];
  replyOpenFor: string | null;
  replyDraft: string;
  setReplyDraft: (s: string) => void;
  onSubmitReply: (content: string) => void;
  submitting: boolean;
  onCancelReply: () => void;
}

function CommentNode(props: NodeProps) {
  const { comment, replies } = props;
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)', padding: 10 }}>
      <CommentRow {...props} comment={comment} />
      {replies.length > 0 && (
        <div style={{ marginTop: 8, marginLeft: 20, paddingLeft: 12, borderLeft: '2px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {replies.map((r) => (
            <CommentRow key={r.id} {...props} comment={r} />
          ))}
        </div>
      )}
      {props.replyOpenFor === comment.id && (
        <div style={{ marginTop: 8, marginLeft: 20 }}>
          <Composer
            placeholder={`Reply to ${comment.userName}. Type @ to mention someone.`}
            value={props.replyDraft}
            onChange={props.setReplyDraft}
            people={props.people}
            submitting={props.submitting}
            onSubmit={() => props.onSubmitReply(props.replyDraft)}
            secondary={<button onClick={props.onCancelReply} style={textBtn}>Cancel</button>}
          />
        </div>
      )}
    </div>
  );
}

function CommentRow(props: NodeProps & { comment: Comment }) {
  const { comment, canEditOrDelete, editingId, editDraft, setEditingId, setEditDraft, onSaveEdit, onDelete, onReply } = props;
  const isEditing = editingId === comment.id;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
        <strong style={{ color: 'var(--color-text)' }}>{comment.userName}</strong>
        <span title={new Date(comment.createdAt).toLocaleString()}>{relativeTime(comment.createdAt)}</span>
        {comment.updatedAt !== comment.createdAt && !comment.deletedAt && <span style={{ fontStyle: 'italic' }}>· edited</span>}
        {comment.deletedAt && <span style={{ fontStyle: 'italic' }}>· deleted</span>}
      </div>
      {comment.deletedAt ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic', marginTop: 4 }}>
          (comment removed)
        </div>
      ) : isEditing ? (
        <div style={{ marginTop: 6 }}>
          <Composer
            value={editDraft}
            onChange={setEditDraft}
            people={props.people}
            submitting={false}
            onSubmit={onSaveEdit}
            submitLabel="Save"
            placeholder="Edit comment"
            secondary={<button style={textBtn} onClick={() => { setEditingId(null); setEditDraft(''); }}>Cancel</button>}
          />
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {renderBodyWithMentions(comment.content)}
        </div>
      )}
      {!isEditing && !comment.deletedAt && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {comment.parentId === null && (
            <button style={textBtn} onClick={() => onReply(comment)}>Reply</button>
          )}
          {canEditOrDelete(comment) && (
            <>
              <button style={textBtn} onClick={() => { setEditingId(comment.id); setEditDraft(comment.content); }}>Edit</button>
              <button style={{ ...textBtn, color: 'var(--color-error)' }} onClick={() => onDelete(comment.id)}>Delete</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Composer with @mention autocomplete ─────────────────────────────────

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  people: PersonOption[];
  onSubmit: () => void;
  submitting: boolean;
  submitLabel?: string;
  placeholder?: string;
  secondary?: React.ReactNode;
}

function Composer({ value, onChange, people, onSubmit, submitting, submitLabel = 'Post', placeholder, secondary }: ComposerProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Mention autocomplete state: when the cursor sits at `@partial`, we
  // show a popover listing people whose names start with `partial`.
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [hoverIdx, setHoverIdx] = useState(0);

  const matches = useMemo(() => {
    if (mentionStart === null) return [];
    const q = mentionQuery.toLowerCase();
    return people.filter((p) => p.name.toLowerCase().startsWith(q)).slice(0, 6);
  }, [people, mentionStart, mentionQuery]);

  // Detects whether the cursor is inside a `@...` token and updates
  // the mention popover state accordingly.
  const recomputeMentionState = (nextValue: string, caret: number) => {
    let i = caret - 1;
    while (i >= 0 && /[A-Za-z0-9 ]/.test(nextValue[i])) i--;
    if (i >= 0 && nextValue[i] === '@' && (i === 0 || /\s/.test(nextValue[i - 1]))) {
      const partial = nextValue.slice(i + 1, caret);
      // Cap the partial length so typing a long paragraph doesn't keep
      // the popover open if the user clearly isn't writing a name.
      if (partial.length <= 40 && !partial.includes('\n')) {
        setMentionStart(i);
        setMentionQuery(partial);
        setHoverIdx(0);
        return;
      }
    }
    setMentionStart(null);
    setMentionQuery('');
  };

  const insertMention = (person: PersonOption) => {
    if (mentionStart === null || !taRef.current) return;
    const ta = taRef.current;
    const before = value.slice(0, mentionStart);
    const after = value.slice(ta.selectionStart);
    const inserted = `@${person.name} `;
    const next = before + inserted + after;
    onChange(next);
    setMentionStart(null);
    setMentionQuery('');
    // Move caret to just after the inserted name.
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      const pos = (before + inserted).length;
      taRef.current.focus();
      taRef.current.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionStart !== null && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHoverIdx((i) => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHoverIdx((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(matches[hoverIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionStart(null); setMentionQuery(''); return; }
    }
    if ((e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      if (!submitting && value.trim()) onSubmit();
    }
  };

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => { onChange(e.target.value); recomputeMentionState(e.target.value, e.target.selectionStart); }}
          onKeyDown={onKeyDown}
          onSelect={(e) => recomputeMentionState(value, (e.target as HTMLTextAreaElement).selectionStart)}
          rows={3}
          placeholder={placeholder}
          /* combobox semantics so screen readers describe the @-mention
           * popover as an associated suggestion list. The textarea drives
           * navigation via arrow keys; aria-activedescendant points at the
           * highlighted option's id. */
          role="combobox"
          aria-expanded={mentionStart !== null && matches.length > 0}
          aria-autocomplete="list"
          aria-controls={mentionStart !== null && matches.length > 0 ? 'comment-mentions' : undefined}
          aria-activedescendant={
            mentionStart !== null && matches.length > 0
              ? `comment-mention-opt-${hoverIdx}`
              : undefined
          }
          style={{
            width: '100%', boxSizing: 'border-box',
            fontSize: 13, padding: '6px 10px', fontFamily: 'inherit',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)', resize: 'vertical', minHeight: 60,
          }}
        />
        {mentionStart !== null && matches.length > 0 && (
          <div
            id="comment-mentions"
            role="listbox"
            aria-label="People to mention"
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 2,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
              minWidth: 180, maxWidth: 260, zIndex: 10, padding: 4,
            }}
          >
            {matches.map((p, idx) => (
              <div
                key={p.id}
                id={`comment-mention-opt-${idx}`}
                role="option"
                aria-selected={idx === hoverIdx}
                onMouseDown={(e) => { e.preventDefault(); insertMention(p); }}
                onMouseEnter={() => setHoverIdx(idx)}
                style={{
                  padding: '4px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 4,
                  background: idx === hoverIdx ? 'var(--color-bg)' : 'transparent',
                }}
              >
                {p.name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
        <button
          onClick={onSubmit}
          disabled={submitting || !value.trim()}
          style={{
            padding: '5px 12px', fontSize: 12, fontWeight: 500,
            background: 'var(--color-primary)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)',
            cursor: submitting || !value.trim() ? 'default' : 'pointer',
            opacity: submitting || !value.trim() ? 0.5 : 1,
          }}
        >
          {submitting ? 'Posting…' : submitLabel}
        </button>
        {secondary}
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
          Cmd/Ctrl + Enter to post
        </span>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

const textBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0,
  fontSize: 11, color: 'var(--color-primary)', cursor: 'pointer',
  fontFamily: 'inherit',
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Render the body text, visually highlighting @Mentions so readers can see
// at a glance who was tagged. The match here mirrors the backend's
// longest-name-at-`@` algorithm but works on the raw string without the
// people list - so we only highlight tokens that look like names, not
// arbitrary @ strings.
function renderBodyWithMentions(body: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < body.length) {
    const at = body.indexOf('@', i);
    if (at === -1) { parts.push(body.slice(i)); break; }
    parts.push(body.slice(i, at));
    // Greedy: pick the longest run of word-char-or-space starting after @
    // that ends at a word boundary. This is heuristic; the canonical
    // mention list is on the comment object.
    let end = at + 1;
    while (end < body.length && /[A-Za-z0-9 .']/.test(body[end])) end++;
    // Trim trailing whitespace - mentions usually end with a single space
    // that's part of the surrounding text, not the name.
    let nameEnd = end;
    while (nameEnd > at + 1 && body[nameEnd - 1] === ' ') nameEnd--;
    const token = body.slice(at, nameEnd);
    parts.push(<span key={at} style={{ color: 'var(--color-primary)', fontWeight: 500 }}>{token}</span>);
    i = nameEnd;
  }
  return parts;
}
