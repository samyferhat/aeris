# AERIS — mini simulateur de vol photoréaliste (Three.js / WebGL2)

Vol libre au-dessus d'un archipel de ~10 km² : décollage, vol, atterrissage.
Un seul avion (monomoteur type Cessna 172), trois caméras, un curseur heure-du-jour.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # build de production dans dist/
```

## Commandes

| Action                 | Clavier / souris                 | Manette (Xbox / PS)          |
|------------------------|----------------------------------|------------------------------|
| Tangage / roulis       | ↑ ↓ ← → ou souris (maintenir clic droit) | Stick gauche         |
| Lacet (palonnier)      | Q / E (A / E en AZERTY = Q / E physiques) | Gâchettes LT / RT  |
| Gaz                    | Shift / Ctrl (ou molette)        | Stick droit ↑ ↓ (ou B/A)    |
| Volets                 | F (rentrer) / V (sortir)         | D-pad ↑ ↓                    |
| Freins                 | Espace                           | X / Carré                    |
| Caméra suivante        | C                                | Y / Triangle                 |
| Caméra libre : orbite  | Souris (clic gauche) + molette   | Stick droit                  |
| Heure du jour          | Curseur en bas de l'écran, ou [ ]| LB / RB                      |
| Réinitialiser sur piste| R                                | Start                        |
| Pause                  | P / Échap                        | Select                       |

## Stack

- Vite + TypeScript, Three.js r186
- Rendu : PBR complet, IBL dynamique (ciel procédural Rayleigh/Mie + HDRI réel de nuit), ACES filmique,
  cascaded shadow maps, nuages volumétriques raymarchés, océan Gerstner avec écume et réfraction,
  post-processing (GTAO, bloom, DoF cockpit, motion blur, lens flare, grain, TAA/FXAA)
- Assets : textures CC0 Poly Haven (téléchargées par `tools/fetch-assets.py`),
  avion modélisé dans Blender via blender-mcp (`blender/`), exporté en GLB.
