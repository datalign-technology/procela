// Corporate proxy support.
//
// Node's built-in fetch (undici) does NOT read HTTPS_PROXY / HTTP_PROXY,
// unlike curl or axios. In enterprises that force all egress through an
// inspecting proxy, the connector therefore cannot reach Procela at all
// and the operator has no setting to change. This module reads the
// standard proxy env vars and installs an undici ProxyAgent so fetch
// honours them.
//
// Scope note: only fetch traffic (heartbeat / pair / report to Procela)
// is proxied. Source-database connections use pg / mysql2 / mssql /
// oracledb, which open their own TCP sockets and are unaffected — that
// is correct, since those targets are inside the customer's network.
//
// TLS interception: when a proxy re-signs traffic with the company's own
// CA, point NODE_EXTRA_CA_CERTS at their PEM bundle. Node reads that at
// startup; no code change is needed here.

import { ProxyAgent, setGlobalDispatcher } from 'undici';

export interface ProxyEnv {
  HTTPS_PROXY?: string;
  https_proxy?: string;
  HTTP_PROXY?: string;
  http_proxy?: string;
  NO_PROXY?: string;
  no_proxy?: string;
}

export interface ProxyDecision {
  /** Proxy URL to route through, or null to go direct. */
  proxyUrl: string | null;
  /** Human-readable reason, for the startup log line. */
  reason: string;
}

/** Strip credentials from a proxy URL so it is safe to log. */
export function redactProxyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
      return u.toString().replace('//', '//***@');
    }
    return u.toString();
  } catch {
    return '<unparseable proxy url>';
  }
}

/** Does `host` match one of the NO_PROXY patterns?
 *
 *  Follows the de-facto convention: comma-separated entries, a leading
 *  dot or bare domain matches that domain and its subdomains, and a
 *  single `*` bypasses everything. Ports in entries are ignored. */
export function matchesNoProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  const h = host.toLowerCase();
  for (const rawEntry of noProxy.split(',')) {
    const entry = rawEntry.trim().toLowerCase().replace(/:\d+$/, '');
    if (!entry) continue;
    if (entry === '*') return true;
    const bare = entry.startsWith('.') ? entry.slice(1) : entry;
    if (h === bare || h.endsWith('.' + bare)) return true;
  }
  return false;
}

/** Decide whether calls to `procelaUrl` should go through a proxy.
 *
 *  The connector only ever fetches one host, so this decision is made
 *  once at startup rather than per-request. Uppercase env vars win over
 *  lowercase; HTTPS_PROXY wins over HTTP_PROXY for https:// targets. */
export function decideProxy(procelaUrl: string, env: ProxyEnv): ProxyDecision {
  let target: URL;
  try {
    target = new URL(procelaUrl);
  } catch {
    return { proxyUrl: null, reason: 'procelaUrl unparseable — going direct' };
  }

  const isHttps = target.protocol === 'https:';
  const configured = isHttps
    ? env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy
    : env.HTTP_PROXY || env.http_proxy;

  if (!configured) {
    return { proxyUrl: null, reason: 'no proxy configured — going direct' };
  }

  if (matchesNoProxy(target.hostname, env.NO_PROXY || env.no_proxy)) {
    return { proxyUrl: null, reason: `${target.hostname} excluded by NO_PROXY — going direct` };
  }

  // Note: `new URL('proxy.corp:3128')` succeeds — the parser reads
  // `proxy.corp:` as a scheme — so a missing http:// slips through
  // unless the protocol is checked explicitly. That is a likely typo,
  // and silently going direct would look like the proxy was ignored.
  let parsedProxy: URL;
  try {
    parsedProxy = new URL(configured);
  } catch {
    return {
      proxyUrl: null,
      reason: 'proxy env var is not a valid URL (expected e.g. http://proxy.corp:3128) — going direct',
    };
  }
  if (parsedProxy.protocol !== 'http:' && parsedProxy.protocol !== 'https:') {
    return {
      proxyUrl: null,
      reason: `proxy env var "${configured}" is missing an http:// or https:// scheme — going direct`,
    };
  }

  return { proxyUrl: configured, reason: `routing via ${redactProxyUrl(configured)}` };
}

/** Install the proxy dispatcher if one is configured. Call once, before
 *  the first fetch. Returns the reason string so the caller can log it. */
export function configureProxy(procelaUrl: string, env: ProxyEnv = process.env): string {
  const { proxyUrl, reason } = decideProxy(procelaUrl, env);
  if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));
  return reason;
}
