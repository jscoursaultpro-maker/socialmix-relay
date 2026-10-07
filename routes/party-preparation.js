import { Router, json } from 'express';
import { randomUUID } from 'node:crypto';
import Party from '../models/Party.js';
import User from '../models/User.js';
import Friendship from '../models/Friendship.js';
import { verifySupabaseJWT } from '../lib/supabaseAuth.js';
import { findOrCreateFromSupabase } from '../services/userService.js';

export function preparationSummary(p) {
  const participants = (p.participants || []).filter(x => !x.isHost);
  const registered = new Set(participants.map(x => String(x.userId)));
  return { code: p.code, partyName: p.partyName || 'Une soirée ensemble', scheduledFor: p.scheduledFor,
    welcomeText: p.welcomeText || '', coverPhoto: p.coverPhoto || null,
    hostProfile: p.hostProfile, participantCount: participants.length,
    pendingCount: (p.pendingGuests || []).length,
    invitedCount: (p.scheduledInvitations || []).filter(x => !registered.has(String(x.userId))).length };
}

// Dependencies are injectable so ownership and lifecycle can be tested without a live database.
export default function preparationRouter({ parties, io, buildLightState, PartyModel = Party,
  UserModel = User, FriendshipModel = Friendship, authenticate = async token =>
    findOrCreateFromSupabase(await verifySupabaseJWT(token)) }) {
  const router = Router();
  router.use(json({ limit: '5mb' }));
  async function identity(req) {
    const auth = req.headers.authorization || '';
    if (!auth) return null;
    if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Reconnecte-toi pour continuer.'), { status: 401 });
    try { return await authenticate(auth.slice(7)); }
    catch { throw Object.assign(new Error('Reconnecte-toi pour continuer.'), { status: 401 }); }
  }
  const route = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { res.status(e.status || 500).json({ error: e.message || 'Erreur serveur' }); }
  };
  async function owned(req) {
    const code = String(req.params.code || '').toUpperCase();
    const p = await PartyModel.findOne({ code, endedAt: null });
    if (!p) throw Object.assign(new Error('Cette soirée est introuvable.'), { status: 404 });
    const user = await identity(req);
    const secret = req.headers['x-host-secret'];
    if (!(user && String(p.hostUserId) === String(user._id)) && !(secret && secret === p.hostSecret)) {
      throw Object.assign(new Error('Seul l’organisateur peut préparer cette soirée.'), { status: 403 });
    }
    if (!p.isPreParty) throw Object.assign(new Error('Cette soirée a déjà commencé.'), { status: 409 });
    return p;
  }
  function sync(p) {
    const ram = parties.get(p.code);
    if (ram) Object.assign(ram, { partyName: p.partyName, scheduledFor: p.scheduledFor,
      welcomeText: p.welcomeText, coverPhoto: p.coverPhoto, scheduledInvitations: p.scheduledInvitations,
      preApprovedGuests: p.preApprovedGuests, pendingGuests: p.pendingGuests, participants: p.participants });
  }
  function validateDetails(data) {
    const date = new Date(data.scheduledFor);
    if (!Number.isFinite(date.getTime()) || date <= new Date()) throw Object.assign(new Error('Choisis une date à venir.'), { status: 400 });
    const cover = data.coverPhoto || null;
    if (cover && (!/^data:image\/(jpeg|png|webp);base64,/.test(cover) || cover.length > 700000)) {
      throw Object.assign(new Error('Choisis une photo plus légère (500 Ko maximum).'), { status: 400 });
    }
    return { scheduledFor: date, partyName: String(data.partyName || 'Une soirée ensemble').trim().slice(0, 60),
      welcomeText: String(data.welcomeText || '').slice(0, 500), coverPhoto: cover };
  }
  router.post('/schedule', route(async (req, res) => {
    const user = await identity(req);
    const { code, hostSecret } = req.body;
    if (!/^[A-Z0-9]{6,10}$/.test(code || '') || typeof hostSecret !== 'string' || hostSecret.length < 16) {
      return res.status(400).json({ error: 'Code ou clé organisateur invalide.' });
    }
    const details = validateDetails(req.body);
    const hostProfile = user ? { name: user.profile?.firstName || 'Organisateur',
      photo: user.profile?.photoURL || null, emoji: user.profile?.emoji || '🎉' } : req.body.profile;
    try {
      const p = await PartyModel.create({ code, hostSecret, ...details, hostProfile,
        hostUserId: user?._id || null, isPreParty: true, requiresApproval: true, visibility: 'private',
        lifecycle: { status: 'scheduled', startedAt: null, hostConnected: false } });
      res.status(201).json({ success: true, party: preparationSummary(p) });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'Ce code existe déjà. Prépare une nouvelle soirée.' });
      throw e;
    }
  }));
  router.post('/scheduled/list', route(async (req, res) => {
    const user = await identity(req);
    const secrets = Array.isArray(req.body.hostSecrets) ? req.body.hostSecrets.filter(x => typeof x === 'string' && x.length >= 16).slice(0, 32) : [];
    if (!user && !secrets.length) return res.status(401).json({ error: 'Connexion requise.' });
    const owners = [];
    if (user) owners.push({ hostUserId: user._id });
    if (secrets.length) owners.push({ hostSecret: { $in: secrets } });
    const list = await PartyModel.find({ $or: owners, isPreParty: true, endedAt: null, code: { $not: /_archived_/ }, 'lifecycle.status': { $nin: ['archived', 'ended', 'merged'] } }).sort({ scheduledFor: 1 }).limit(100).lean();
    const invitations = user ? await PartyModel.find({ 'scheduledInvitations.userId': user._id, hostUserId: { $ne: user._id }, isPreParty: true, endedAt: null, code: { $not: /_archived_/ }, 'lifecycle.status': { $nin: ['archived', 'ended', 'merged'] } }).sort({ scheduledFor: 1 }).limit(100).lean() : [];
    res.json({ parties: list.map(preparationSummary), invitations: invitations.map(p => ({ ...preparationSummary(p), pendingCount: undefined })) });
  }));
  router.get('/:code/preparation', route(async (req, res) => {
    const p = await owned(req);
    const registered = new Set((p.participants || []).map(x => String(x.userId)));
    res.json({ ...preparationSummary(p), hostSecret: p.hostSecret,
      participants: (p.participants || []).filter(x => !x.isHost).map(x => ({ userId: String(x.userId), name: x.name || x.firstName, photoURL: x.photo || null, emoji: x.emoji || '🎉' })),
      pending: (p.pendingGuests || []).map(x => ({ userId: String(x.userId), name: [x.firstName, x.lastName].filter(Boolean).join(' '), photoURL: x.photoURL || null })),
      invited: (p.scheduledInvitations || []).filter(x => !registered.has(String(x.userId))) });
  }));
  router.patch('/:code/preparation', route(async (req, res) => {
    const p = await owned(req);
    Object.assign(p, validateDetails(req.body));
    await p.save(); sync(p); res.json(preparationSummary(p));
  }));
  router.post('/:code/preparation/friends', route(async (req, res) => {
    const p = await owned(req);
    if (!p.hostUserId) return res.status(409).json({ error: 'Connecte ton compte pour inviter tes amis.' });
    const ids = [...new Set(Array.isArray(req.body.userIds) ? req.body.userIds : [])].filter(x => /^[a-f0-9]{24}$/i.test(x)).slice(0, 100);
    if (!ids.length) return res.status(400).json({ error: 'Sélectionne au moins un ami.' });
    const owner = String(p.hostUserId);
    const relations = await FriendshipModel.find({ status: 'accepted', $or: [{ userA: owner, userB: { $in: ids } }, { userB: owner, userA: { $in: ids } }] }).lean();
    const allowed = new Set(relations.map(x => x.userA === owner ? x.userB : x.userA));
    const hostUser = await UserModel.findById(p.hostUserId).select('friends.userId').lean();
    for (const friend of hostUser?.friends || []) allowed.add(String(friend.userId));
    if (ids.some(x => !allowed.has(x))) return res.status(403).json({ error: 'Tu peux ajouter uniquement tes amis confirmés.' });
    const users = await UserModel.find({ _id: { $in: ids } }).select('profile').lean();
    for (const user of users) {
      const id = String(user._id);
      if (!(p.scheduledInvitations || []).some(x => String(x.userId) === id)) p.scheduledInvitations.push({ userId: id,
        name: user.profile?.firstName || 'Ami', photoURL: user.profile?.photoURL || null, emoji: user.profile?.emoji || '🎉' });
      if (!p.preApprovedGuests.some(x => String(x) === id)) p.preApprovedGuests.push(id);
    }
    await p.save(); sync(p); res.json({ ok: true });
  }));
  router.post('/:code/preparation/requests/:userId', route(async (req, res) => {
    const p = await owned(req);
    if (!['accept', 'decline'].includes(req.body.action)) return res.status(400).json({ error: 'Décision invalide.' });
    const entry = p.pendingGuests.find(x => String(x.userId) === req.params.userId);
    if (!entry) return res.status(404).json({ error: 'Cette demande a déjà été traitée.' });
    p.pendingGuests = p.pendingGuests.filter(x => String(x.userId) !== req.params.userId);
    const token = randomUUID();
    if (req.body.action === 'accept' && !p.participants.some(x => String(x.userId) === req.params.userId)) {
      p.participants.push({ userId: String(entry.userId), id: entry.socketId, name: entry.firstName,
        photo: entry.photoURL || null, emoji: '🎉', joinedAt: new Date(), sessionToken: token, isHost: false });
      p.sessionTokens = { ...(p.sessionTokens?.toObject?.() || p.sessionTokens || {}), [token]: String(entry.userId) };
      if (!p.preApprovedGuests.some(x => String(x) === String(entry.userId))) p.preApprovedGuests.push(entry.userId);
    }
    await p.save(); sync(p);
    const guestSocket = io.sockets.sockets.get(entry.socketId);
    if (guestSocket) {
      if (req.body.action === 'accept') {
        guestSocket.leave(`pending:${p.code}`); guestSocket.join(`guest:${p.code}`);
        guestSocket.emit('guest:approved', { partyState: { code: p.code, partyName: p.partyName, isPreParty: true } });
        guestSocket.emit('session:token', { sessionToken: token, partyCode: p.code, userId: String(entry.userId) });
      } else guestSocket.emit('guest:denied', { reason: 'L’organisateur a décliné ta demande.' });
    }
    const ram = parties.get(p.code);
    if (ram && buildLightState) io.to(`host:${p.code}`).emit('party:state', buildLightState(ram, true));
    res.json({ ok: true });
  }));
  return router;
}
