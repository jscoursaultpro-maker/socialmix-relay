#!/usr/bin/env python3
"""
Analyse le BPM par signal audio sur chaque preview Deezer 30 s de l'inbox,
et enrichit le JSON avec :
  - bpm_signal           : BPM détecté par librosa (float, 1 décimale)
  - bpm_signal_source    : "preview_signal"
  - bpm_consensus        : objet comparant signal vs Deezer et proposant la vraie valeur
  - bpm_recommended      : la valeur à retenir pour la qualification
  - bpm_half_time        : true si Deezer renvoie le double-time (ex. reggae 152, trap 140)

Usage :
  python3 scripts/curation/analyze_bpm_signal.py \
      --inbox curation-data/inbox/2026-10-02-d.json

Jamais écrit en BDD. Jamais besoin de clé API. Utilise uniquement le preview
public Deezer déjà présent dans track.deezer_verification.match.preview.

Coût : 0 €. Zéro quota, zéro ban risk (preview public, 1 req/s suffit).
"""
import argparse
import json
import os
import sys
import tempfile
import time
import urllib.request
import warnings

warnings.filterwarnings("ignore")

# librosa + numpy sont installés dans le workflow via pip
try:
    import numpy as np
    import librosa
except ImportError as e:
    print(f"❌ Dépendance manquante : {e}. Lancer : pip install librosa", file=sys.stderr)
    sys.exit(1)


DEEZER_MIN_INTERVAL = 1.0  # s entre deux downloads preview (ton serré)
_last_dl = 0.0


def throttled_download(url: str, dest: str) -> bool:
    """Télécharge le preview mp3 avec un throttle doux. Retourne True si OK."""
    global _last_dl
    wait = DEEZER_MIN_INTERVAL - (time.time() - _last_dl)
    if wait > 0:
        time.sleep(wait)
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "AhOuai-curation/1.0 (private use)"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            with open(dest, "wb") as f:
                f.write(r.read())
        _last_dl = time.time()
        return True
    except Exception as e:
        print(f"      download fail: {e}", file=sys.stderr)
        _last_dl = time.time()
        return False


def analyze_bpm(mp3_path: str) -> float | None:
    """Analyse BPM via librosa. Retourne un float ou None."""
    try:
        # 22 050 Hz suffit largement pour la beat detection (gain vitesse x2)
        y, sr = librosa.load(mp3_path, sr=22050, mono=True)
        if len(y) < sr * 5:
            # moins de 5 s utiles → trop court pour un tempo fiable
            return None
        # librosa.feature.tempo est l'API moderne (remplace beat.tempo deprecated)
        tempo = librosa.feature.tempo(y=y, sr=sr, aggregate=np.median)
        if tempo is None or len(tempo) == 0:
            return None
        return float(round(float(tempo[0]), 1))
    except Exception as e:
        print(f"      librosa fail: {e}", file=sys.stderr)
        return None


def consensus(bpm_signal: float | None, bpm_deezer: float | None) -> dict:
    """
    Décide la valeur BPM à retenir en comparant signal vs Deezer.

    Règles :
    - Si signal absent → bpm_recommended = Deezer (ou None).
    - Si Deezer absent → bpm_recommended = signal.
    - Si les deux présents et proches (±5 %) → les deux d'accord, bpm_recommended = signal.
    - Si Deezer ≈ 2 × signal (±8 %) → half-time détecté, bpm_recommended = signal, flag.
    - Si signal ≈ 2 × Deezer → signal est le double-time (rare), bpm_recommended = Deezer, flag.
    - Si divergence inexpliquée → bpm_recommended = signal (plus fiable statistiquement), flag "mismatch".
    """
    out = {
        "bpm_signal": bpm_signal,
        "bpm_deezer": bpm_deezer,
        "bpm_recommended": None,
        "agreement": None,  # "match" | "half_time" | "double_time" | "mismatch" | "signal_only" | "deezer_only" | "none"
    }
    if bpm_signal is None and bpm_deezer is None:
        out["agreement"] = "none"
        return out
    if bpm_signal is None:
        out["bpm_recommended"] = bpm_deezer
        out["agreement"] = "deezer_only"
        return out
    if bpm_deezer is None:
        out["bpm_recommended"] = bpm_signal
        out["agreement"] = "signal_only"
        return out

    # Les deux présents : compare les ratios
    ratio = bpm_deezer / bpm_signal if bpm_signal > 0 else 0
    if 0.95 <= ratio <= 1.05:
        out["bpm_recommended"] = bpm_signal
        out["agreement"] = "match"
    elif 1.85 <= ratio <= 2.15:
        # Deezer est le double de signal → Deezer a renvoyé le double-time
        out["bpm_recommended"] = bpm_signal
        out["agreement"] = "half_time"  # vrai tempo = signal (plus lent)
    elif 0.45 <= ratio <= 0.55:
        # signal est le double de Deezer (rare, erreur librosa)
        out["bpm_recommended"] = bpm_deezer
        out["agreement"] = "double_time"
    else:
        out["bpm_recommended"] = bpm_signal
        out["agreement"] = "mismatch"
    return out


def process_inbox(inbox_path: str) -> dict:
    with open(inbox_path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    tracks = doc.get("tracks", []) or []
    stats = {"total": len(tracks), "analyzed": 0, "skipped_no_preview": 0, "failed": 0}
    for i, t in enumerate(tracks, 1):
        v = t.get("deezer_verification") or {}
        match = v.get("match") or {}
        preview = match.get("preview")
        bpm_deezer = match.get("bpm")

        label = f"{(t.get('artist') or '?')[:30]} — {(t.get('title') or '?')[:40]}"
        print(f"  [{i:>2}/{len(tracks)}] {label}")

        if not preview:
            stats["skipped_no_preview"] += 1
            print(f"      no preview URL → skip")
            t["bpm_signal_analysis"] = consensus(None, bpm_deezer)
            continue

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            if not throttled_download(preview, tmp_path):
                stats["failed"] += 1
                t["bpm_signal_analysis"] = consensus(None, bpm_deezer)
                continue
            bpm_signal = analyze_bpm(tmp_path)
            if bpm_signal is None:
                stats["failed"] += 1
            else:
                stats["analyzed"] += 1
            res = consensus(bpm_signal, bpm_deezer)
            t["bpm_signal_analysis"] = res
            print(f"      signal={bpm_signal} deezer={bpm_deezer} → {res['agreement']} (recommandé: {res['bpm_recommended']})")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    # Enrichir meta
    doc.setdefault("_meta", {})["bpm_signal_analysis"] = {
        "stats": stats,
        "run_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "method": "librosa.feature.tempo on Deezer 30 s preview",
    }
    with open(inbox_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inbox", required=True, help="Chemin du fichier inbox JSON à enrichir")
    args = ap.parse_args()
    if not os.path.exists(args.inbox):
        print(f"⚠️  inbox {args.inbox} absent — rien à faire (export probablement vide).")
        return 0
    print(f"\n=== BPM SIGNAL ANALYSIS — {args.inbox} ===")
    stats = process_inbox(args.inbox)
    print(f"\n✅ {stats['analyzed']}/{stats['total']} analysées | "
          f"skip (no preview): {stats['skipped_no_preview']} | fail: {stats['failed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
