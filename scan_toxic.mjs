#!/usr/bin/env node
/**
 * scan_toxic.mjs — Scan curated_base_clean.json for toxic/garbage tracks
 * 
 * Checks:
 * 1. Title keywords (karaoke, 8-bit, parody, cover, emulation...)
 * 2. Artist keywords (party tyme, vox freaks, covers club...)
 * 3. Non-Latin characters in title/artist (Korean covers, etc.)
 * 4. Duplicate songs (same title, different artist = cover)
 * 5. COCOVARIET genre (not a valid SocialMix genre)
 * 6. Very short or very long duration
 * 7. Suspiciously generic artist names
 * 8. Missing critical data (no deezerID + no BPM + no energy)
 */

import fs from 'fs';

const INPUT = './curated_base_clean.json';
const data = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));
const tracks = data.tracks;

console.log(`\n🔍 SCAN TOXIC — ${tracks.length} tracks à analyser\n`);

// ═══ FILTERS ═══

const TOXIC_TITLE_KEYWORDS = [
    'karaoke', 'slowed', 'sped up', 'speed up', 'lullaby',
    'meditation', 'sleep music', 'rain sounds', 'white noise',
    'relaxation', 'study music', 'lofi', 'lo-fi', 'lo fi',
    'type beat', 'type beats', '(instrumental)', 'instrumental version',
    'gym music', 'workout music', 'fitness music',
    'orchestral version', 'piano version', 'acoustic version',
    'unplugged', 'tabata', 'as made famous by',
    'backing track', 'originally performed',
    '8-bit', '16-bit', 'emulation',
    'epic version', 'parody', 'nonstop party',
    'malle ist', 'griechischer wein', 'moskau',
    '(cover)', 'abba cover', 'dj remix)',
    'veridis quo', 'romanthony\'s unplugged',
    'chill session', 'chill hour', 'chill vibes',
    'deep house workout', 'deep house fitness',
    'tropical house vibes', 'ocean beach chill',
];

const TOXIC_ARTIST_KEYWORDS = [
    'lounge club', 'ibiza lounge', 'chill out zone', 'chill lounge',
    'ambient sounds', 'meditation', 'sleep sounds', 'nature sounds',
    'white noise', 'relaxation', 'spa music',
    'fitness music', 'workout music', 'gym music',
    'type beats', 'king beats', 'perreo mx',
    'deep house classics', 'chill deep house',
    'house music classics', 'best of house',
    'tabata songs', 'the backing tracks', 'believers in a dream',
    'yarondopiano',
    '8-bit arcade', 'arcade player', 'vox freaks', 'mixologia',
    'party tyme', 'covers club', 'pop & rock covers',
    'queen machine', 'abbacadabra', 'mat ryxx',
    'deutscher schlager', 'almklausi', 'dj linuxxx',
    'brazillian party djs', '90\'s club house',
    'party machine', 'dj kosse',
];

// Non-Latin character detection (Korean, Japanese, Chinese, Arabic, Cyrillic)
const NON_LATIN_REGEX = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\uFF00-\uFFEF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0400-\u04FF]/;

// Suspiciously generic artist names
const GENERIC_ARTISTS = [
    'various artists', 'compilation', 'soundtrack', 'ost',
    'club mix', 'dj mix', 'party mix', 'mega mix',
];

// ═══ SCAN ═══

const flagged = [];
const clean = [];
const titleMap = new Map(); // normalized title → [tracks]

// Normalize title for duplicate detection
function normalizeTitle(title) {
    return title.toLowerCase()
        .replace(/\s*\([^)]*(?:edit|mix|remix|version|remaster|extended|original|radio|club|feat|ft|featuring|recorded|live)[^)]*\)/gi, '')
        .replace(/\s*\[[^\]]*(?:edit|mix|remix|version|remaster|extended|original|radio|club|feat|ft|featuring)[^\]]*\]/gi, '')
        .replace(/\s*-\s*(?:radio edit|extended mix|club mix|original mix|remastered|remix).*$/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

for (const t of tracks) {
    const titleLower = (t.title || '').toLowerCase();
    const artistLower = (t.artist || '').toLowerCase();
    const reasons = [];

    // 1. Title keyword check
    for (const kw of TOXIC_TITLE_KEYWORDS) {
        if (titleLower.includes(kw)) {
            reasons.push(`🔴 TITLE: "${kw}"`);
            break;
        }
    }

    // 2. Artist keyword check
    for (const kw of TOXIC_ARTIST_KEYWORDS) {
        if (artistLower.includes(kw)) {
            reasons.push(`🔴 ARTIST: "${kw}"`);
            break;
        }
    }

    // 3. Non-Latin characters
    if (NON_LATIN_REGEX.test(t.title) || NON_LATIN_REGEX.test(t.artist)) {
        reasons.push(`🟠 NON-LATIN chars in "${t.artist} — ${t.title}"`);
    }

    // 4. COCOVARIET genre
    if (t.genre === 'COCOVARIET') {
        reasons.push(`🟡 Genre "COCOVARIET" — needs reclassification`);
    }

    // 5. Chill genre (not party material)
    if (t.genre === 'Chill') {
        reasons.push(`🟡 Genre "Chill" — ambient/lounge, not party`);
    }

    // 6. Missing critical data
    if (!t.deezerID || t.deezerID === 0) {
        if ((!t.bpm || t.bpm === 0) && (!t.energy || t.energy === 0)) {
            reasons.push(`🟠 NO deezerID + NO BPM + NO energy — blind track`);
        }
    }

    // 7. Duration check
    if (t.duration && (t.duration < 90 || t.duration > 600)) {
        reasons.push(`🟠 Duration ${t.duration}s — ${t.duration < 90 ? 'too short' : 'too long'}`);
    }

    // 8. Generic artists
    for (const ga of GENERIC_ARTISTS) {
        if (artistLower.includes(ga)) {
            reasons.push(`🟠 Generic artist: "${ga}"`);
            break;
        }
    }

    // 9. "(Mixed)" in title — often DJ mix compilations, not standalone tracks
    if (titleLower.includes('(mixed)') || titleLower.endsWith(' mixed)')) {
        reasons.push(`🟡 "(Mixed)" — DJ mix compilation track?`);
    }

    // Build duplicate map
    const normTitle = normalizeTitle(t.title);
    if (!titleMap.has(normTitle)) {
        titleMap.set(normTitle, []);
    }
    titleMap.get(normTitle).push(t);

    if (reasons.length > 0) {
        flagged.push({ ...t, toxicReasons: reasons });
    } else {
        clean.push(t);
    }
}

// 10. Duplicate detection (same song by different artists)
const duplicates = [];
for (const [normTitle, trackGroup] of titleMap) {
    if (trackGroup.length > 1) {
        // Check if different artists
        const uniqueArtists = new Set(trackGroup.map(t => t.artist.toLowerCase()));
        if (uniqueArtists.size > 1) {
            duplicates.push({
                normalizedTitle: normTitle,
                displayTitle: trackGroup[0].title,
                count: trackGroup.length,
                versions: trackGroup.map(t => `${t.artist} (${t.genre}, id:${t.deezerID})`),
            });
        }
    }
}

// ═══ REPORT ═══

console.log('═'.repeat(70));
console.log(`🔴 TRACKS TOXIQUES FLAGGÉS: ${flagged.length}/${tracks.length}`);
console.log('═'.repeat(70));

// Group by severity
const critical = flagged.filter(t => t.toxicReasons.some(r => r.startsWith('🔴')));
const warnings = flagged.filter(t => !t.toxicReasons.some(r => r.startsWith('🔴')) && t.toxicReasons.some(r => r.startsWith('🟠')));
const info = flagged.filter(t => t.toxicReasons.every(r => r.startsWith('🟡')));

console.log(`\n🔴 CRITIQUE (${critical.length}) — à SUPPRIMER:`);
for (const t of critical) {
    console.log(`  ${t.artist} — ${t.title}`);
    for (const r of t.toxicReasons) console.log(`    ${r}`);
}

console.log(`\n🟠 WARNING (${warnings.length}) — à VÉRIFIER:`);
for (const t of warnings) {
    console.log(`  ${t.artist} — ${t.title}`);
    for (const r of t.toxicReasons) console.log(`    ${r}`);
}

console.log(`\n🟡 INFO (${info.length}) — reclassification nécessaire:`);
for (const t of info) {
    console.log(`  ${t.artist} — ${t.title} [${t.genre}]`);
    for (const r of t.toxicReasons) console.log(`    ${r}`);
}

if (duplicates.length > 0) {
    console.log(`\n🔄 DOUBLONS POTENTIELS (${duplicates.length} titres en doublon):`);
    for (const d of duplicates.sort((a,b) => b.count - a.count).slice(0, 30)) {
        console.log(`  "${d.displayTitle}" × ${d.count} versions:`);
        for (const v of d.versions) console.log(`    - ${v}`);
    }
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`RÉSUMÉ`);
console.log(`${'═'.repeat(70)}`);
console.log(`Total            : ${tracks.length}`);
console.log(`✅ Clean          : ${clean.length}`);
console.log(`🔴 Critique       : ${critical.length} (supprimer)`);
console.log(`🟠 Warning        : ${warnings.length} (vérifier)`);
console.log(`🟡 Info           : ${info.length} (reclassifier)`);
console.log(`🔄 Doublons       : ${duplicates.length} titres avec versions multiples`);
console.log(`\nTaux de propreté  : ${(100 * clean.length / tracks.length).toFixed(1)}%`);

// Save flagged list for review
fs.writeFileSync('./toxic_tracks.json', JSON.stringify({
    scannedAt: new Date().toISOString(),
    total: tracks.length,
    critical: critical.map(t => ({ artist: t.artist, title: t.title, genre: t.genre, deezerID: t.deezerID, reasons: t.toxicReasons })),
    warnings: warnings.map(t => ({ artist: t.artist, title: t.title, genre: t.genre, deezerID: t.deezerID, reasons: t.toxicReasons })),
    info: info.map(t => ({ artist: t.artist, title: t.title, genre: t.genre, deezerID: t.deezerID, reasons: t.toxicReasons })),
    duplicates,
}, null, 2));

console.log(`\n📄 Détail sauvé dans toxic_tracks.json`);
