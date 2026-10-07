/**
 * tests/unit/participantDedup.test.js
 * ★ Univers V1 — coverage complète du helper de dédup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  normalizeNameForDisplay,
  computeIdentityKey,
  dedupParticipants,
  isSameIdentity,
  findMatches,
} from '../../utils/participantDedup.js';

describe('normalizeEmail', () => {
  it('lowercase + trim', () => {
    assert.equal(normalizeEmail(' Foo@BAR.com '), 'foo@bar.com');
  });
  it('renvoie null pour empty ou sans @', () => {
    assert.equal(normalizeEmail(''), null);
    assert.equal(normalizeEmail(null), null);
    assert.equal(normalizeEmail('abc'), null);
  });
});

describe('normalizeNameForDisplay', () => {
  it('accents + case + suffix -N', () => {
    assert.equal(normalizeNameForDisplay('  Jóse-2  '), 'jose');
    assert.equal(normalizeNameForDisplay('Romeo-3'), 'romeo');
    assert.equal(normalizeNameForDisplay('romeo'), 'romeo');
  });
});

describe('computeIdentityKey', () => {
  it('priorité userId', () => {
    assert.equal(computeIdentityKey({ userId: 'abc', email: 'x@y.com' }), 'uid:abc');
  });
  it('fallback email', () => {
    assert.equal(computeIdentityKey({ email: 'X@Y.com', name: 'Romeo' }), 'email:x@y.com');
  });
  it('fallback socketId', () => {
    assert.equal(computeIdentityKey({ socketId: 'sok1', name: 'Romeo' }), 'sock:sok1');
  });
  it('fallback id', () => {
    assert.equal(computeIdentityKey({ id: 'id1' }), 'id:id1');
  });
  it('null si rien', () => {
    assert.equal(computeIdentityKey({ name: 'Romeo' }), null);
    assert.equal(computeIdentityKey(null), null);
  });
});

describe('dedupParticipants', () => {
  it('fusionne par userId', () => {
    const out = dedupParticipants([
      { userId: 'u1', name: 'Romeo' },
      { userId: 'u1', name: 'romeo-2' },
    ]);
    assert.equal((out).length, 1);
    assert.equal(out[0].name, 'Romeo');
  });

  it('fusionne par email si pas userId', () => {
    const out = dedupParticipants([
      { email: 'a@b.com', name: 'Romeo' },
      { email: 'A@B.com', name: 'romeo-2' },
    ]);
    assert.equal((out).length, 1);
  });

  it("NE fusionne PAS deux Romeo sans userId/email/socketId communs", () => {
    // Règle stricte : sans clé stable, on conserve les 2 entrées.
    const out = dedupParticipants([
      { socketId: 'sock1', name: 'Romeo' },
      { socketId: 'sock2', name: 'Romeo' },
    ]);
    assert.equal((out).length, 2);
  });

  it('conserve entrées sans clé', () => {
    const out = dedupParticipants([
      { name: 'Alice' },
      { name: 'Bob' },
    ]);
    assert.equal((out).length, 2);
  });

  it('applique resolve pour merge personnalisé', () => {
    const out = dedupParticipants([
      { userId: 'u1', name: 'Romeo', score: 10 },
      { userId: 'u1', name: 'Romeo v2', score: 5 },
    ], {
      resolve: (a, b) => ({ ...a, score: (a.score || 0) + (b.score || 0) }),
    });
    assert.equal((out).length, 1);
    assert.equal(out[0].score, 15);
  });

  it('input non-array → array vide', () => {
    assert.deepEqual(dedupParticipants(null), []);
    assert.deepEqual(dedupParticipants(undefined), []);
  });
});

describe('isSameIdentity', () => {
  it('true si même userId', () => {
    assert.equal(isSameIdentity({ userId: 'u1' }, { userId: 'u1' }), true);
  });
  it('false si un des 2 sans clé stable', () => {
    assert.equal(isSameIdentity({ userId: 'u1' }, { name: 'X' }), false);
  });
  it('false si noms identiques mais userIds différents (règle stricte)', () => {
    assert.equal(isSameIdentity({ userId: 'u1', name: 'Romeo' }, { userId: 'u2', name: 'Romeo' }), false);
  });
});

describe('findMatches', () => {
  it('trouve les entrées matchant identité cible', () => {
    const parts = [
      { userId: 'u1', name: 'A' },
      { userId: 'u2', name: 'B' },
      { userId: 'u1', name: 'A bis' }, // même u1
    ];
    const hits = findMatches(parts, { userId: 'u1' });
    assert.equal((hits).length, 2);
  });
  it('renvoie [] si target sans clé', () => {
    assert.deepEqual(findMatches([{userId:'u1'}], { name: 'anon' }), []);
  });
});
