import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CaptchaPrompt from './CaptchaPrompt';

describe('CaptchaPrompt — dev mode (no site key)', () => {
  it('renders the "I\'m not a robot" checkbox fallback', () => {
    render(<CaptchaPrompt siteKey="" token="" onToken={() => {}} />);
    expect(screen.getByTestId('captcha-prompt-dev')).toBeInTheDocument();
    expect(screen.getByLabelText(/i'?m not a robot/i)).toBeInTheDocument();
    expect(screen.queryByTestId('captcha-prompt-hcaptcha')).not.toBeInTheDocument();
  });

  it('emits a dummy token when the box is ticked', () => {
    const onToken = vi.fn();
    render(<CaptchaPrompt siteKey="" token="" onToken={onToken} />);
    fireEvent.click(screen.getByLabelText(/i'?m not a robot/i));
    expect(onToken).toHaveBeenCalledOnce();
    expect(onToken).toHaveBeenCalledWith(expect.stringMatching(/^human-confirmed-\d+$/));
  });

  it('clears the token (passes "") when the box is unticked', () => {
    const onToken = vi.fn();
    render(<CaptchaPrompt siteKey="" token="human-confirmed-12345" onToken={onToken} />);
    // Box should be checked initially because token is truthy.
    const box = screen.getByLabelText(/i'?m not a robot/i) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onToken).toHaveBeenCalledWith('');
  });

  it('reflects an externally-supplied token in the checked state', () => {
    const { rerender } = render(<CaptchaPrompt siteKey="" token="" onToken={() => {}} />);
    let box = screen.getByLabelText(/i'?m not a robot/i) as HTMLInputElement;
    expect(box.checked).toBe(false);
    rerender(<CaptchaPrompt siteKey="" token="some-token" onToken={() => {}} />);
    box = screen.getByLabelText(/i'?m not a robot/i) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('has an accessible region label', () => {
    render(<CaptchaPrompt siteKey="" token="" onToken={() => {}} />);
    expect(screen.getByRole('region', { name: /human-verification/i })).toBeInTheDocument();
  });
});

describe('CaptchaPrompt — hCaptcha mode (with site key)', () => {
  // Spy on the script-tag injection. The hCaptcha API itself is mocked
  // so the widget renders synchronously and we can verify the callback
  // wiring without actually loading their CDN.
  // The `appendChild` overload is generic over Node, which fights
  // with vi.spyOn's typed inference. Drop to a permissive type — the
  // tests only need `.mock.calls`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let appendSpy: any;

  beforeEach(() => {
    // Remove any leftover hCaptcha script from a previous test so each
    // case starts from a clean slate.
    document.querySelectorAll('script[data-procela-hcaptcha]').forEach((s) => s.remove());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).hcaptcha;
    appendSpy = vi.spyOn(document.head, 'appendChild');
  });

  afterEach(() => {
    appendSpy.mockRestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).hcaptcha;
  });

  it('renders the hCaptcha host element instead of the checkbox fallback', () => {
    render(<CaptchaPrompt siteKey="site-key-xyz" token="" onToken={() => {}} />);
    expect(screen.getByTestId('captcha-prompt-hcaptcha')).toBeInTheDocument();
    expect(screen.queryByTestId('captcha-prompt-dev')).not.toBeInTheDocument();
    expect(screen.getByTestId('hcaptcha-mount')).toBeInTheDocument();
  });

  it('injects the hCaptcha script tag exactly once', () => {
    render(<CaptchaPrompt siteKey="site-key-xyz" token="" onToken={() => {}} />);
    const scripts = appendSpy.mock.calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any[]) => c[0] as HTMLElement)
      .filter((el: HTMLElement) => el instanceof HTMLScriptElement && el.hasAttribute('data-procela-hcaptcha'));
    expect(scripts.length).toBe(1);
    const tag = scripts[0] as HTMLScriptElement;
    expect(tag.src).toContain('hcaptcha.com');
    expect(tag.src).toContain('render=explicit');
  });

  it('renders the widget and wires the callback when window.hcaptcha is already present', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderSpy: any = vi.fn(() => 'widget-id-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).hcaptcha = { render: renderSpy };
    // Pre-create the script tag so the component takes the "already
    // loaded" branch and renders synchronously.
    const existing = document.createElement('script');
    existing.setAttribute('data-procela-hcaptcha', '');
    document.head.appendChild(existing);

    const onToken = vi.fn();
    render(<CaptchaPrompt siteKey="site-key-xyz" token="" onToken={onToken} />);

    expect(renderSpy).toHaveBeenCalledOnce();
    const opts = renderSpy.mock.calls[0][1] as { sitekey: string; callback: (t: string) => void };
    expect(opts.sitekey).toBe('site-key-xyz');

    // Simulate the user solving the captcha — hCaptcha fires the callback.
    opts.callback('verified-token-from-hcaptcha');
    expect(onToken).toHaveBeenCalledWith('verified-token-from-hcaptcha');
  });

  it('clears the token via the expired-callback', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const renderSpy: any = vi.fn(() => 'widget-id-2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).hcaptcha = { render: renderSpy };
    const existing = document.createElement('script');
    existing.setAttribute('data-procela-hcaptcha', '');
    document.head.appendChild(existing);

    const onToken = vi.fn();
    render(<CaptchaPrompt siteKey="site-key-xyz" token="" onToken={onToken} />);
    const opts = renderSpy.mock.calls[0][1] as { 'expired-callback'?: () => void };
    opts['expired-callback']?.();
    expect(onToken).toHaveBeenCalledWith('');
  });
});
