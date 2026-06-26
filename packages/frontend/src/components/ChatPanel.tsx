import { useState, useRef, useEffect, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useOrgContext } from '../stores/orgContext';
import { useAuthStore } from '../stores/authStore';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Entity {
  name: string;
  kind: 'activity' | 'process' | 'system' | 'asset' | 'person';
  url: string;
}

// Escape regex special characters in entity names so a system called
// "SAP Finance (EU)" doesn't try to compile its parentheses as a
// capture group.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Allowlist of Procela page paths the assistant is permitted to link
// to via markdown. Anything else in a `[name](/path)` block is left
// as plain text — keeps a hallucinated route from rendering as a
// broken navigation chip. Kept in sync with the list embedded in the
// system prompt on the backend (see ai.service.ts → buildChatSystemPrompt).
const NAVIGABLE_PATHS = new Set<string>([
  '/', '/processes', '/processes/data-map', '/data-assets', '/data-assets/orphans',
  '/systems', '/data-domains', '/data-quality', '/mappings', '/gap-detection',
  '/people', '/dama-roles', '/governance-groups', '/reports', '/audit-log',
]);

// Pass A: extract markdown navigation links `[name](/path)` and
// render each as a navigation chip. Surrounding text is returned as
// segments so Pass B (entity-name linking) only runs on plain text.
function splitOnMarkdownLinks(text: string): Array<string | { kind: 'nav'; name: string; url: string }> {
  const out: Array<string | { kind: 'nav'; name: string; url: string }> = [];
  const re = /\[([^\]]+)\]\((\/[^\s)]*)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (NAVIGABLE_PATHS.has(m[2])) {
      out.push({ kind: 'nav', name: m[1], url: m[2] });
    } else {
      // Unknown path — render as plain text rather than a broken link.
      out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Pass B: within a plain-text segment, replace entity-name mentions
// with React Router links. Longest-first sort on the entity list
// (done backend-side) means "Customer Billing Master" matches before
// "Customer" — important because regex alternation is leftmost-first.
function linkEntitiesInSegment(text: string, entities: Entity[]): React.ReactNode[] {
  if (entities.length === 0 || !text) return [text];
  const byName = new Map(entities.map((e) => [e.name, e]));
  const pattern = new RegExp(`\\b(${entities.map((e) => escapeRegex(e.name)).join('|')})\\b`, 'g');
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const entity = byName.get(m[1]);
    if (entity) {
      out.push(
        <Link
          key={`e-${m.index}-${entity.name}`}
          to={entity.url}
          style={{ color: 'var(--color-primary)', textDecoration: 'underline', fontWeight: 500 }}
          title={`${entity.kind}: ${entity.name}`}
        >
          {entity.name}
        </Link>,
      );
    } else {
      out.push(m[1]);
    }
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Render an assistant message with two kinds of inline links:
//   - Markdown-style navigation links the model can emit to point the
//     user at a specific Procela page ([Orphan Assets](/data-assets/orphans))
//   - Entity-name mentions automatically linked to their catalog page
//     based on the entity index the backend ships at the end of each stream.
function renderAssistantText(text: string, entities: Entity[]): React.ReactNode {
  if (!text) return text;
  const segments = splitOnMarkdownLinks(text);
  const out: React.ReactNode[] = [];
  segments.forEach((seg, i) => {
    if (typeof seg === 'string') {
      const linked = linkEntitiesInSegment(seg, entities);
      linked.forEach((node, j) => out.push(<Fragment key={`s${i}-${j}`}>{node}</Fragment>));
    } else {
      out.push(
        <Link
          key={`n${i}`}
          to={seg.url}
          title={`Open ${seg.name}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 8px',
            margin: '0 1px',
            background: 'var(--color-primary)',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            verticalAlign: 'baseline',
          }}
        >
          {seg.name} <span aria-hidden="true">→</span>
        </Link>,
      );
    }
  });
  return out;
}

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  // Entities for inline citations, scoped to the current conversation
  // mount. The streaming /chat/stream endpoint sends one entities
  // frame at the end of each reply; we keep them around so the
  // rendered assistant turn (and any subsequent ones) can swap
  // entity-name mentions for links back to the catalog.
  const [entities, setEntities] = useState<Entity[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { activeOrgId, activeOrgName } = useOrgContext();
  // The mobile sidebar collapses to a ~60px fixed bottom strip, so the
  // floating chat bubble has to ride above it; on desktop we can pin
  // to the viewport corner like before.
  const bubbleBottom = isMobile ? 80 : 24;
  const panelStyle = isMobile
    ? { left: 8, right: 8, bottom: bubbleBottom + 56, top: 56, width: 'auto' as const, height: 'auto' as const }
    : { right: 24, bottom: bubbleBottom + 56, width: 400, height: 520 };

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Allow the top-bar "Ask AI" button (and any future entry point) to
  // open the panel without lifting state into Layout. The event is a
  // simple toggle so the same button can also close the panel. Each
  // change also broadcasts procela:chat-state so external buttons can
  // reflect open/closed in their aria-expanded and active styling.
  useEffect(() => {
    const handler = () => setOpen((o) => !o);
    window.addEventListener('procela:toggle-chat', handler);
    return () => window.removeEventListener('procela:toggle-chat', handler);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('procela:chat-state', { detail: { open } }));
  }, [open]);

  async function send(text: string) {
    if (!text || loading) return;
    const userMsg: Message = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    // Seed the assistant turn empty so chunks have somewhere to land
    // as they arrive. The render loop reads `messages[i].content`
    // directly, so each chunk-append re-renders the bubble incrementally.
    const assistantIndex = updated.length;
    setMessages([...updated, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);

    let assistantText = '';
    try {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: updated,
          orgContext: { orgId: activeOrgId, orgName: activeOrgName },
        }),
      });
      if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // SSE frames are separated by a blank line. Hold partial frames
      // in `buf` across reads — a single chunk can split mid-event.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep = buf.indexOf('\n\n');
        while (sep !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let event = 'message';
          let dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) dataStr += line.slice(6);
          }
          if (dataStr) {
            let parsed: any;
            try { parsed = JSON.parse(dataStr); } catch { parsed = dataStr; }
            if (event === 'chunk' && parsed?.text) {
              assistantText += parsed.text;
              // Functional setState so concurrent chunks don't race —
              // each update reads the latest array.
              setMessages((prev) => {
                const next = [...prev];
                next[assistantIndex] = { role: 'assistant', content: assistantText };
                return next;
              });
            } else if (event === 'entities' && Array.isArray(parsed)) {
              setEntities(parsed);
            } else if (event === 'error') {
              throw new Error(parsed?.error || 'stream error');
            }
          }
          sep = buf.indexOf('\n\n');
        }
      }
    } catch {
      // On any stream failure, replace the empty assistant placeholder
      // with a friendly error so the user isn't left staring at a
      // half-rendered bubble.
      setMessages((prev) => {
        const next = [...prev];
        next[assistantIndex] = {
          role: 'assistant',
          content: assistantText || 'Sorry, something went wrong. Please try again.',
        };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    await send(input.trim());
  }

  // Starter prompts shown when the chat is empty. Mix of CLAUDE.md
  // examples and Phase 3 surfaces (orphan assets, system declarations)
  // so newcomers immediately see what the grounded assistant can do.
  const SUGGESTED_PROMPTS = [
    'Where are our data gaps?',
    'Which assets are below 80% health and linked to critical processes?',
    'Which data assets do we have that no process uses?',
    'Which systems run our customer-facing processes?',
  ];

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'fixed',
          bottom: bubbleBottom,
          right: 24,
          width: 48,
          height: 48,
          borderRadius: '50%',
          backgroundColor: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          fontSize: 22,
          cursor: 'pointer',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={(e) =>
          ((e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-primary-hover)')
        }
        onMouseLeave={(e) =>
          ((e.target as HTMLButtonElement).style.backgroundColor = 'var(--color-primary)')
        }
        title={open ? 'Close chat' : 'Open AI assistant'}
        aria-label={open ? 'Close chat' : 'Open AI assistant'}
        aria-expanded={open}
      >
        {open ? '\u2715' : '\u2753'}
      </button>

      {/* Chat window. On phones it expands edge-to-edge with margins,
          riding above the mobile nav strip; on desktop it's a 400×520
          floating card in the corner. */}
      {open && (
        <div
          style={{
            position: 'fixed',
            ...panelStyle,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            AI Assistant
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: 13,
                  textAlign: 'center',
                  marginTop: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div>Ask me anything about your processes, data assets, or governance.</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Try one of these:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 280 }}>
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => send(p)}
                      disabled={loading}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        fontSize: 12, lineHeight: 1.4,
                        background: 'var(--color-bg)',
                        color: 'var(--color-text)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: loading ? 'wait' : 'pointer',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  backgroundColor:
                    msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg)',
                  color: msg.role === 'user' ? '#fff' : 'var(--color-text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {msg.role === 'assistant'
                  ? renderAssistantText(msg.content, entities)
                  : msg.content}
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  fontSize: 13,
                }}
              >
                Thinking...
              </div>
            )}
          </div>

          {/* Input */}
          <div
            style={{
              display: 'flex',
              borderTop: '1px solid var(--color-border)',
              padding: 8,
              gap: 8,
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about a process, asset, gap, or owner…"
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                outline: 'none',
              }}
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              style={{
                padding: '8px 16px',
                backgroundColor: 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontSize: 13,
                fontWeight: 500,
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !input.trim() ? 0.6 : 1,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
