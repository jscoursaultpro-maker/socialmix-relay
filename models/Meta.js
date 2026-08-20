// models/Meta.js
// ★ Chantier 2 (20/08) — Clé-valeur générique pour état global serveur.
// Premier usage : seedVersion (compteur incrémental signalant tout changement Track catalogue).

import mongoose from 'mongoose';

const metaSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true, index: true },
  value:     { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
});

const Meta = mongoose.model('Meta', metaSchema);

/**
 * Incrémente seedVersion et retourne la nouvelle valeur.
 * Upsert : crée le doc si absent (premier démarrage).
 * @param {import('socket.io').Server} [io] — si fourni, broadcast seed:updated à tous les hosts
 * @returns {Promise<number>} nouvelle seedVersion
 */
export async function bumpSeedVersion(io) {
  try {
    const doc = await Meta.findOneAndUpdate(
      { key: 'seedVersion' },
      { $inc: { value: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    const v = doc.value;
    console.log(`[SeedVersion] bumped to ${v}`);

    // ★ Étape 4: broadcast seed:updated à tous les sockets connectés
    if (io) {
      io.emit('seed:updated', { version: v, timestamp: new Date() });
      console.log(`[SeedVersion] broadcast seed:updated v${v}`);
    }

    return v;
  } catch (err) {
    console.error(`[SeedVersion] ❌ bump failed: ${err.message}`);
    return null;
  }
}

/**
 * Retourne la seedVersion courante (sans incrémenter).
 * @returns {Promise<number>}
 */
export async function getSeedVersion() {
  const doc = await Meta.findOne({ key: 'seedVersion' });
  return doc?.value ?? 0;
}

export default Meta;
