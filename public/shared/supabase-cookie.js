/**
 * public/shared/supabase-cookie.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lecture ET écriture des cookies chunked au format @supabase/ssr 0.12.x.
 *
 * FORMAT D'ÉCRITURE (calqué sur cookies.js L207-218 + chunker.js createChunks) :
 *   JSON_string (passé par setItemAsync)
 *     → 'base64-' + stringToBase64URL(JSON_string)   [BASE64_PREFIX + base64url]
 *     → encodeURIComponent(encoded)                   [createChunks]
 *     → split ≤ MAX_CHUNK_SIZE (3180) chars encodés, bord propre (pas de %xx tronqué)
 *     → decodeURIComponent de chaque sous-chaîne → valeur brute du chunk
 *     → 1 seul chunk → cookie `${key}` sans suffixe
 *     → N chunks → cookies `${key}.0`, `${key}.1`, …
 *
 * FORMAT DE LECTURE (inchangé) :
 *   1. Joindre les valeurs brutes des cookies .0, .1, … (PAS de décodage par chunk)
 *   2. Si le résultat commence par 'base64-' → base64url decode → JSON string
 *   3. Valider JSON.parse → retourner la string
 *
 * NETTOYAGE :
 *   setItem : avant écriture, supprime les anciens chunks excédentaires (et le
 *             cookie sans suffixe si on passe en chunked, et inversement).
 *   removeItem : supprime `${key}`, `${key}.0..19` + localStorage.
 *
 * MIRROR localStorage : setItem écrit aussi localStorage (fallback getItem,
 *   compat sessions non-cookie). removeItem supprime les deux.
 *
 * Référence : @supabase/ssr dist/module/cookies.js (createServerClient setItem)
 *             @supabase/ssr dist/module/utils/chunker.js (createChunks, combineChunks)
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

  // ── Encodeur base64url (stringToBase64URL côté écriture) ─────────────────────
  // Symétrique de _base64urlToString (lecture). Utilise TextEncoder + btoa.
  function _stringToBase64URL(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // ── createChunks (calqué sur @supabase/ssr chunker.js createChunks) ───────────
  // Découpe `encodeURIComponent(value)` en morceaux ≤ MAX_CHUNK_SIZE,
  // en respectant les bords %xx (jamais de séquence tronquée).
  // Retourne [{name, value}] : 1 élément si pas besoin de chunker (sans suffixe).
  const MAX_CHUNK_SIZE = 3180;
  function _createChunks(key, value) {
    let encodedValue = encodeURIComponent(value);
    if (encodedValue.length <= MAX_CHUNK_SIZE) {
      return [{ name: key, value }]; // cookie unique, nom sans suffixe
    }
    const chunks = [];
    while (encodedValue.length > 0) {
      let head = encodedValue.slice(0, MAX_CHUNK_SIZE);
      // Reculer si la dernière séquence %xx est tronquée
      const lastPct = head.lastIndexOf('%');
      if (lastPct > MAX_CHUNK_SIZE - 3) {
        head = head.slice(0, lastPct);
      }
      // Garantir un bord unicode valide
      let valueHead = '';
      while (head.length > 0) {
        try { valueHead = decodeURIComponent(head); break; }
        catch (e) {
          if (e instanceof URIError && head.at(-3) === '%' && head.length > 3) {
            head = head.slice(0, head.length - 3);
          } else { throw e; }
        }
      }
      chunks.push(valueHead);
      encodedValue = encodedValue.slice(head.length);
    }
    return chunks.map((v, i) => ({ name: `${key}.${i}`, value: v }));
  }

  // ── Supprimer les anciens chunks excédentaires ─────────────────────────────
  // Avant d'écrire N nouveaux chunks, supprimer les chunks .N .. .19 restants
  // + le cookie sans suffixe si on passe en mode chunked (et inversement).
  function _clearOldChunks(key, newChunks, domAttr) {
    const newNames = new Set(newChunks.map(c => c.name));
    // Supprimer le cookie sans suffixe si les nouveaux chunks ont des suffixes
    if (!newNames.has(key)) {
      document.cookie = `${key}=; max-age=0${domAttr}; path=/`;
    }
    // Supprimer .0..19 qui ne sont plus dans newNames
    for (let i = 0; i < 20; i++) {
      const name = `${key}.${i}`;
      if (!newNames.has(name)) {
        document.cookie = `${name}=; max-age=0${domAttr}; path=/`;
      }
    }
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
          // 0.4 fix : écriture au format @supabase/ssr (base64url + chunks ≤ 3180).
          // value = JSON.stringify(session) passé par setItemAsync de auth-js.
          // Encodage identique à cookies.js L207-218 + chunker.js createChunks.
          const encoded = 'base64-' + _stringToBase64URL(value);
          const chunks  = _createChunks(key, encoded);

          // Nettoyer les anciens chunks avant d'écrire les nouveaux
          _clearOldChunks(key, chunks, domAttr);

          // Écrire les nouveaux chunks (1 cookie sans suffixe ou N avec .0,.1,…)
          chunks.forEach(({ name, value: val }) => {
            document.cookie =
              `${name}=${encodeURIComponent(val)}${domAttr}; path=/; max-age=${MAX_AGE}; SameSite=Lax${secureFlag}`;
          });

          // Mirror localStorage (fallback pour getItem, même origine)
          localStorage.setItem(key, value);

          if (debugFn) {
            debugFn(
              `supabase-cookie setItem (…${key.slice(-12)}): ` +
              `${chunks.length} chunk(s), encoded ${encoded.length} chars`
            );
          }
        } catch (e) {
          if (debugFn) debugFn(`supabase-cookie setItem err: ${e.message}`);
        }
      },
      removeItem(key) {
        try {
          // Supprimer le cookie sans suffixe + .0..19
          document.cookie = `${key}=; max-age=0${domAttr}; path=/`;
          for (let i = 0; i < 20; i++) {
            document.cookie = `${key}.${i}=; max-age=0${domAttr}; path=/`;
          }
          localStorage.removeItem(key);
        } catch {}
      }
    };
  }

  // Exposer sur window pour host.js (module ES) et app.js (non-module)
  global.SupabaseCookie = { readChunked, makeStorage };

}(typeof window !== 'undefined' ? window : global));
