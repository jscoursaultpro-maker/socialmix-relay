/**
 * public/shared/supabase-cookie.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lecture des cookies chunked écrits par @supabase/ssr 0.12.x (browser client).
 *
 * @supabase/ssr encode la session ainsi (cookies.js + chunker.js) :
 *   JSON_string
 *     → BASE64_PREFIX('base64-') + stringToBase64URL(JSON_string)  [si cookieEncoding='base64url']
 *     → encodeURIComponent(encoded)                                [createChunks]
 *     → split à MAX_CHUNK_SIZE (3180) chars encodés
 *     → decodeURIComponent par chunk
 *     → cookies sb-*-auth-token.0, sb-*-auth-token.1, …
 *
 * Lecture : inverser DANS LE BON ORDRE :
 *   1. Joindre les valeurs brutes des cookies .0, .1, … (PAS de décodage par chunk)
 *   2. Si le résultat commence par 'base64-' → base64url decode → JSON string
 *   3. Valider JSON.parse → retourner la string
 *
 * Bug précédent (host.js / app.js) : décodage individuel de chaque chunk.
 * Chunk .0 = fragment de base64url tronqué → _base64urlDecode → null → break →
 * aucun chunk assemblé.
 *
 * Référence : @supabase/ssr dist/module/cookies.js L39-57 (decodeChunkedCookieValue)
 *             @supabase/ssr dist/module/utils/chunker.js L59-76 (combineChunks)
 *
 * Ce fichier est un script vanilla (pas de module ES, pas d'export) pour être
 * chargé avant app.js (non-module) et host.js (module ES).
 * Il expose window.SupabaseCookie = { readChunked, makeStorage }.
 *
 * Garanti sans valeur de cookie/token dans les logs.
 */

/* global window, document, localStorage, TextDecoder, Uint8Array, atob */

(function (global) {
  'use strict';

  // ── Base64url décodeur ──────────────────────────────────────────────────────
  // Normalise base64url → base64 standard, puis atob + TextDecoder UTF-8.
  // Utilise TextDecoder pour une gestion correcte du multi-octet (emoji, etc.)
  function _base64urlToString(str) {
    // Retirer les espaces/sauts (défensif contre WhatsApp / mail link wrapping)
    const clean = str.replace(/[\s]/g, '');
    // base64url → base64 standard
    const b64 = clean.replace(/-/g, '+').replace(/_/g, '/')
      + '=='.slice(0, (4 - clean.length % 4) % 4);
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (e) {
      return null;
    }
  }

  // ── Lecture directe d'un cookie par nom ────────────────────────────────────
  function _getCookieRaw(name) {
    const escaped = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const m = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ── Assembler les chunks bruts (.0, .1, …) SANS décoder ────────────────────
  // Calqué sur combineChunks (chunker.js L59-76) mais synchrone (document.cookie).
  function _combineRaw(key) {
    // Tenter d'abord la clé directe (session courte, non chunked)
    const direct = _getCookieRaw(key);
    if (direct !== null) return { raw: direct, chunkCount: 1, wasChunked: false };

    // Lire les chunks .0, .1, … et joindre les valeurs brutes
    let assembled = '';
    let i = 0;
    for (; i < 20; i++) {
      const val = _getCookieRaw(key + '.' + i);
      if (val === null) break;
      assembled += val;
    }
    if (i === 0) return null; // aucun chunk trouvé
    return { raw: assembled, chunkCount: i, wasChunked: true };
  }

  // ── Décoder la valeur assemblée → JSON string ──────────────────────────────
  // Calqué sur decodeChunkedCookieValue (cookies.js L39-57).
  // Retourne la JSON string ou null si invalide.
  function _decodeAssembled(raw, debugFn, key) {
    let json;
    if (raw.startsWith('base64-')) {
      json = _base64urlToString(raw.slice(7));
      if (json === null) {
        if (debugFn) debugFn(`supabase-cookie: base64url decode FAIL (key=…${key.slice(-12)})`);
        return null;
      }
    } else {
      json = raw;
    }
    try {
      JSON.parse(json);
      return json; // JSON valide → retourner la string (SDK appellera JSON.parse lui-même)
    } catch {
      if (debugFn) debugFn(`supabase-cookie: JSON.parse KO (key=…${key.slice(-12)}) — chunks incomplets`);
      return null;
    }
  }

  // ── API publique ───────────────────────────────────────────────────────────

  /**
   * readChunked(key, debugFn?)
   * Lit et assemble les cookies chunked écrits par @supabase/ssr.
   * Retourne la JSON string de session ou null.
   * @param {string}   key     – storageKey Supabase (ex: 'sb-xjcomwhz…-auth-token')
   * @param {Function} [debugFn] – fn(msg) appelée pour les logs debug (sans valeur)
   */
  function readChunked(key, debugFn) {
    const result = _combineRaw(key);

    if (!result) {
      if (debugFn) debugFn(`supabase-cookie(…${key.slice(-12)}): 0 chunk — cookie absent ou domain non partagé`);
      return null;
    }

    const json = _decodeAssembled(result.raw, debugFn, key);

    if (debugFn) {
      const hasB64 = result.raw.startsWith('base64-');
      debugFn(
        `supabase-cookie(…${key.slice(-12)}): ` +
        `${result.chunkCount} chunk(s)${result.wasChunked ? ' chunked' : ' direct'}, ` +
        `${result.raw.length} chars bruts, base64-: ${hasB64}, ` +
        `JSON: ${json !== null ? 'OK' : 'KO'}`
      );
    }

    return json;
  }

  /**
   * makeStorage(options)
   * Retourne un objet storage compatible Supabase JS SDK v2 (auth.storage).
   *
   * @param {object} options
   * @param {string|null} options.cookieDomain  – '.ahouai.com' en prod, null en dev
   * @param {string}      options.secureFlag    – '; Secure' ou ''
   * @param {Function}    [options.debugFn]     – fn(msg) pour logs debug
   */
  function makeStorage(options) {
    const { cookieDomain, secureFlag, debugFn } = options;
    const domAttr = cookieDomain ? `; domain=${cookieDomain}` : '';
    const MAX_AGE = 365 * 24 * 3600;

    return {
      getItem(key) {
        try {
          const json = readChunked(key, debugFn);
          if (json !== null) return json;
          // Fallback localStorage (compat sessions migrated)
          return localStorage.getItem(key);
        } catch { return null; }
      },
      setItem(key, value) {
        try {
          // Écriture en cookie unique (pas de chunking côté relay :
          // la session relay est écrite par le SDK standalone @supabase/supabase-js
          // qui n'est pas @supabase/ssr → pas de fragmentation).
          const enc = encodeURIComponent(value);
          document.cookie = `${key}=${enc}${domAttr}; path=/; max-age=${MAX_AGE}; SameSite=Lax${secureFlag}`;
          localStorage.setItem(key, value);
        } catch (e) {
          if (debugFn) debugFn(`supabase-cookie setItem err: ${e.message}`);
        }
      },
      removeItem(key) {
        try {
          document.cookie = `${key}=; max-age=0${domAttr}; path=/`;
          localStorage.removeItem(key);
        } catch {}
      }
    };
  }

  // Exposer sur window pour host.js (module ES) et app.js (non-module)
  global.SupabaseCookie = { readChunked, makeStorage };

}(typeof window !== 'undefined' ? window : global));
