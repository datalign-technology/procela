// ──────────────────────────────────────────────────────────────────────────
// Streamable-HTTP transport for the MCP server (the hosted, multi-tenant
// surface — see docs/MCP_SERVER_DESIGN.md §5.2).
//
// A single endpoint (POST /mcp) speaks JSON-RPC 2.0 over HTTP:
//   • Authentication is per request via `Authorization: Bearer <token>` — the
//     same Procela access token the REST API and stdio transport verify. A
//     fresh Session (and MCP server) is built per request, so one hosted
//     endpoint serves every tenant with no shared server-side state.
//   • The body may be a single JSON-RPC message or a batch (array). Each is
//     dispatched through the transport-agnostic `McpServer.handle()`.
//   • Requests with an `id` get a JSON response; a body of only notifications
//     (no `id`) returns `202 Accepted` with no body, per the Streamable-HTTP
//     spec.
//   • GET returns 405 — v1 has no server-initiated SSE stream (all our tools
//     are request/response). DELETE (session teardown) is a 204 no-op since the
//     transport is stateless (no `Mcp-Session-Id`).
//
// The core (`dispatchHttp`) is pure — it takes the request's auth header,
// accept header and parsed body and returns `{ status, headers, json }` — so it
// unit-tests without a live socket. `mcpHttpRouter()` is the thin Express wrap.
// ──────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { createSession } from './identity';
import { buildMcpServerForSession } from './server';
import type { JsonRpcRequest, JsonRpcResponse } from './protocol';
import { RPC } from './protocol';
import logger from '../lib/logger';

/** Advertised MIME for a JSON-RPC response body. */
const JSON_RPC_CONTENT_TYPE = 'application/json';

export interface HttpDispatchInput {
  /** The raw `Authorization` header value, if any. */
  authorization?: string;
  /** The parsed JSON request body (single message, or a batch array). */
  body: unknown;
}

export interface HttpDispatchResult {
  status: number;
  headers: Record<string, string>;
  /** The JSON body to send, or `undefined` for an empty (202/204) response. */
  json?: unknown;
}

/** Pull a bearer token out of an Authorization header. Returns null when the
 *  header is missing or not a well-formed `Bearer <token>`. Parsed by slicing
 *  the scheme rather than a regex: the header is uncontrolled input, and a
 *  `\s`/`.`-overlapping pattern backtracks polynomially on adversarial
 *  whitespace (js/polynomial-redos). This scan is linear. */
export function bearerToken(authorization?: string): string | null {
  if (!authorization) return null;
  const trimmed = authorization.trim();
  // Scheme is case-insensitive and must be followed by at least one space.
  if (trimmed.length < 7 || trimmed.slice(0, 7).toLowerCase() !== 'bearer ') return null;
  const token = trimmed.slice(7).trim();
  return token ? token : null;
}

/** Best-effort principal id from a bearer token *without verifying it* — used
 *  only to key the rate limiter per caller. An unverified/garbage token falls
 *  through to null so the caller keys by IP instead; auth itself is still
 *  enforced (verified) in `dispatchHttp`. Never returns a secret. */
export function unverifiedPrincipal(authorization?: string): string | null {
  const token = bearerToken(authorization);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

/** A JSON-RPC error envelope for a top-level (transport) failure. */
function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Is this parsed value a plausible JSON-RPC request object (has a method)? */
function isRpcRequest(v: unknown): v is JsonRpcRequest {
  return typeof v === 'object' && v !== null && typeof (v as { method?: unknown }).method === 'string';
}

/**
 * Pure core: authenticate, build a per-request server, and dispatch the
 * JSON-RPC body. Never throws — every failure becomes a status + JSON body.
 */
export async function dispatchHttp(input: HttpDispatchInput): Promise<HttpDispatchResult> {
  const jsonHeaders = { 'Content-Type': JSON_RPC_CONTENT_TYPE };

  // ── Auth (per request) ──────────────────────────────────────────────────
  const token = bearerToken(input.authorization);
  if (!token) {
    return {
      status: 401,
      headers: { ...jsonHeaders, 'WWW-Authenticate': 'Bearer' },
      json: rpcError(null, RPC.INVALID_REQUEST, 'Missing or malformed Authorization: Bearer token.'),
    };
  }

  let server;
  try {
    server = buildMcpServerForSession(createSession(token));
  } catch {
    // Don't leak the verifier's reason (expired vs malformed vs bad payload) —
    // a 401 is all an unauthenticated caller is owed.
    return {
      status: 401,
      headers: { ...jsonHeaders, 'WWW-Authenticate': 'Bearer' },
      json: rpcError(null, RPC.INVALID_REQUEST, 'Invalid or expired token.'),
    };
  }

  // ── Body shape ──────────────────────────────────────────────────────────
  const body = input.body;
  const isBatch = Array.isArray(body);
  const messages = isBatch ? body : [body];

  if (messages.length === 0) {
    return { status: 400, headers: jsonHeaders, json: rpcError(null, RPC.INVALID_REQUEST, 'Empty JSON-RPC batch.') };
  }

  // ── Dispatch each message through the transport-agnostic core ────────────
  const responses: JsonRpcResponse[] = [];
  for (const msg of messages) {
    if (!isRpcRequest(msg)) {
      responses.push(rpcError(null, RPC.INVALID_REQUEST, 'Not a valid JSON-RPC 2.0 request.'));
      continue;
    }
    // handle() returns null for a notification (no id) — nothing to send back.
    const res = await server.handle(msg);
    if (res) responses.push(res);
  }

  // A body of only notifications yields no responses → 202 Accepted, no body.
  if (responses.length === 0) {
    return { status: 202, headers: {} };
  }

  // Preserve the request shape: a batch request gets an array back; a single
  // request gets a single object.
  return { status: 200, headers: jsonHeaders, json: isBatch ? responses : responses[0] };
}

/** Express router for the Streamable-HTTP MCP endpoint. Mount at `/mcp`. */
export function mcpHttpRouter(): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const result = await dispatchHttp({ authorization: req.header('authorization'), body: req.body });
      for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
      if (result.json === undefined) {
        res.status(result.status).end();
      } else {
        res.status(result.status).json(result.json);
      }
    } catch (err) {
      // Belt-and-braces: dispatchHttp is designed not to throw, but never drop
      // the connection if it somehow does.
      logger.error({ err }, 'MCP HTTP dispatch failed');
      res.status(500).json(rpcError(null, RPC.INTERNAL_ERROR, 'Internal error.'));
    }
  });

  // No server-initiated SSE stream in v1: every tool is request/response.
  router.get('/', (_req: Request, res: Response) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json(rpcError(null, RPC.INVALID_REQUEST, 'Method not allowed — this endpoint accepts JSON-RPC over POST only.'));
  });

  // Stateless transport (no Mcp-Session-Id), so a session teardown is a no-op.
  router.delete('/', (_req: Request, res: Response) => {
    res.status(204).end();
  });

  return router;
}
