/**
 * lib/resolveHost.js — Résolution du hostUserId par cascade.
 *
 * Contexte (audit 03/10/2026) : `party.hostUserId` n'est renseigné au démarrage que
 * si `party.hostProfile.email` correspond à un User (server.js L5252). Quand ce n'est
 * pas le cas, l'historique de lecture partait en `skip reason=no_hostUserId` et la
 * soirée perdait tous ses titres.
 *
 * Or le host reste identifiable par trois autres voies déjà présentes en base. Plutôt
 * que d'abandonner, on les essaie dans l'ordre, du signal le plus fort au plus faible.
 * Aucune n'invente de donnée : chacune lit un champ existant.
 */

import mongoose from 'mongoose';
import Party from '../models/Party.js';
import User from '../models/User.js';

const OID_RE = /^[0-9a-fA-F]{24}$/;
const toOid = v => { try { return new mongoose.Types.ObjectId(String(v)); } catch { return null; } };

/**
 * @param {object} partyDoc document ou état RAM de la soirée
 * @returns {Promise<{userId: mongoose.Types.ObjectId|null, via: string}>}
 *          `via` documente le chemin utilisé — à journaliser pour l'audit.
 */
export async function resolveHostUserId(partyDoc) {
  // 1. Le champ lui-même (cas nominal)
  if (partyDoc?.hostUserId) {
    const oid = toOid(partyDoc.hostUserId);
    if (oid) return { userId: oid, via: 'party.hostUserId' };
  }

  // 2. Le participant marqué isHost — renseigné par host:startParty depuis socket.user
  const hostPart = (partyDoc?.participants || []).find(p => p?.isHost && p?.userId);
  if (hostPart && OID_RE.test(String(hostPart.userId))) {
    return { userId: toOid(hostPart.userId), via: 'participants.isHost.userId' };
  }

  // 3. L'email du profil hôte — même lookup que host:startParty, rejoué a posteriori
  const email = (partyDoc?.hostProfile?.email || hostPart?.email || '').toLowerCase().trim();
  if (email) {
    const u = await User.findOne({ email }).select('_id').lean().catch(() => null);
    if (u?._id) return { userId: u._id, via: 'hostProfile.email' };
  }

  // 4. Le hostSecret — stable par appareil hôte : une autre soirée partageant ce secret
  //    et portant un hostUserId désigne le même host.
  if (partyDoc?.hostSecret) {
    const sibling = await Party.findOne({
      hostSecret: partyDoc.hostSecret,
      hostUserId: { $ne: null },
      _id: { $ne: partyDoc._id }
    }).select('hostUserId').lean().catch(() => null);
    if (sibling?.hostUserId) {
      return { userId: toOid(sibling.hostUserId), via: 'hostSecret (soirée sœur)' };
    }
  }

  return { userId: null, via: 'aucun' };
}
