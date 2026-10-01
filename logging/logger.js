/*
 * © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 * logging/logger.js — structured JSON logger for production.
 *
 * Emits one JSON object per line (JSONL) so logs are machine-parseable by
 * aggregators (Loki, ELK, CloudWatch, Datadog). Falls back to pretty,
 * human-readable colored output when LOG_FORMAT=pretty or a TTY is detected
 * and LOG_FORMAT is not explicitly "json".
 *
 * Levels: debug < info < warn < error. Set the floor with LOG_LEVEL.
 * Every line carries: ts, level, msg, service, plus any structured fields.
 */
'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };

const SERVICE = process.env.LOG_SERVICE || 'spn-coin';
const FLOOR = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
const PRETTY = (process.env.LOG_FORMAT || '').toLowerCase() === 'pretty'
  || (process.env.LOG_FORMAT !== 'json' && process.stdout && process.stdout.isTTY);

// Redact obviously sensitive keys so secrets never hit the log stream.
const REDACT = new Set(['password', 'privatekey', 'private_key', 'secret', 'token',
  'accesstoken', 'refreshtoken', 'authorization', 'mnemonic', 'seed', 'apikey', 'api_key']);

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) {
    if (REDACT.has(k.toLowerCase())) out[k] = '[REDACTED]';
    else if (obj[k] && typeof obj[k] === 'object') out[k] = redact(obj[k]);
    else out[k] = obj[k];
  }
  return out;
}

function emit(level, msg, fields) {
  if (LEVELS[level] < FLOOR) return;
  const rec = Object.assign({
    ts: new Date().toISOString(),
    level,
    msg: String(msg),
    service: SERVICE,
  }, fields ? redact(fields) : null);

  if (PRETTY) {
    const c = COLORS[level] || '';
    const extra = fields ? ' ' + JSON.stringify(redact(fields)) : '';
    const line = `${c}${rec.ts} ${level.toUpperCase().padEnd(5)}${COLORS.reset} ${rec.msg}${extra}`;
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  } else {
    const line = JSON.stringify(rec);
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  }
}

const logger = {
  debug: (msg, fields) => emit('debug', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),

  // Return a child logger that always includes the given base fields.
  child(base) {
    return {
      debug: (m, f) => emit('debug', m, Object.assign({}, base, f)),
      info: (m, f) => emit('info', m, Object.assign({}, base, f)),
      warn: (m, f) => emit('warn', m, Object.assign({}, base, f)),
      error: (m, f) => emit('error', m, Object.assign({}, base, f)),
      child: (more) => logger.child(Object.assign({}, base, more)),
    };
  },

  // Express middleware: logs one structured line per completed request.
  httpMiddleware() {
    return function (req, res, next) {
      const start = process.hrtime.bigint();
      res.on('finish', function () {
        const durMs = Number(process.hrtime.bigint() - start) / 1e6;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        emit(level, 'http_request', {
          method: req.method,
          path: (req.originalUrl || req.url || '').split('?')[0],
          status: res.statusCode,
          durationMs: Math.round(durMs * 10) / 10,
          ip: (req.headers && req.headers['x-forwarded-for']) || (req.socket && req.socket.remoteAddress) || undefined,
          reqId: req.id || (req.headers && req.headers['x-request-id']) || undefined,
        });
      });
      next();
    };
  },
};

module.exports = logger;
module.exports.default = logger;
