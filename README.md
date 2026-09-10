# AERIS

Mini simulateur de vol photoréaliste dans le navigateur. Deux appareils — un Cessna 172
et un MiG-29 — un archipel d'environ 10 km², une piste : décoller, voler, se poser.

![AERIS](docs/hero.jpg)

## Lancer

```bash
npm install
npm run dev
```

Puis ouvrir <http://localhost:5173>. Pour un build de production :

```bash
npm run build && npm run preview
```

Le premier chargement génère le relief et lance la passe d'érosion (environ deux
secondes), puis télécharge les textures. Les suivants sont servis par le cache.

## Commandes

Un écran de choix s'affiche avant le vol. `?aircraft=mig29` le contourne.

| Action | Clavier / souris | Manette |
|---|---|---|
| Tangage (cabrer / piquer) | ↓ / ↑, ou souris après un clic droit | Stick gauche |
| Roulis | ← / → | Stick gauche |
| Lacet (palonnier) | Q / E | LB / RB |
| Gaz | Maj (plus) / Ctrl (moins) | RT / LT |
| Aérofreins · freins de roue | B | X |
| Volets | V (sortir) / F (rentrer) | Croix haut / bas |
| Train d'atterrissage | G | L3 |
| Trim | Pg↑ / Pg↓, Retour arrière pour remettre à zéro | — |
| Changer de caméra | C | Y |
| Regard libre | Clic droit maintenu + souris | Stick droit |
| Zoom | Z | — |
| **Canon** | Espace, ou clic gauche souris capturée | A |
| **Tirer l'arme sélectionnée** | Entrée | B |
| **Changer d'arme** | Tab | Croix gauche / droite |
| **Verrouiller une cible** | T, ou clic molette | R3 |
| **Leurres** | X | — |
| Aide | H ou Échap | Back |
| Pause | P | — |
| Heure du jour | Curseur en bas, ou [ et ] | — |
| Remettre sur la piste | R | Start |
| Capture d'écran | F2 | — |
| Plein écran | F11 | — |
| Masquer l'interface | I | — |
| Couper le son | M | — |

Le panneau d'aide (**H**) liste tout cela, s'adapte à la manette si elle est branchée,
et allume les touches réellement pressées : on peut essayer une commande sans le
fermer. Il s'ouvre tout seul au premier lancement, puis plus jamais.

Le son démarre au premier clic ou à la première touche, comme l'exige le navigateur.
Le freinage est passé sur **B** : sur un avion de combat, la barre d'espace est la
détente. Sur le MiG, le même levier sort l'aérofrein en vol et freine les roues au sol,
comme sur l'appareil réel.

## Les deux appareils

Ils ne se pilotent pas du tout pareil, et c'est voulu.

Le **Cessna** pèse une tonne, décolle à 55 kt, monte à 900 ft/min et se stabilise tout
seul dès qu'on lâche le manche. Il pardonne : la protection d'incidence retire
progressivement de l'autorité à cabrer près du décrochage, si bien qu'un manche tiré à
fond donne un enfoncement et non un départ en vrille.

Le **MiG-29** pèse quatorze tonnes et sort 163 kN avec les deux réchauffes allumées. La
poussée est là mais les réacteurs mettent deux secondes et demie à monter en régime,
donc il se pilote en anticipant. Il roule à 60°/s, encaisse 9 g, et l'aile continue de
porter bien au-delà de l'incidence où le Cessna aurait renoncé. En contrepartie
l'inertie est écrasante : un renversement se prépare, il ne s'improvise pas. La
stabilisation automatique est presque absente. Poussée maximale, la post-combustion
s'allume dans le dernier cran de manette, le champ de vision s'ouvre, la flamme éclaire
le fuselage et l'air derrière les tuyères se met à onduler. Au-delà de 4 g le voile gris
commence à fermer la vision périphérique.

## Repères de pilotage

L'avion est posé au seuil de piste, volets rentrés. Plein gaz, laisser accélérer,
tirer vers 55 kt, tenir 8° de cabré : il monte à 80 kt et 900 ft/min. En finale,
volets sortis, 60 kt, arrondir juste avant le contact.

Le manche au neutre stabilise doucement l'assiette et remet les ailes à plat. La
protection d'incidence retire progressivement de l'autorité à cabrer près du décrochage,
donc un manche tiré à fond mène à un enfoncement, pas à un départ en vrille.

## Arborescence

```
src/
  core/       Noise (simplex, fBm, ridged) · Input clavier/souris/manette · Engine (rendu, CSM)
  world/      Heightfield · Erosion hydraulique · Terrain (chunks LOD) · Vegetation · Foliage · Runway
  water/      Ocean (Gerstner, écume, profondeur)
  sky/        Atmosphere (Rayleigh/Mie) · AerialPerspective · Environment (IBL dynamique) · CloudNoise
  aircraft/   AircraftConfig (tout ce qui distingue les deux appareils) · FlightModel
              Aircraft (animation des gouvernes, du train, des tuyères) · Cameras
              Livery (peintures procédurales : Cessna, camouflage MiG, métal thermique, verrières)
              Instruments · InstrumentsSoviet (cadrans cyrilliques) · HeadUpDisplay
  combat/     Armament (catalogue, pylônes, emports) · StoreRack (emports visibles)
              Ordnance (obus, missiles, roquettes, bombes) · Targeting (réticule, verrouillage)
              Effects (fumée, étincelles, traçantes, explosions, débris) · Targets · Enemy
  fx/         Pipeline (post-traitement complet) · Particles · Afterburner · JetEffects
  audio/      Audio (piston ou turbine, vent, Doppler, réverbération, bang supersonique)
  ui/         HUD · CombatHud (réticule, verrouillage, alerte) · HelpPanel (commandes)
              TimeSlider · Selection (choix de l'appareil) · LoadoutScreen (emport)
  shaders/    atmosphere · sky · terrain · ocean · clouds · post
tools/        fetch-assets.py (télécharge et empaquette) · shrink-glb.py · blender_rpc.py
              vite-screenshot-plugin.ts (capture de référence, serveur de dev uniquement)
blender/      Scripts de modélisation du Cessna, pilotés via le serveur MCP de Blender
blender/mig/  Idem pour le MiG-29
blender/weapons/  Les dix emports, exportés en un seul stores.glb
blender/targets/  Camions, blindés, radar, cuves, patrouilleur, hangar, tour
public/       Textures CC0, HDRI, cessna.glb
```

## Ce qui tourne sous le capot

**Terrain.** Un champ de hauteurs de 1024² est généré à partir de masques d'îles
déformés, de massifs à basse fréquence et de bruit ridgé, puis érodé par 156 000
gouttes d'eau (modèle de Beyer). C'est l'érosion qui donne les vallées, les lignes de
crête et les cônes de déjection ; sans elle le bruit seul reste une hérissure. Le rendu
est découpé en tuiles à cinq niveaux de détail, dont les bords sont calés sur une grille
commune : les fissures entre niveaux disparaissent sans jupe.

**Matière.** Cinq jeux PBR (sable, herbe, forêt, éboulis, paroi) mélangés par altitude,
pente et bruit macro, la paroi en triplanaire. Chaque jeu est échantillonné deux fois
avec des rotations différentes et mélangé par un bruit lent : la grille de répétition
disparaît sans le coût d'un pavage stochastique.

**Ciel.** Diffusion de Rayleigh et Mie intégrée par raymarching sur le dôme, avec un
terme de diffusion multiple qui blanchit l'horizon au lieu de le laisser virer au jaune.
Pour les surfaces, la même physique est intégrée analytiquement : c'est vingt fois moins
cher et indiscernable jusqu'à une vingtaine de kilomètres.

**Nuages.** Couche volumétrique traversable, raymarchée à la demi-résolution contre le
tampon de profondeur, avec du bruit Perlin-Worley 3D, une carte météo, un éclairage de
Beer-Powder et des rayons crépusculaires lorsqu'on les perce. Le pas de marche croît
géométriquement le long du rayon : les nuages proches, où l'œil lit la forme, sont
échantillonnés tous les trente mètres, et les échantillons grossiers sont dépensés au
loin où la perspective aérienne a déjà tout lavé. À pas constant il aurait fallu 270 m
pour atteindre l'horizon, soit un pas plus large que les cumulus eux-mêmes, et le bruit
de décorrélation censé masquer ça ressortait en damier sur toute la couche.

**Océan.** Six vagues de Gerstner en espace monde, normales de détail défilantes, écume
de crête et de rivage calculée depuis la profondeur d'eau, courbure terrestre pour que
la mer épouse l'horizon de l'atmosphère.

**Avion.** La cellule vient de Blender via son serveur MCP. La peinture, elle, est
procédurale et évaluée dans le repère de l'avion : bandes, immatriculation, lignes de
tôle, rivets, traînées d'échappement, crasse de ventre et usure de bord d'attaque, sans
couture d'UV ni limite de résolution. Le tableau de bord est redessiné en direct depuis
l'état de vol : les six instruments de base fonctionnent réellement.

**Vol.** Modèle six degrés de liberté en coefficients aérodynamiques classiques, piloté
par une configuration par appareil : masse, inerties, portance, traînée d'onde
transsonique, autorité des gouvernes, poussée et train rentrant. Atmosphère standard, si
bien que la densité et la vitesse du son varient avec l'altitude — ce qui donne au
chasseur sa perte de poussée en montée et son nombre de Mach. Décrochage progressif,
effet dièdre, lacet inverse, souffle hélicoïdal pour l'hélice. Une stabilisation douce
n'agit que manche au neutre, et beaucoup moins sur le chasseur.

**Effets du chasseur.** La post-combustion est dessinée en trois temps : la flamme
elle-même, avec son cœur bleu-blanc et les disques de choc régulièrement espacés ; la
lumière qu'elle projette sur la cellule et sur la piste ; et l'air qu'elle chauffe, rendu
dans un tampon dédié que la passe de composition lit comme un décalage en espace écran.
S'y ajoutent le cône de vapeur transsonique, la nappe de condensation sur l'extrados à
forte charge, les vortex de bout d'aile, les traînées de condensation en altitude et le
bang supersonique au franchissement.

**Image.** Exposition automatique pondérée au centre, ACES, occlusion ambiante en espace
écran, bloom sélectif, flou de mouvement par reprojection, profondeur de champ en
cockpit, halo d'objectif sobre, grain et vignettage. La résolution interne s'ajuste
toute seule pour tenir la cadence.

## Armement

Le Cessna reste désarmé. Le MiG-29 emporte ce que porte réellement un 9.13.

Un **écran d'emport** s'ouvre avant le vol. La silhouette n'est pas un dessin : c'est
l'avion lui-même vu de dessus, avec les vrais emports sous les vraies ailes. On glisse
une arme sur un pylône, ou on clique un des trois presets. `?aircraft=mig29` saute
l'écran et décolle avec l'emport mixte.

| Arme | Code OTAN | Rôle | Stations |
|---|---|---|---|
| GSh-30-1 | — | Canon 30 mm, 150 obus, 1500 c/min, emplanture gauche | fixe |
| R-73 | AA-11 Archer | Air-air courte portée, infrarouge, fort dépointage | 1 · 2 · 3 |
| R-27R | AA-10 Alamo | Air-air moyenne portée, guidage radar | 2 · 3 |
| R-60M | AA-8 Aphid | Air-air courte portée, léger | 1 · 2 · 3 |
| B-8M1 | 20 × S-8 | Panier de roquettes 80 mm, salve | 2 · 3 |
| UB-32 | 32 × S-5 | Panier de roquettes 57 mm | 2 · 3 |
| S-24B | — | Roquette lourde 240 mm, à l'unité | 2 · 3 |
| FAB-250 / FAB-500 | — | Bombes lisses | 2 · 3 / 3 |
| KMGU-2 | — | Distributeur de sous-munitions | 3 |

Les emports pèsent et traînent. Un MiG chargé au maximum embarque près de deux tonnes
sous les ailes et se pilote comme tel ; le même appareil après une passe est
sensiblement plus vif, et c'est la moitié de la récompense.

Cent cinquante obus font six secondes de détente pour toute la sortie : chaque rafale
compte, ce qui est exactement la contrainte que le vrai canon impose.

## Viser

Le réticule canon n'est pas une croix peinte sur la glace. C'est le point où les obus
tirés maintenant seront dans une seconde, chute et traînée comprises, calculé en
intégrant un obus virtuel contre le relief et contre les cibles. Il est juste : si le
réticule est sur le camion, la rafale touche le camion.

Le verrouillage (T ou clic molette) parcourt ce qui est devant le nez et se referme sur
une cible ; le cadre rétrécit à mesure que l'autodirecteur s'installe et le grondement
infrarouge monte en hauteur et en cadence avec la qualité de l'accroche. En dessous
d'un verrouillage solide, le missile part tout droit — ce qui est le résultat honnête.

Les chasseurs adverses larguent des leurres quand un missile les poursuit, et un leurre
fonctionne parce qu'il est ce que l'autodirecteur préfère, pas par magie. Quand l'un
d'eux tire, une voix russe synthétique annonce le départ et un liseré rouge indique la
direction.

## Cibles

Cinq installations, placées par recherche de terrain plat plutôt qu'à des coordonnées
écrites en dur — le relief est généré, une coordonnée fixe finit un jour dans la mer.

- **Convoi** : camions et transports de troupes en colonne.
- **Site radar** : cabine, antenne qui tourne à six tours par minute, deux camions.
- **Dépôt de carburant** : cinq cuves. La première qui saute emmène les autres une
  seconde plus tard, ce qui transforme cinq cibles en un événement.
- **Port** : trois patrouilleurs au mouillage dans une baie.
- **Terrain adverse** : tarmac, hangars, tour de contrôle, MiG gris au parking.

Chaque épave reste sur place, noircie, affaissée, et brûle une bonne minute avec une
colonne de fumée noire visible de plusieurs kilomètres.

Trois chasseurs adverses patrouillent, en gris uni sans marquages. Leur pilotage est
volontairement simple et volontairement lisible : croisière, virage, dégagement en
montée, et break avec leurres. Un adversaire dont on devine le prochain mouvement une
seconde à l'avance est bien plus amusant à poursuivre qu'un adversaire savant.

## Les effets

**Canon.** Chaque obus est un vrai projectile : dispersion en cône, chute, une traçante
sur cinq. Les traçantes ont un plancher de largeur en pixels, parce qu'un obus de trente
millimètres à un kilomètre couvre un quart de pixel et n'apparaîtrait jamais autrement —
les vraies traçantes se voient parce qu'elles sont petites et violemment lumineuses, ce
qu'un moteur ne peut reproduire qu'en leur donnant un plancher à l'écran. Le recul
freine réellement l'avion et secoue la cellule ; les douilles tombent et rebondissent.

**Missiles.** L'arme se détache, chute une fraction de seconde, puis le moteur s'allume :
c'est cette demi-seconde qui rend un tir lisible. Le guidage est une navigation
proportionnelle — la même que celle des vrais autodirecteurs — qui produit la courbe
d'interception, et les gouvernes suivent la commande. La fumée est posée au mètre
parcouru le long du trajet et non à la frame : à trois cents mètres par seconde, une
bouffée par image laisse cinq mètres de vide et se lit comme un chapelet de boules.

**Salve.** Les roquettes partent décalées de cinquante-cinq millisecondes, en éventail,
et la fumée d'allumage engloutit l'avion pendant une seconde.

**Explosions.** En couches, dans l'ordre où l'œil les lit : le flash, la boule de feu
qui bout, l'onde de choc, la distorsion de chaleur écrite dans le même tampon que celle
des tuyères, les débris projetés, et la colonne qui reste. Le son arrive séparément :
il est programmé avec le temps de trajet réel, si bien qu'une cuve qui saute à deux
kilomètres éclaire d'abord et arrive six secondes plus tard. C'est le détail le plus
convaincant de tout le mixage.


## Images

![Post-combustion](docs/11-mig-postcombustion.jpg)
*MiG-29 plein réchauffe au-dessus de l'archipel, caméra cinématique.*

![MiG-29 au sol](docs/12-mig-exterieur.jpg)
*Livrée camouflage bicolore, étoiles rouges, numéro de bord 042, train sorti.*

![Cockpit MiG](docs/10-mig-cockpit.jpg)
*Planche de bord soviétique, cadrans cyrilliques, collimateur tête haute.*

![Cessna sur la piste](docs/05-piste.jpg)
*Cessna 172 au seuil de piste, lumière du matin.*

![Dépôt en feu](docs/23-depot.jpg)
*Dépôt de carburant après la passe : cuves noircies, colonnes de fumée, débris.*

![Passe canon](docs/22-canon-impacts.jpg)
*Passe canon sur le convoi, emport mixte sous les ailes.*

## Limites connues

- L'intérieur du cockpit du MiG est le point faible du projet : la géométrie est
  correcte et les instruments fonctionnent, mais la matière et les détails de cabine ne
  sont pas au niveau du reste. La symbologie du collimateur est lisible mais mal centrée
  sur la glace.
- Les vortex de bout d'aile sont rendus en sprites ; ils se lisent comme un filet de
  vapeur, pas encore comme le cordon torsadé du phénomène réel. Un ruban géométrique
  suivant la trajectoire du saumon serait la bonne primitive.
- Les cadences en images par seconde n'ont jamais été mesurées dans un onglet visible,
  seulement par requêtes de temps GPU : les chiffres relatifs entre passes sont fiables,
  la valeur absolue ne l'est pas.
- Les véhicules et les bâtiments sont construits pour la silhouette, à la distance d'une
  passe de mitraillage. De près, ils ne tiennent pas la comparaison avec la cellule.
- Les chasseurs adverses ne se servent que du missile. Ils n'ont pas de canon, et ils ne
  cherchent jamais à se placer derrière : ils fuient, virent et se défendent.


## Assets

Textures et HDRI : [Poly Haven](https://polyhaven.com), licence CC0. `tools/fetch-assets.py`
télécharge uniquement ce qui sert et empaquette les jeux du terrain deux fichiers par
couche (albédo × occlusion, normale + rugosité dans l'alpha), ce qui tient sous la limite
de 16 échantillonneurs du GPU. La cellule de l'avion est modélisée pour ce projet ;
`tools/shrink-glb.py` recompresse les textures embarquées dans le glTF.

Le dossier `blender/` ne garde que les scripts de modélisation. Le `.blend`, le cache de
bake et les rendus de référence en sont dérivés et restent hors du dépôt.
