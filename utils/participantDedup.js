/**
 * utils/participantDedup.js
 * ★ Univers V1 — dédup stricte des participants.
 *
 * RÈGLE CANONIQUE (aucune fusion par nom) :
 *   1. userId identique → même personne
 *   2. sinon email normalisé (lowercase, trim) identique et non-vide
 *   3. sinon socketId identique (session stable)
 *   4. sinon id identique (fallback ObjectId ou string)
 *   5. sinon → 2 entrées distinctes CONSERVÉES
 *
 * Le nom normalisé (strip suffixe -N, accents, casse) reste utilisable
 * pour de l'affichage ou du diagnostic (anomalie logguée) MAIS N'EST JAMAIS
 * une clé d'identité. Deux "Romeo" ne sont pas automatiquement fusionnés.
 */

/**
 * Normalise un email : lowercase + trim. Renvoie null si vide ou invalide.
 */
export function normalizeEmail(raw) {
  const str = String(raw || '').toLowerCase().trim();
  if (!str) return null;
  if (!str.includes('@')) return null;
  return str;
}

/**
 * Normalise un nom pour affichage/diagnostic seulement.
 * Ne pas utiliser comme clé d'identité.
 */
export function normalizeNameForDisplay(raw) {
  return String(raw || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/-\d+$/, '')
    .trim();
}

/**
 * Calcule la clé d'identité canonique d'un participant.
 * Renvoie null si aucune clé stable n'existe (l'entrée doit alors
 * être conservée telle quelle en tant qu'entrée unique).
 *
 * @param {Object} p — participant avec { userId, email, socketId, id }
 * @returns {string|null}
 */
export function computeIdentityKey(p) {
  if (!p) return null;
  if (p.userId) return `uid:${String(p.userId)}`;
  const email = normalizeEmail(p.email);
  if (email) return `email:${email}`;
  if (p.socketId) return `sock:${String(p.socketId)}`;
  if (p.id) return `id:${String(p.id)}`;
  return null; // Pas de fusion possible — conserver l'entrée telle quelle
}

/**
 * Dédup une liste de participants selon les règles canoniques.
 * Les entrées sans clé stable sont conservées individuellement.
 *
 * Pour les fusionnées : première occurrence conservée, éventuel merge de
 * métadonnées via une fonction de résolution optionnelle.
 *
 * @param {Array} participants
 * @param {Object} [opts]
 * @param {(existing:Object, next:Object) => Object} [opts.resolve] — merge custom
 * @param {boolean}  [opts.logAnomalies=false] — log si 2 clés distinctes ont même nom normalisé
 * @returns {Array} entrées déduppées
 */
export function dedupParticipants(participants, opts = {}) {
  const list = Array.isArray(participants) ? participants : [];
  const byKey = new Map();
  const unkeyed = [];
  const nameIndex = new Map(); // pour diagnostic optionnel

  for (const p of list) {
    if (!p) continue;
    const key = computeIdentityKey(p);
    if (key === null) {
      unkeyed.push(p);
      continue;
    }
    if (!byKey.has(key)) {
      byKey.set(key, { ...p });
    } else if (typeof opts.resolve === 'function') {
      const merged = opts.resolve(byKey.get(key), p);
      if (merged && typeof merged === 'object') byKey.set(key, merged);
    }

    if (opts.logAnomalies) {
      const nk = normalizeNameForDisplay(p.name);
      if (nk) {
        if (!nameIndex.has(nk)) nameIndex.set(nk, key);
        else if (nameIndex.get(nk) !== key) {
          // Nom identique mais identité distincte : signaler pour audit
          console.warn(`[participantDedup] Anomalie potentielle : "${p.name}" partagé entre ${nameIndex.get(nk)} et ${key}`);
        }
      }
    }
  }

  return [...byKey.values(), ...unkeyed];
}

/**
 * Prédicat : est-ce que 2 participants représentent la même personne ?
 * Utilise la même règle canonique. Ne matche jamais par nom seul.
 */
export function isSameIdentity(a, b) {
  const kA = computeIdentityKey(a);
  const kB = computeIdentityKey(b);
  if (kA === null || kB === null) return false;
  return kA === kB;
}

/**
 * Filtre une liste de participants → uniquement ceux qui matchent l'identité
 * cible. Utile pour vérifier si me + target sont co-participants d'une party.
 */
export function findMatches(participants, target) {
  const kT = computeIdentityKey(target);
  if (kT === null) return [];
  return (participants || []).filter(p => computeIdentityKey(p) === kT);
}

export default {
  normalizeEmail,
  normalizeNameForDisplay,
  computeIdentityKey,
  dedupParticipants,
  isSameIdentity,
  findMatches,
};
