import { Server } from 'socket.io';
import crypto from 'node:crypto';
import { assertSiteAccess, parseCookies, publicUser } from './lib/auth.js';
import { getSurvey } from './lib/resources.js';

export function createRealtimeServer(httpServer, { db, config, auth }) {
  const io = new Server(httpServer, {
    cors: config.allowedOrigins.length
      ? { origin: config.allowedOrigins, credentials: true, methods: ['GET', 'POST'] }
      : undefined,
    maxHttpBufferSize: 1024 * 1024,
    serveClient: false,
  });
  const presence = new Map();

  io.use(async (socket, next) => {
    const handshakeToken = socket.handshake.auth?.token;
    let token;
    if (handshakeToken !== undefined) {
      token = typeof handshakeToken === 'string' && handshakeToken.length <= 4096 ? handshakeToken : null;
    } else {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      token = cookies[config.cookieName];
    }
    const user = await auth.resolveUserFromToken(token);
    if (!user) return next(new Error('Authentication required'));
    socket.data.user = user;
    socket.data.surveys = new Set();
    next();
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.user.id));
    socket.on('survey:join', async (input, acknowledge = () => {}) => {
      try {
        const surveyId = typeof input === 'string' ? input : input?.surveyId;
        if (typeof surveyId !== 'string' || surveyId.length > 80) throw new Error('A valid surveyId is required.');
        const survey = await getSurvey(db, surveyId);
        await assertSiteAccess(db, socket.data.user, survey.site_id);
        const room = surveyRoom(survey.id);
        socket.join(room);
        socket.data.surveys.add(survey.id);
        if (!presence.has(survey.id)) presence.set(survey.id, new Map());
        presence.get(survey.id).set(socket.id, {
          socketId: socket.id,
          user: publicUser(socket.data.user),
          joinedAt: new Date().toISOString(),
        });
        broadcastPresence(io, presence, survey.id);
        acknowledge({ ok: true, surveyId: survey.id, presence: [...presence.get(survey.id).values()] });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });

    socket.on('survey:leave', (input, acknowledge = () => {}) => {
      const surveyId = typeof input === 'string' ? input : input?.surveyId;
      leaveSurvey(io, presence, socket, surveyId);
      acknowledge({ ok: true, surveyId });
    });

    socket.on('survey:cursor', (input = {}) => {
      const { surveyId, x, y, page = 1 } = input;
      if (!socket.data.surveys.has(surveyId) || !Number.isFinite(x) || !Number.isFinite(y)) return;
      socket.to(surveyRoom(surveyId)).volatile.emit('survey:cursor', {
        surveyId,
        x: Math.max(-1000000, Math.min(1000000, x)),
        y: Math.max(-1000000, Math.min(1000000, y)),
        page: Number.isInteger(page) ? page : 1,
        user: publicUser(socket.data.user),
      });
    });

    socket.on('survey:selection', (input = {}) => {
      const { surveyId, elementId = null } = input;
      if (!socket.data.surveys.has(surveyId)) return;
      socket.to(surveyRoom(surveyId)).emit('survey:selection', {
        surveyId,
        elementId: typeof elementId === 'string' ? elementId.slice(0, 80) : null,
        user: publicUser(socket.data.user),
      });
    });

    socket.on('disconnect', () => {
      for (const surveyId of socket.data.surveys) leaveSurvey(io, presence, socket, surveyId);
    });
  });

  function emitSurveyUpdate(surveyId, type, actor, payload = {}) {
    const resourceType = type.split('.')[0];
    const user = publicUser(actor);
    const at = new Date().toISOString();
    io.to(surveyRoom(surveyId)).emit('survey:updated', {
      surveyId,
      type: ['note', 'photo'].includes(resourceType) ? resourceType : type,
      action: type,
      actor: user,
      user,
      userId: user?.id,
      elementId: payload.elementId || payload.element?.id || null,
      payload,
      updatedAt: at,
      at,
    });
  }

  function emitSiteUpdate(siteId, type, actor, payload = {}) {
    io.to(siteRoom(siteId)).emit('site:updated', {
      siteId,
      type,
      actor: publicUser(actor),
      payload,
      at: new Date().toISOString(),
    });
  }

  function disconnectUser(userId) {
    if (typeof userId !== 'string') return;
    io.in(userRoom(userId)).disconnectSockets(true);
  }

  function notifyUser(userId, notification) {
    if (typeof userId !== 'string') return;
    io.to(userRoom(userId)).emit('user:notification', {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      ...notification,
    });
  }

  // Site rooms are useful for folder/survey lists. Authorization is checked before joining.
  io.on('connection', (socket) => {
    socket.on('site:join', async (input, acknowledge = () => {}) => {
      try {
        const siteId = typeof input === 'string' ? input : input?.siteId;
        if (typeof siteId !== 'string' || siteId.length > 80) throw new Error('A valid siteId is required.');
        await assertSiteAccess(db, socket.data.user, siteId);
        socket.join(siteRoom(siteId));
        acknowledge({ ok: true, siteId });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });
    socket.on('site:leave', (input) => {
      const siteId = typeof input === 'string' ? input : input?.siteId;
      if (typeof siteId === 'string') socket.leave(siteRoom(siteId));
    });
  });

  return { io, emitSurveyUpdate, emitSiteUpdate, disconnectUser, notifyUser };
}

function leaveSurvey(io, presence, socket, surveyId) {
  if (typeof surveyId !== 'string') return;
  socket.leave(surveyRoom(surveyId));
  socket.data.surveys.delete(surveyId);
  const entries = presence.get(surveyId);
  if (entries) {
    entries.delete(socket.id);
    if (!entries.size) presence.delete(surveyId);
  }
  broadcastPresence(io, presence, surveyId);
}

function broadcastPresence(io, presence, surveyId) {
  const collaborators = [...(presence.get(surveyId)?.values() || [])];
  const users = collaborators.map((entry) => entry.user);
  io.to(surveyRoom(surveyId)).emit('survey:presence', {
    surveyId,
    collaborators,
    users,
    members: users,
    at: new Date().toISOString(),
  });
}

function surveyRoom(surveyId) {
  return `survey:${surveyId}`;
}

function siteRoom(siteId) {
  return `site:${siteId}`;
}

function userRoom(userId) {
  return `user:${userId}`;
}
