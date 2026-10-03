/**
 * lib/providers.js — Source unique de vérité des providers audio AhOuai.
 *
 * Contexte (audit 03/10/2026) : `Party.streamingProvider` acceptait des valeurs
 * (`appleMusic`, `apple`, `youtube`) que l'enum de `HostPlaybackHistory.provider`
 * refusait. Chaque `HostPlaybackHistory.create()` levait alors une ValidationError
 * Mongoose, muette car `party.hphCounters` n'était pas initialisé sur les parties
 * restaurées. Résultat : 556 titres sur 43 soirées jamais enregistrés, et une
 * Fresh Rotation cross-party aveugle sur toutes les soirées Apple Music et YouTube.
 *
 * Règle : les deux schémas importent leur enum d'ici, et toute valeur entrante passe
 * par normalizeProvider(). Une divergence de nomenclature ne peut plus réapparaître.
 */

/** Formes canoniques, seules autorisées en écriture dans HostPlaybackHistory. */
export const CANONICAL_PROVIDERS = [
  'apple_music',
  'spotify',
  'deezer',
  'just_play',
  'youtube'
];

/**
 * Alias historiques acceptés en entrée → forme canonique.
 * `appleMusic` : iOS host. `apple` : host web Lot 1.
 */
const ALIASES = {
  applemusic:  'apple_music',
  apple:       'apple_music',
  apple_music: 'apple_music',
  spotify:     'spotify',
  deezer:      'deezer',
  just_play:   'just_play',
  justplay:    'just_play',
  youtube:     'youtube',
  yt:          'youtube'
};

/**
 * Ramène n'importe quelle écriture de provider à sa forme canonique.
 * Retourne null pour une valeur absente, vide ou inconnue — null étant une valeur
 * valide des deux schémas, une valeur inconnue dégrade sans jamais faire échouer
 * l'écriture de l'historique de lecture.
 *
 * @param {*} value
 * @returns {string|null}
 */
export function normalizeProvider(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toLowerCase().replace(/[\s-]/g, '_');
  if (!key) return null;
  return ALIASES[key] || null;
}

/** Enum Mongoose pour HostPlaybackHistory.provider (canoniques + null). */
export const HPH_PROVIDER_ENUM = [...CANONICAL_PROVIDERS, null];

/**
 * Enum Mongoose pour Party.streamingProvider.
 * Conserve les alias historiques : des documents existants les portent déjà et les
 * clients iOS/web en circulation les émettent encore. La normalisation se fait à la
 * lecture plutôt qu'en restreignant l'enum, pour ne casser aucune écriture en vol.
 */
export const PARTY_PROVIDER_ENUM = [
  'apple_music', 'appleMusic', 'apple',
  'spotify', 'deezer', 'just_play', 'youtube',
  null
];
