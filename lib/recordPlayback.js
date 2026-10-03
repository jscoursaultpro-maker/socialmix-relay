/**
 * lib/recordPlayback.js — Écriture d'un titre joué dans HostPlaybackHistory.
 *
 * Factorisé depuis server.js (audit 03/10/2026). Le bloc vivait en ligne dans le seul
 * handler `host:trackUpdate` ; `host:liveTrackDetected` (Shazam DJ Live) alimentait
 * `party.trackHistory` sans jamais créer de HPH. Les deux chemins appellent désormais
 * cette fonction, et tout nouveau chemin de lecture n'aura qu'à faire de même.
 *
 * Contrat : ne jette jamais. Toute sortie incrémente un compteur et produit un log
 * structuré `[HPH][...]`, pour qu'aucun write ne puisse plus échouer en silence.
 */

import mongoose from 'mongoose';
import HostPlaybackHistory from '../models/HostPlaybackHistory.js';
import Party from '../models/Party.js';
import Track from '../models/Track.js';
import { normalizeProvider } from './providers.js';
import { resolveHostUserId as resolveHostCascade } from './resolveHost.js';

const escapeRegex = s => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Résout le hostUserId : objet RAM d'abord, puis document Party en base.
 *
 * Correctif audit 03/10 : `party.hostUserId` n'est posé au démarrage que si
 * `party.hostProfile.email` existe et correspond à un User (server.js L5252). Une
 * soirée host web ouverte sans email laissait le champ nul en RAM et perdait la
 * totalité de son historique sur `skip reason=no_hostUserId`. On retombe donc sur la
 * base, où le champ est souvent renseigné, au lieu d'abandonner.
 */
async function resolveHostUserId(party) {
  if (party.hostUserId) return party.hostUserId;
  try {
    // L'état RAM peut être incomplet : on rejoue la cascade sur le document en base,
    // qui porte participants[isHost].userId, hostProfile.email et hostSecret.
    const doc = await Party.findOne({ code: party.code })
      .select('hostUserId participants hostProfile hostSecret').lean();
    if (!doc) return null;
    const { userId, via } = await resolveHostCascade(doc);
    if (userId) {
      party.hostUserId = userId; // mémorisé pour les titres suivants
      console.warn(`[HPH][recover] party=${party.code} hostUserId résolu via ${via}`);
      return userId;
    }
  } catch (e) {
    console.error(`[HPH][alert] party=${party.code} resolveHostUserId failed: ${e.message}`);
  }
  return null;
}

/**
 * Résout l'_id MongoDB de la soirée.
 *
 * Correctif audit 03/10 : le lookup d'origine filtrait sur `endedAt: null` et mettait
 * son résultat en cache sans jamais réessayer — un seul échec condamnait toute la
 * soirée. Le filtre est retiré (une soirée rouverte reste la même soirée) et le cache
 * n'est posé qu'en cas de succès.
 */
async function resolvePartyId(party) {
  if (party._mongoId && !(party._mongoId instanceof Promise)) return party._mongoId;
  try {
    const doc = await Party.findOne({ code: party.code }).select('_id').lean();
    if (doc?._id) { party._mongoId = doc._id; return doc._id; }
  } catch (e) {
    console.error(`[HPH][alert] party=${party.code} resolvePartyId failed: ${e.message}`);
  }
  return null;
}

/** Retrouve le Track du catalogue : identifiant provider d'abord, titre/artiste ensuite. */
async function resolveTrack(doc) {
  const deezerId = doc.deezerId || doc.deezerID || doc.trackId;
  if (deezerId && !Number.isNaN(Number(deezerId))) {
    const byId = await Track.findOne({ 'providers.deezer.trackId': Number(deezerId) }).select('_id').lean().catch(() => null);
    if (byId) return byId;
  }
  if (doc.title) {
    const q = { title: new RegExp('^' + escapeRegex(doc.title.trim()) + '$', 'i') };
    const artist = (doc.artist || '').split(/[,&]/)[0].trim();
    if (artist) q.artist = new RegExp(escapeRegex(artist), 'i');
    return await Track.findOne(q).select('_id').lean().catch(() => null);
  }
  return null;
}

/**
 * Enregistre un titre joué. Non bloquant : à appeler sans await depuis un handler socket.
 *
 * @param {object} party    état RAM de la soirée
 * @param {object} trackDoc entrée telle que poussée dans party.trackHistory
 * @param {object} [opts]   { phase, source }
 * @returns {Promise<'success'|'skipped'|'failed'>}
 */
export async function recordPlayback(party, trackDoc, opts = {}) {
  if (!party.hphCounters) party.hphCounters = { success: 0, failed: 0, skipped: 0 };
  const code = party.code;
  const title = trackDoc?.title || '(sans titre)';
  const source = opts.source || trackDoc?.source || 'unknown';

  const hostUserId = await resolveHostUserId(party);
  if (!hostUserId) {
    party.hphCounters.skipped++;
    console.warn(`[HPH][alert] party=${code} skip reason=no_hostUserId source=${source} title="${title}" counters=${JSON.stringify(party.hphCounters)}`);
    return 'skipped';
  }

  const partyId = await resolvePartyId(party);
  if (!partyId) {
    party.hphCounters.skipped++;
    console.warn(`[HPH][alert] party=${code} skip reason=no_partyId source=${source} title="${title}" counters=${JSON.stringify(party.hphCounters)}`);
    return 'skipped';
  }

  const resolved = await resolveTrack(trackDoc);
  if (!resolved) {
    console.warn(`[HPH][catalogue-miss] party=${code} title="${title}" — HPH créé avec trackId=null`);
  }

  const deezerId = trackDoc.deezerId || trackDoc.deezerID || trackDoc.trackId;
  const hphDoc = {
    hostUserId,
    trackId:             resolved?._id || null,
    partyId,
    partyCode:           code,
    deezerTrackId:       (deezerId && !Number.isNaN(Number(deezerId))) ? Number(deezerId) : null,
    title:               trackDoc.title  || null,
    artist:              trackDoc.artist || null,
    playedAt:            trackDoc.playedAt ? new Date(trackDoc.playedAt) : new Date(),
    phase:               opts.phase || trackDoc.phase || party.currentPhase,
    wasSuggestedByGuest: !!trackDoc.suggestedBy,
    suggestedBy:         trackDoc.suggestedBy || null,
    // ★ audit 03/10 — normalisation centralisée : plus de ValidationError sur l'enum
    provider:            normalizeProvider(party.streamingProvider),
    // ★ audit 03/10 — le snapshot de votes existait dans trackHistory et se perdait ici
    voteScore: {
      feu:  trackDoc.fireCount || 0,
      cool: trackDoc.likeCount || 0,
      bof:  trackDoc.mehCount  || 0
    }
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await HostPlaybackHistory.create(hphDoc);
      party.hphCounters.success++;
      console.log(`[HPH][ok] party=${code} source=${source} title="${title}" trackId=${resolved?._id || 'null'} provider=${hphDoc.provider || 'null'} counters=${JSON.stringify(party.hphCounters)}`);
      return 'success';
    } catch (e) {
      if (e.code === 11000) { party.hphCounters.success++; return 'success'; } // doublon = idempotent
      if (e.name === 'ValidationError') {
        party.hphCounters.failed++;
        console.error(`[HPH][alert] party=${code} VALIDATION title="${title}" provider="${hphDoc.provider}" phase="${hphDoc.phase}" error="${e.message}" counters=${JSON.stringify(party.hphCounters)}`);
        return 'failed'; // inutile de retenter : la donnée sera rejetée à l'identique
      }
      if (attempt === 0) await new Promise(r => setTimeout(r, 500));
      else {
        party.hphCounters.failed++;
        console.error(`[HPH][alert] party=${code} CREATE FAILED after 2 attempts title="${title}" error="${e.message}" counters=${JSON.stringify(party.hphCounters)}`);
        return 'failed';
      }
    }
  }
  return 'failed';
}
