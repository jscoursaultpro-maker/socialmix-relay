# AGIR approved illustration atlas

`agir-approved-artwork-atlas.png` is the user-provided approved mockup (853 × 1844 pixels). It is reused as artwork rather than regenerated so the vinyl, neon heart, camera, bokeh and waveform retain the approved appearance.

The four landing buttons display only these 391 × 372 illustration windows:

| Action | x | y |
| --- | ---: | ---: |
| On met quoi ? | 25 | 520 |
| Booster | 442 | 520 |
| Partager | 25 | 1056 |
| Tendance | 442 | 1056 |

CSS background sizing and positioning map each window onto a decorative `.v2-action-art` span. The bottom edge fades into the card background. No text or navigation from the mockup is displayed. Button labels remain HTML, and their existing click handlers are preserved. The focused subviews use lightweight SVG icons instead of the large artwork.

The atlas is intentional: a single network request supplies all four exact illustrations. It can later be losslessly cropped into independent optimized files without changing visual composition.
