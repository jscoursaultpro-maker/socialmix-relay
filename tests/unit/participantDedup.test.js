/**
 * tests/unit/participantDedup.test.js
 * ★ Univers V1 — coverage complète du helper de dédup.
 */
import { describe, it, expect } from 'vitest';
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
    expect(normalizeEmail(' Foo@BAR.com ')).toBe('foo@bar.com');
  });
  it('renvoie null pour empty ou sans @', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('abc')).toBeNull();
  });
});

describe('normalizeNameForDisplay', () => {
  it('accents + case + suffix -N', () => {
    expect(normalizeNameForDisplay('  Jóse-2  ')).toBe('jose');
    expect(normalizeNameForDisplay('Romeo-3')).toBe('romeo');
    expect(normalizeNameForDisplay('romeo')).toBe('romeo');
  });
});

describe('computeIdentityKey', () => {
  it('priorité userId', () => {
    expect(computeIdentityKey({ userId: 'abc', email: 'x@y.com' })).toBe('uid:abc');
  });
  it('fallback email', () => {
    expect(computeIdentityKey({ email: 'X@Y.com', name: 'Romeo' })).toBe('email:x@y.com');
  });
  it('fallback socketId', () => {
    expect(computeIdentityKey({ socketId: 'sok1', name: 'Romeo' })).toBe('sock:sok1');
  });
  it('fallback id', () => {
    expect(computeIdentityKey({ id: 'id1' })).toBe('id:id1');
  });
  it('null si rien', () => {
    expect(computeIdentityKey({ name: 'Romeo' })).toBeNull();
    expect(computeIdentityKey(null)).toBeNull();
  });
});

describe('dedupParticipants', () => {
  it('fusionne par userId', () => {
    const out = dedupParticipants([
      { userId: 'u1', name: 'Romeo' },
      { userId: 'u1', name: 'romeo-2' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Romeo');
  });

  it('fusionne par email si pas userId', () => {
    const out = dedupParticipants([
      { email: 'a@b.com', name: 'Romeo' },
      { email: 'A@B.com', name: 'romeo-2' },
    ]);
    expect(out).toHaveLength(1);
  });

  it("NE fusionne PAS deux Romeo sans userId/email/socketId communs", () => {
    // Règle stricte : sans clé stable, on conserve les 2 entrées.
    const out = dedupParticipants([
      { socketId: 'sock1', name: 'Romeo' },
      { socketId: 'sock2', name: 'Romeo' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('conserve entrées sans clé', () => {
    const out = dedupParticipants([
      { name: 'Alice' },
      { name: 'Bob' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('applique resolve pour merge personnalisé', () => {
    const out = dedupParticipants([
      { userId: 'u1', name: 'Romeo', score: 10 },
      { userId: 'u1', name: 'Romeo v2', score: 5 },
    ], {
      resolve: (a, b) => ({ ...a, score: (a.score || 0) + (b.score || 0) }),
    });
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(15);
  });

  it('input non-array → array vide', () => {
    expect(dedupParticipants(null)).toEqual([]);
    expect(dedupParticipants(undefined)).toEqual([]);
  });
});

describe('isSameIdentity', () => {
  it('true si même userId', () => {
    expect(isSameIdentity({ userId: 'u1' }, { userId: 'u1' })).toBe(true);
  });
  it('false si un des 2 sans clé stable', () => {
    expect(isSameIdentity({ userId: 'u1' }, { name: 'X' })).toBe(false);
  });
  it('false si noms identiques mais userIds différents (règle stricte)', () => {
    expect(isSameIdentity({ userId: 'u1', name: 'Romeo' }, { userId: 'u2', name: 'Romeo' })).toBe(false);
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
    expect(hits).toHaveLength(2);
  });
  it('renvoie [] si target sans clé', () => {
    expect(findMatches([{userId:'u1'}], { name: 'anon' })).toEqual([]);
  });
});
