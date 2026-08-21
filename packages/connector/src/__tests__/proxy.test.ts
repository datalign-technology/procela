import { describe, it } from 'node:test';
import assert from 'node:assert';

import { decideProxy, matchesNoProxy, redactProxyUrl, type ProxyEnv } from '../proxy';

const PROCELA = 'https://app.procela.ai';

describe('proxy — decideProxy', () => {
  it('goes direct when no proxy vars are set', () => {
    const d = decideProxy(PROCELA, {});
    assert.strictEqual(d.proxyUrl, null);
    assert.match(d.reason, /no proxy configured/);
  });

  it('routes through HTTPS_PROXY for an https target', () => {
    const d = decideProxy(PROCELA, { HTTPS_PROXY: 'http://proxy.corp:3128' });
    assert.strictEqual(d.proxyUrl, 'http://proxy.corp:3128');
    assert.match(d.reason, /routing via http:\/\/proxy\.corp:3128/);
  });

  it('accepts the lowercase https_proxy spelling', () => {
    const d = decideProxy(PROCELA, { https_proxy: 'http://proxy.corp:3128' });
    assert.strictEqual(d.proxyUrl, 'http://proxy.corp:3128');
  });

  it('prefers the uppercase var when both cases are set', () => {
    const d = decideProxy(PROCELA, {
      HTTPS_PROXY: 'http://upper.corp:3128',
      https_proxy: 'http://lower.corp:3128',
    });
    assert.strictEqual(d.proxyUrl, 'http://upper.corp:3128');
  });

  it('falls back to HTTP_PROXY for an https target when HTTPS_PROXY is unset', () => {
    const d = decideProxy(PROCELA, { HTTP_PROXY: 'http://proxy.corp:3128' });
    assert.strictEqual(d.proxyUrl, 'http://proxy.corp:3128');
  });

  it('ignores HTTPS_PROXY for an http target and uses HTTP_PROXY', () => {
    const env: ProxyEnv = { HTTPS_PROXY: 'http://secure.corp:3128', HTTP_PROXY: 'http://plain.corp:3128' };
    const d = decideProxy('http://app.procela.ai', env);
    assert.strictEqual(d.proxyUrl, 'http://plain.corp:3128');
  });

  it('goes direct when NO_PROXY names the Procela host', () => {
    const d = decideProxy(PROCELA, { HTTPS_PROXY: 'http://proxy.corp:3128', NO_PROXY: 'app.procela.ai' });
    assert.strictEqual(d.proxyUrl, null);
    assert.match(d.reason, /excluded by NO_PROXY/);
  });

  it('goes direct when NO_PROXY is a wildcard', () => {
    const d = decideProxy(PROCELA, { HTTPS_PROXY: 'http://proxy.corp:3128', NO_PROXY: '*' });
    assert.strictEqual(d.proxyUrl, null);
  });

  it('does not let evilprocela.ai match NO_PROXY=procela.ai', () => {
    const d = decideProxy('https://evilprocela.ai', { HTTPS_PROXY: 'http://proxy.corp:3128', NO_PROXY: 'procela.ai' });
    assert.strictEqual(d.proxyUrl, 'http://proxy.corp:3128', 'must still be proxied — not a real subdomain');
  });

  it('goes direct with an explanatory reason when the proxy URL is missing its scheme', () => {
    const d = decideProxy(PROCELA, { HTTPS_PROXY: 'proxy.corp:3128' });
    assert.strictEqual(d.proxyUrl, null);
    assert.match(d.reason, /missing an http:\/\/ or https:\/\/ scheme/);
  });

  it('goes direct when procelaUrl is unparseable', () => {
    const d = decideProxy('not a url', { HTTPS_PROXY: 'http://proxy.corp:3128' });
    assert.strictEqual(d.proxyUrl, null);
    assert.match(d.reason, /unparseable/);
  });
});

describe('proxy — matchesNoProxy', () => {
  it('returns false when NO_PROXY is empty/undefined', () => {
    assert.strictEqual(matchesNoProxy('app.procela.ai', undefined), false);
    assert.strictEqual(matchesNoProxy('app.procela.ai', ''), false);
  });

  it('matches a bare domain and its subdomains', () => {
    assert.strictEqual(matchesNoProxy('procela.ai', 'procela.ai'), true);
    assert.strictEqual(matchesNoProxy('app.procela.ai', 'procela.ai'), true);
  });

  it('matches a leading-dot entry', () => {
    assert.strictEqual(matchesNoProxy('app.procela.ai', '.procela.ai'), true);
  });

  it('ignores a port on the NO_PROXY entry', () => {
    assert.strictEqual(matchesNoProxy('app.procela.ai', 'app.procela.ai:443'), true);
  });

  it('honours a wildcard and comma-separated lists', () => {
    assert.strictEqual(matchesNoProxy('anything.example.com', '*'), true);
    assert.strictEqual(matchesNoProxy('app.procela.ai', 'foo.com, procela.ai , bar.net'), true);
  });

  it('does not match an unrelated host', () => {
    assert.strictEqual(matchesNoProxy('example.com', 'procela.ai'), false);
    assert.strictEqual(matchesNoProxy('evilprocela.ai', 'procela.ai'), false);
  });
});

describe('proxy — redactProxyUrl', () => {
  it('strips credentials from a proxy URL', () => {
    const out = redactProxyUrl('http://user:secret@proxy.corp:3128');
    assert.doesNotMatch(out, /secret/);
    assert.doesNotMatch(out, /user/);
    assert.match(out, /\/\/\*\*\*@proxy\.corp:3128/);
  });

  it('leaves a credential-free URL intact', () => {
    assert.strictEqual(redactProxyUrl('http://proxy.corp:3128/'), 'http://proxy.corp:3128/');
  });

  it('reports an unparseable URL rather than throwing', () => {
    assert.strictEqual(redactProxyUrl('::::'), '<unparseable proxy url>');
  });
});
