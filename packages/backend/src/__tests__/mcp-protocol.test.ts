// MCP protocol core — transport-agnostic JSON-RPC dispatch for the read-only
// server (initialize / tools / resources / ping / notifications / errors).

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { McpServer, MCP_PROTOCOL_VERSION, RPC, textResult, jsonResult } from '../mcp/protocol';

function server() {
  const s = new McpServer({ name: 'procela-mcp', version: '1.0.0' });
  s.registerTool({
    name: 'echo',
    description: 'Echo the message back.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    annotations: { readOnlyHint: true },
    handler: (args) => textResult(String(args.message ?? '')),
  });
  s.registerTool({
    name: 'boom',
    description: 'Always throws.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => { throw new Error('kaboom'); },
  });
  s.registerResource({
    uri: 'procela://demo/summary',
    name: 'Demo summary',
    description: 'A tiny resource.',
    mimeType: 'application/json',
    read: () => JSON.stringify({ ok: true }),
  });
  return s;
}

describe('McpServer.handle', () => {
  it('initialize advertises protocol version, serverInfo, and capabilities', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.ok(res && res.result);
    const r = res!.result as any;
    assert.strictEqual(r.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.strictEqual(r.serverInfo.name, 'procela-mcp');
    assert.ok(r.capabilities.tools);
    assert.ok(r.capabilities.resources);
  });

  it('notifications get no response (null)', async () => {
    const res = await server().handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.strictEqual(res, null);
  });

  it('ping returns an empty result', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 2, method: 'ping' });
    assert.deepStrictEqual((res as any).result, {});
  });

  it('tools/list returns registered tools with schemas', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = (res as any).result.tools as any[];
    const names = tools.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ['boom', 'echo']);
    const echo = tools.find((t) => t.name === 'echo');
    assert.strictEqual(echo.inputSchema.required[0], 'message');
    // Annotations are emitted when present, omitted otherwise.
    assert.strictEqual(echo.annotations.readOnlyHint, true);
    assert.strictEqual(tools.find((t) => t.name === 'boom').annotations, undefined);
  });

  it('tools/call runs the handler and returns text content', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { message: 'hi' } } });
    const result = (res as any).result;
    assert.strictEqual(result.content[0].text, 'hi');
    assert.ok(!result.isError);
  });

  it('tools/call on an unknown tool is a method-not-found error', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } });
    assert.strictEqual((res as any).error.code, RPC.METHOD_NOT_FOUND);
  });

  it('a throwing tool becomes an error *result* (isError), not a transport error', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom' } });
    const result = (res as any).result;
    assert.strictEqual(result.isError, true);
    assert.match(result.content[0].text, /kaboom/);
    assert.strictEqual((res as any).error, undefined);
  });

  it('resources/list and resources/read work; unknown uri is invalid-params', async () => {
    const list = await server().handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
    assert.strictEqual((list as any).result.resources[0].uri, 'procela://demo/summary');
    const read = await server().handle({ jsonrpc: '2.0', id: 8, method: 'resources/read', params: { uri: 'procela://demo/summary' } });
    assert.match((read as any).result.contents[0].text, /"ok":true/);
    const missing = await server().handle({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'procela://nope' } });
    assert.strictEqual((missing as any).error.code, RPC.INVALID_PARAMS);
  });

  it('unknown method is method-not-found', async () => {
    const res = await server().handle({ jsonrpc: '2.0', id: 10, method: 'floop' });
    assert.strictEqual((res as any).error.code, RPC.METHOD_NOT_FOUND);
  });

  it('jsonResult pretty-prints a value', () => {
    assert.match(jsonResult({ a: 1 }).content[0].text, /"a": 1/);
  });
});
