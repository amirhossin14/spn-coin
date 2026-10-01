/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * docs-api/openapi.js — OpenAPI 3.0 specification for the SPN Coin HTTP API.
 *
 * Exposed at GET /api/openapi.json and rendered interactively at /docs
 * (Swagger UI). Covers the public read endpoints and the main write flows;
 * admin routes are marked with the bearerAuth security scheme.
 */
'use strict';

function buildSpec(meta) {
  meta = meta || {};
  const ok = (desc, example) => ({
    description: desc,
    content: { 'application/json': example ? { example } : {} },
  });

  return {
    openapi: '3.0.3',
    info: {
      title: 'SPN Coin API',
      version: meta.version || '1.0.0',
      description:
        'HTTP API for the SPN Coin educational blockchain — blocks, transactions, '
        + 'wallets, tokens, mining and network security. SPN Coin is an educational '
        + 'project with no monetary value.',
      license: { name: 'Proprietary — © 2026 SPN Coin Project' },
    },
    servers: [{ url: meta.baseUrl || '/', description: 'This node' }],
    tags: [
      { name: 'Chain', description: 'Blocks, transactions, and chain state' },
      { name: 'Wallet', description: 'Addresses and balances' },
      { name: 'Tokens', description: 'Token issuance, transfers and management' },
      { name: 'Mining', description: 'Mining and mempool' },
      { name: 'Network', description: 'Peers and P2P' },
      { name: 'Security', description: 'Threat detection and anomalies' },
      { name: 'System', description: 'Health, stats and metrics' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' } } },
        Health: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            height: { type: 'integer', example: 1234 },
            peers: { type: 'integer', example: 3 },
          },
        },
        Block: {
          type: 'object',
          properties: {
            height: { type: 'integer' },
            hash: { type: 'string' },
            previousHash: { type: 'string' },
            timestamp: { type: 'integer' },
            nonce: { type: 'integer' },
            transactions: { type: 'array', items: { type: 'object' } },
          },
        },
        Token: {
          type: 'object',
          properties: {
            tokenId: { type: 'string' },
            name: { type: 'string' },
            symbol: { type: 'string' },
            decimals: { type: 'integer' },
            supply: { type: 'string' },
            holders: { type: 'integer' },
            mintable: { type: 'boolean' },
            issuer: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          tags: ['System'], summary: 'Liveness / health check',
          responses: { 200: { description: 'Node is healthy', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } } },
        },
      },
      '/api/stats': {
        get: { tags: ['System'], summary: 'Chain statistics', responses: { 200: ok('Aggregate chain stats') } },
      },
      '/api/coin-info': {
        get: { tags: ['System'], summary: 'Coin parameters (symbol, supply cap, reward)', responses: { 200: ok('Static coin parameters') } },
      },
      '/api/blocks': {
        get: {
          tags: ['Chain'], summary: 'List recent blocks',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
          responses: { 200: ok('Array of recent blocks') },
        },
      },
      '/api/block/{ref}': {
        get: {
          tags: ['Chain'], summary: 'Get a block by height or hash',
          parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Block height or hash' }],
          responses: { 200: { description: 'Block', content: { 'application/json': { schema: { $ref: '#/components/schemas/Block' } } } }, 404: ok('Not found') },
        },
      },
      '/api/broadcast': {
        post: {
          tags: ['Chain'], summary: 'Broadcast a signed transaction',
          requestBody: { required: true, content: { 'application/json': { example: { tx: { /* signed tx */ } } } } },
          responses: { 200: ok('Accepted into mempool'), 400: ok('Invalid transaction') },
        },
      },
      '/api/search/{q}': {
        get: {
          tags: ['Chain'], summary: 'Search block, tx, address, or token',
          parameters: [{ name: 'q', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Typed match { type, data }'), 404: ok('Nothing found') },
        },
      },
      '/api/address/{addr}': {
        get: {
          tags: ['Wallet'], summary: 'Address balance and history',
          parameters: [{ name: 'addr', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Address info'), 404: ok('Not found') },
        },
      },
      '/api/address/{addr}/tokens': {
        get: {
          tags: ['Wallet'], summary: 'Token balances for an address',
          parameters: [{ name: 'addr', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: ok('Token balances') },
        },
      },
      '/api/tokens': {
        get: { tags: ['Tokens'], summary: 'List all tokens', responses: { 200: { description: 'Tokens', content: { 'application/json': { schema: { type: 'object', properties: { tokens: { type: 'array', items: { $ref: '#/components/schemas/Token' } } } } } } } } },
      },
      '/api/tokens/{id}': {
        get: {
          tags: ['Tokens'], summary: 'Token details',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Token', content: { 'application/json': { schema: { $ref: '#/components/schemas/Token' } } } }, 404: ok('Not found') },
        },
      },
      '/api/tokens/{id}/holders': {
        get: { tags: ['Tokens'], summary: 'Token holders (ranked)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Ranked holders') } },
      },
      '/api/tokens/{id}/distribution': {
        get: { tags: ['Tokens'], summary: 'Holder distribution buckets', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Distribution') } },
      },
      '/api/tokens/create': {
        post: {
          tags: ['Tokens'], summary: 'Create a new coin or token',
          requestBody: { required: true, content: { 'application/json': { example: { name: 'Gold', symbol: 'GLD', decimals: 2, supply: '1000000', kind: 'token', mintable: true } } } },
          responses: { 200: ok('Created'), 400: ok('Validation error') },
        },
      },
      '/api/tokens/submit-signed': {
        post: {
          tags: ['Tokens'], summary: 'Submit a client-signed token operation (transfer/mint/burn/freeze/meta)',
          requestBody: { required: true, content: { 'application/json': { example: { tx: { data: { tokenOps: [{ type: 'burn' }] } } } } } },
          responses: { 200: ok('Accepted'), 400: ok('Invalid signature or op') },
        },
      },
      '/api/mine': {
        post: { tags: ['Mining'], summary: 'Mine a block (single-node dev mode)', responses: { 200: ok('Mined block'), 401: ok('Auth required') } },
      },
      '/api/mempool': {
        get: { tags: ['Mining'], summary: 'Current mempool transactions', responses: { 200: ok('Pending transactions') } },
      },
      '/api/peers': {
        get: { tags: ['Network'], summary: 'Connected peers', responses: { 200: ok('Peer list') } },
      },
      '/api/security/anomalies': {
        get: { tags: ['Security'], summary: 'Flagged transaction anomalies', security: [{ bearerAuth: [] }], responses: { 200: ok('Anomaly feed'), 401: ok('Auth required') } },
      },
      '/api/analytics': {
        get: { tags: ['System'], summary: 'Chain analytics time-series', responses: { 200: ok('Analytics data') } },
      },
      '/metrics': {
        get: { tags: ['System'], summary: 'Prometheus metrics', responses: { 200: { description: 'Prometheus exposition format', content: { 'text/plain': {} } } } },
      },
    },
  };
}

module.exports = { buildSpec };
