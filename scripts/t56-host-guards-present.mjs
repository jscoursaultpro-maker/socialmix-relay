/**
 * Garde statique Task #56 (doctrine 3.11) — vérifie que les deux handlers de
 * modération host portent bien la garde `socket.id === party.hostSocketId`,
 * ET que cette garde précède la mutation (splice/filter). Analyse statique du
 * source server.js (pas de boot serveur : MongoDB requis, hors allowlist conteneur).
 *
 * Régression visée : avant Task #56, host:deletePhoto / host:deleteMessage
 * étaient émettables par N'IMPORTE quel socket de la room → suppression de
 * photos/messages sans être l'hôte. Ce banc casse le build si la garde saute.
 *
 * Exit 0 = les 2 gardes présentes et bien placées. Exit 1 = régression.
 */
import { readFileSync } from 'fs';

const SRC_PATH = new URL('../server.js', import.meta.url).pathname;
const src = readFileSync(SRC_PATH, 'utf8');

// Chaque handler : où commence son socket.on, et la mutation qui doit être gardée.
const HANDLERS = [
  { event: 'host:deletePhoto',   mutation: 'party.photos.splice' },
  { event: 'host:deleteMessage', mutation: 'party.messages = party.messages.filter' },
];
const GUARD = 'socket.id !== party.hostSocketId';

let fail = 0;
console.log('── Task #56 — gardes host sur la modération (analyse statique) ──');

for (const { event, mutation } of HANDLERS) {
  const onIdx = src.indexOf(`socket.on('${event}'`);
  if (onIdx < 0) {
    console.log(`❌ ${event} : handler introuvable dans server.js`);
    fail++;
    continue;
  }
  // Corps du handler = du socket.on jusqu'au prochain socket.on( (borne sûre).
  const nextOn = src.indexOf('socket.on(', onIdx + 10);
  const body = src.slice(onIdx, nextOn < 0 ? src.length : nextOn);

  const guardIdx = body.indexOf(GUARD);
  const mutIdx = body.indexOf(mutation);

  if (guardIdx < 0) {
    console.log(`❌ ${event} : garde « ${GUARD} » ABSENTE`);
    fail++;
    continue;
  }
  if (mutIdx < 0) {
    console.log(`❌ ${event} : mutation « ${mutation} » introuvable (handler modifié ?)`);
    fail++;
    continue;
  }
  if (guardIdx > mutIdx) {
    console.log(`❌ ${event} : garde présente mais APRÈS la mutation (inefficace)`);
    fail++;
    continue;
  }
  console.log(`✅ ${event} : garde host présente et avant la mutation`);
}

console.log(`${'─'.repeat(52)}\n${HANDLERS.length - fail}/${HANDLERS.length} gardes OK`);
process.exit(fail === 0 ? 0 : 1);
