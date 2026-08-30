// "Report a problem" — the in-app support flow (go-live checklist #19).
//
// A small form in the app shell: pick a category, describe the issue,
// send. The client auto-captures a bit of context (current route, app
// version, browser) so the reader has repro breadcrumbs without the user
// having to hunt for them. Submissions POST to /support, which records
// them to the audit trail and emails the support inbox when configured.

import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Modal from './Modal';
import Button from './Button';
import SecondaryButton from './SecondaryButton';
import SectionLabel from './SectionLabel';
import { apiClient } from '@/api/client';
import { useToastStore } from '@/stores/toastStore';

type Category = 'Bug' | 'Question' | 'Feedback';
const CATEGORIES: Category[] = ['Bug', 'Question', 'Feedback'];

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || '0.1.0';

interface SupportModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SupportModal({ open, onClose }: SupportModalProps) {
  const location = useLocation();
  const addToast = useToastStore((s) => s.addToast);
  const [category, setCategory] = useState<Category>('Bug');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const route = location.pathname + (location.search || '');

  function reset() {
    setCategory('Bug');
    setMessage('');
    setSubmitting(false);
  }

  function close() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post<{ success: boolean; data: { delivered: boolean } }>('/support', {
        message: trimmed,
        category,
        context: {
          route,
          appVersion: APP_VERSION,
          userAgent: navigator.userAgent,
        },
      });
      addToast(
        'success',
        res?.data?.delivered
          ? 'Thanks — your report was sent to the Procela team.'
          : 'Thanks — your report was recorded. An admin can review it in the Audit Log.',
      );
      reset();
      onClose();
    } catch {
      setSubmitting(false);
      addToast('error', "Couldn't send your report. Please try again in a moment.");
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 500,
    color: 'var(--color-text)', marginBottom: 6,
  };
  const controlStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 14,
    color: 'var(--color-text)', background: 'var(--color-bg)',
    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  };

  return (
    <Modal
      open={open}
      onClose={close}
      kicker="Support"
      title="Report a problem"
      subtitle="Tell us what happened. We include your current page and browser so we can reproduce it."
      size="sm"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <SecondaryButton onClick={close} disabled={submitting}>Cancel</SecondaryButton>
          <Button variant="primary" onClick={submit} disabled={!message.trim()} loading={submitting}>
            Send report
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label htmlFor="support-category" style={labelStyle}>Category</label>
          <select
            id="support-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            style={controlStyle}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="support-message" style={labelStyle}>What happened?</label>
          <textarea
            id="support-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe the problem, what you expected, and any steps to reproduce it."
            rows={6}
            maxLength={5000}
            style={{ ...controlStyle, resize: 'vertical', minHeight: 120, fontFamily: 'inherit' }}
            autoFocus
          />
        </div>

        <div>
          <SectionLabel>Included automatically</SectionLabel>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.6 }}>
            <div>Page: <code>{route}</code></div>
            <div>Version: {APP_VERSION}</div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Browser: {navigator.userAgent}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
