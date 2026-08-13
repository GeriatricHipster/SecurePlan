import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createConfig } from './config.js';
import { createDatabase, logSecurityEvent } from './db.js';
import { ApiError } from './lib/errors.js';
import { checkStorage, cleanTemporaryUpload } from './lib/storage.js';
import { createAuthMiddleware } from './lib/auth.js';
import { createRealtimeServer } from './realtime.js';
import { createAuthRouter } from './routes/auth.js';
import { createSitesRouter } from './routes/sites.js';
import { createFoldersRouter } from './routes/folders.js';
import { createSurveysRouter } from './routes/surveys.js';
import { createElementsRouter } from './routes/elements.js';
import { createProfilesRouter } from './routes/profiles.js';
import { createTeamRouter } from './routes/team.js';
import { createSearchRouter } from './routes/search.js';
import { createActivityRouter } from './routes/activity.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { createSecurityRouter } from './routes/security.js';
import { createReportsRouter } from './routes/reports.js';

export function createApplication(overrides = {}) {
  const config = createConfig(overrides);
  const db = overrides.db || createDatabase(config);
  const app = express();
  const httpServer = http.createServer(app);
  const auth = createAuthMiddleware(db, config);
  const realtime = createRealtimeServer(httpServer, { db, config, auth });

  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const requestOrigin = req.headers.origin;
    const isAllowedMobileOrigin = requestOrigin && config.mobileOrigins.includes(requestOrigin);
    res.set({
      'X-Request-Id': req.requestId,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Cross-Origin-Resource-Policy': isAllowedMobileOrigin ? 'cross-origin' : 'same-origin',
      'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; manifest-src 'self'",
    });
    if (req.secure) {
      res.set('Strict-Transport-Security', 'max-age=31536000');
    }
    if (config.allowedOrigins.length && requestOrigin) res.vary('Origin');
    if (config.allowedOrigins.length && requestOrigin && !config.allowedOrigins.includes(requestOrigin)) {
      return res.status(403).json({
        error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' },
        requestId: req.requestId,
      });
    }
    if (requestOrigin && config.allowedOrigins.includes(requestOrigin)) {
      res.set({
        'Access-Control-Allow-Origin': requestOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Disposition, Content-Length, Content-Range, ETag, X-Request-Id',
      });
    }
    if (req.method === 'OPTIONS') {
      if (config.allowedOrigins.length && requestOrigin && !config.allowedOrigins.includes(requestOrigin)) {
        return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed.' } });
      }
      res.set({
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Request-Id, X-SecurePlan-Client',
        'Access-Control-Max-Age': '600',
      });
      return res.status(204).end();
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler(req, res) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many unsuccessful sign-in or registration attempts. Try again in 15 minutes.',
        },
        requestId: req.requestId,
      });
    },
  });
  app.use(['/api/auth/setup', '/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password'], authLimiter);

  app.get('/api/health/live', (_req, res) => {
    res.json({ data: { status: 'ok', time: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()) } });
  });
  const readinessHandler = async (_req, res) => {
    let databaseStatus = 'unavailable';
    let storageStatus = 'unavailable';
    let freeBytes = null;
    try {
      const database = await db.prepare('SELECT 1 AS healthy').get();
      if (database.healthy !== 1) throw new Error('Database check failed.');
      databaseStatus = 'ok';
    } catch {
      // The combined readiness response below deliberately avoids exposing internals.
    }
    try {
      if (config.cloudMode) {
        await checkStorage(config);
      } else {
        fs.accessSync(config.dataDir, fs.constants.R_OK | fs.constants.W_OK);
        fs.accessSync(config.uploadsDir, fs.constants.R_OK | fs.constants.W_OK);
        const stats = fs.statfsSync(config.dataDir);
        freeBytes = Number(stats.bavail) * Number(stats.bsize);
        if (freeBytes < config.minFreeStorageBytes) throw new Error('Persistent storage is critically low.');
      }
      storageStatus = 'ok';
    } catch {
      // The combined readiness response below deliberately avoids exposing internals.
    }

    const status = databaseStatus === 'ok' && storageStatus === 'ok' ? 'ok' : 'degraded';
    const data = {
      status,
      database: databaseStatus,
      storage: { status: storageStatus, freeBytes },
      time: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      revision: process.env.RENDER_GIT_COMMIT?.slice(0, 12) || null,
    };
    if (status === 'ok') {
      res.json({
        data,
      });
    } else {
      res.status(503).json({
        data,
        error: { code: 'NOT_READY', message: 'Database or persistent storage is unavailable.' },
      });
    }
  };
  app.get('/api/health', readinessHandler);
  app.get('/api/health/ready', readinessHandler);

  const routerContext = {
    db,
    config,
    auth,
    emitSurveyUpdate: realtime.emitSurveyUpdate,
    emitSiteUpdate: realtime.emitSiteUpdate,
    disconnectUser: realtime.disconnectUser,
    notifyUser: realtime.notifyUser,
  };
  app.use('/api', createAuthRouter(routerContext));
  app.use('/api', createSitesRouter(routerContext));
  app.use('/api', createFoldersRouter(routerContext));
  app.use('/api', createSurveysRouter(routerContext));
  app.use('/api', createElementsRouter(routerContext));
  app.use('/api', createProfilesRouter(routerContext));
  app.use('/api', createTeamRouter(routerContext));
  app.use('/api', createSearchRouter(routerContext));
  app.use('/api', createActivityRouter(routerContext));
  app.use('/api', createDashboardRouter(routerContext));
  app.use('/api', createSecurityRouter(routerContext));
  app.use('/api', createReportsRouter(routerContext));

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'ROUTE_NOT_FOUND', message: `No API route matches ${req.method} ${req.originalUrl}.` },
      requestId: req.requestId,
    });
  });

  if (fs.existsSync(path.join(config.staticDir, 'index.html'))) {
    app.use(
      express.static(config.staticDir, {
        index: false,
        etag: true,
        setHeaders(res, filePath) {
          const relative = path.relative(config.staticDir, filePath).split(path.sep).join('/');
          if (relative.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.staticDir, 'index.html'));
    });
  }

  app.use((error, req, res, _next) => {
    try {
      cleanTemporaryUpload(req.file);
    } catch {
      // Preserve the original error response if temporary cleanup also fails.
    }
    if (res.headersSent) return;

    let apiError = error;
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'The uploaded file is too large.' : error.message;
      apiError = new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'UPLOAD_ERROR', message);
    } else if (error?.code?.startsWith('SQLITE_CONSTRAINT') || ['23503', '23505', '23514'].includes(error?.code)) {
      apiError = new ApiError(409, 'CONFLICT', 'That operation conflicts with an existing record.');
    }

    const status = apiError instanceof ApiError ? apiError.status : 500;
    const response = {
      error: {
        code: apiError instanceof ApiError ? apiError.code : 'INTERNAL_ERROR',
        message:
          apiError instanceof ApiError
            ? apiError.message
            : process.env.NODE_ENV === 'production'
              ? 'An unexpected server error occurred.'
              : apiError?.message || 'An unexpected server error occurred.',
      },
      requestId: req.requestId,
    };
    if (apiError instanceof ApiError && apiError.details !== undefined) response.error.details = apiError.details;
    if (status >= 500) console.error(`[${req.requestId}]`, error);
    if (status === 401 || status === 403) {
      logSecurityEvent(db, {
        eventType: status === 401 ? 'auth.unauthorized' : 'permission.denied',
        severity: 'warning',
        userId: req.user?.id || null,
        req,
        details: { path: req.originalUrl, method: req.method, requestId: req.requestId },
      }).catch(() => {});
    }
    res.status(status).json(response);
  });

  return {
    app,
    httpServer,
    io: realtime.io,
    db,
    config,
    close: async () => {
      await new Promise((resolve) => realtime.io.close(resolve));
      if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
      await db.close();
    },
  };
}

export default createApplication;
