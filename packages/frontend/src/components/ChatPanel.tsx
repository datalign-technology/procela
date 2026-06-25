import { useState, useRef, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useOrgContext } from '../stores/orgContext';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  success: boolean;
  data: { reply: string };
}

export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
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
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      // Send the active org so the assistant answers from this
      // organization's real catalog, assets and gaps — the backend
      // builds the data snapshot from orgId.
      const res = await apiClient.post<ChatResponse>('/chat', {
        messages: updated,
        orgContext: { orgId: activeOrgId, orgName: activeOrgName },
      });
      setMessages([...updated, { role: 'assistant', content: res.data.reply }]);
    } catch {
      setMessages([
        ...updated,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
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
                {msg.content}
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
