import { useEffect, useRef } from 'react';

// ──────────────────────────────────────────────────────────────────────────
// CaptchaPrompt — surfaced after enough failed logins from this IP.
// Two modes:
//   - When the backend reports an hCaptcha site key, dynamically load
//     the hCaptcha JS API and render the widget. Once the user solves
//     it, hCaptcha fires window.hcaptcha's callback with the token,
//     which we mirror into local state so the next login post carries
//     the verified value.
//   - When no site key is configured (dev / self-hosted with no
//     hCaptcha account), fall back to a "Confirm I'm human" checkbox
//     that fills a dummy token. The backend accepts any non-empty
//     token when no HCAPTCHA_SECRET is set, so this gets the user
//     through during local development.
// ──────────────────────────────────────────────────────────────────────────

interface CaptchaPromptProps {
  siteKey: string;
  token: string;
  onToken: (t: string) => void;
}

interface HCaptchaGlobal {
  render: (
    el: HTMLElement,
    opts: { sitekey: string; callback: (t: string) => void; 'expired-callback'?: () => void },
  ) => string;
}

export default function CaptchaPrompt({ siteKey, token, onToken }: CaptchaPromptProps) {
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    const existing = document.querySelector('script[data-procela-hcaptcha]') as HTMLScriptElement | null;
    let cleanup = () => { /* */ };
    const render = () => {
      const win = window as unknown as { hcaptcha?: HCaptchaGlobal };
      if (!win.hcaptcha || !widgetRef.current) return;
      const id = win.hcaptcha.render(widgetRef.current, {
        sitekey: siteKey,
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(''),
      });
      cleanup = () => {
        if (widgetRef.current) widgetRef.current.innerHTML = '';
        void id;
      };
    };
    if (existing) {
      render();
    } else {
      const s = document.createElement('script');
      s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.setAttribute('data-procela-hcaptcha', '');
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => { cleanup(); };
  }, [siteKey, onToken]);

  if (siteKey) {
    return (
      <div
        data-testid="captcha-prompt-hcaptcha"
        role="region"
        aria-label="hCaptcha challenge"
        style={{
          margin: '8px 0', padding: 12,
          background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 12, color: '#9a3412', marginBottom: 8 }}>
          Confirm you're human before we can process this sign-in:
        </div>
        <div ref={widgetRef} data-testid="hcaptcha-mount" />
      </div>
    );
  }

  return (
    <div
      data-testid="captcha-prompt-dev"
      role="region"
      aria-label="Human-verification challenge"
      style={{
        margin: '8px 0', padding: 12,
        background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 12, color: '#9a3412', marginBottom: 8 }}>
        Too many recent sign-in attempts from your network. Confirm you're human to continue.
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!token}
          onChange={(e) => onToken(e.target.checked ? `human-confirmed-${Date.now()}` : '')}
        />
        I'm not a robot
      </label>
    </div>
  );
}
