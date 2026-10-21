# Bloons Tower Defense 4 — gameplay loop and clone outline

Bloons TD 4 is a classic tower-defense game: place monkeys and other defenses beside a winding track, let them automatically attack incoming Bloons, earn money, and reinvest it into a stronger defense before later waves overwhelm you. The central loop combines placement, automatic combat, resource management, and escalating waves.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom

+1



For a 2D-sprite clone, the difficult part isn't drawing the game. It's getting the interactions between the path, Bloon layers, tower targeting, projectiles, upgrades, and round progression right.

## 1. The complete gameplay loop

[풍선 타워 디펜스 4 (Bloons Tower Defense 4) - 플래시게임 | 와플래시 게임 아카이브](https://images.openai.com/static-rsc-4/kwnTazxsp6t7xJqpmSm51kvyNRKS7GmeJwT3gtLdjRC6qQcqGmVEQ_hTNWVNsweNfrMESz7pTdUMRPEi1vhL6whrN18CD3NOelGYILCaHCuDeS6ohpNQJ8f0SI3eeOF_7Tud4AiZfsXEh_FGw4dPMjmH4EU6xaGXJuHPv9Ivgog?purpose=inline)

1\. Choose a map and difficulty

Select a track and Easy, Medium, or Hard difficulty. Each has a defined number of rounds, starting lives, prices, and Bloon speeds.

| Difficulty | Starting lives | Required rounds |
| ---------- | -------------- | --------------- |
| Easy       | 200            | 50              |
| Medium     | 150            | 60              |
| Hard       | 100            | 75              |

The standard game starts with $650. Easy makes defenses cheaper; Hard makes them more expensive and the Bloons faster.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://flashgaming.fandom.com\&sz=32)

Fandom

+1



[Bloons Tower Defense 4 Online](https://images.openai.com/static-rsc-4/vMWjtV5giam-0LG0k4HV6GXu5_lcylC6QIUhtXb-bpayIELdNBI2rc1evPkxTV24PmOINjj9ohdDh_GuNL-xA57tUNJD3PIHCZkl7MCgjGPkcORdEhE3OyfksdbyBeKUBC7hl_m0osPwlyn2Wc_Ml6eZ1OlVSAQyX6_vqZK2IpA?purpose=inline)

2\. Build your initial defense

Spend starting cash on towers placed in valid positions around the track. Each tower has its own purchase price, range, attack speed, and attack type.

Placement matters: a tower covering a long stretch of track can attack Bloons for longer, while clustered towers can concentrate fire on difficult sections.

[Bloons tower 4 pics  image - ModDB](https://images.openai.com/static-rsc-4/c6L31ja1bNTubEWlGnUxYR2SZGtk24V5Ku4ksBHQHxDXFAaICmKMew4w4q0nDU-FysWdtpMvfKWtWY1OZdmonIXywgBKDBoKj23nkTP7b8HXXC7UF8zNdbZtImBJYNcDgY5h3akdj_los-5tTXM0n8bDqIqAJLSswfcvJs0H_Mo?purpose=inline)

3\. Start a round and defend automatically

Press the round-start button. Bloons spawn at the entrance and follow the track to the exit. Towers automatically select targets in range and fire.

Each successful attack removes one or more layers according to the projectile's damage and pierce. Popping Bloons earns money; allowing them to escape costs lives.

[Bloons Tower Defense 4 Online](https://images.openai.com/static-rsc-4/c6yVE9DBE5z91VNMcLhrue4N7MKw0MZAdxRoWY_OHjzoOk7pzw3hzw47hLx03qfPzlBU0mSNtdy_H-Ub3jp2nUfowZDwnb5ujVQBNYcplqQY4brLoFhNdh0Ee0z6QruTNFR4p3BaTY--2eEuGUAdVQ6LhAM5J_uZN4u-erFBAC8?purpose=inline)

4\. Spend money and upgrade towers

During and between rounds, buy more defenses or upgrade existing ones. BTD4's standard towers have a linear sequence of four upgrades, with each successive upgrade improving the tower or adding a new capability.

You must balance immediate survival against expensive upgrades and economic investments. Buying a Banana Farm, for example, costs money now but generates extra income at the end of every round.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom

+1



[Bloons Tower Defense 4 Online](https://images.openai.com/static-rsc-4/-8V8hxEQEXGIlyxgwqvUZQK-f9QLn9J8QybmV_WCijxwM_jVZhI9pwKWIWCEuki4EkcpOl3vNul-uaYXZLJSAEicFWIrPUJQCCTh6ICmdjTwBWajQAvuyU2MMySZmKARcMgx4AwvPn4vObArAptaJQQppVyPjhbftAecm_m5UYQ?purpose=inline)

5\. Counter increasingly dangerous Bloons

Later waves introduce faster, tougher, and specialized Bloons. Some require different damage types or detection capabilities; some contain many weaker Bloons inside them.

Your early defenses may work well against ordinary Bloons but fail against lead, camo, ceramic, or MOAB-class threats. The player must adapt the tower mix, not merely build more of the same tower.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom

+1



[Bloons Tower Defence 4 - Jeu Gratuit en Ligne | FunnyGames](https://images.openai.com/static-rsc-4/8DAYzVqFCgaFikxls6cYSK0SJl5vB6pwhm_kI1bT-yaUja6T6rgya2ZNKkLuEUKgvJCXSVWCXmVeMAcmxsymgke1GIAW4XdeF3A-Duz_fEJBBGAvo2pFPcDIrGiwuPMEcqOIHGNpks8Z7LH9aeQSFGdS6BWx0Mh-2oIuc40RGtg?purpose=inline)

6\. Finish the track or lose

Clear the required final round to win the selected difficulty. If lives reach zero, the game ends. After completing the standard rounds, the game can offer continued Free Play, where you see how much longer your defense survives.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://flashgaming.fandom.com\&sz=32)

Fandom

+1



The loop repeats at two different time scales: inside a round, towers fight automatically; between rounds, the player makes strategic decisions. Good pacing gives the player enough time to react and reinvest without making every round a menu-management exercise.

## 2. Rough 2D screen sketch

For a desktop/browser clone, use a single landscape screen with a central map, a tower-selection sidebar, and a compact HUD. The game board should occupy most of the screen.

## BLOONS TD

CASH $340

LIVES 150

ROUND 12

TOWERS

#### D

Dart

$200

#### T

Tack

$360

#### B

Bomb

$650

#### I

Ice

$385

#### G

Glue

$300

Select, then place

SELECTED TOWER

Dart Monkey · Upgrade

#### START ROUND

Conceptual layout. Colored circles represent Bloons and towers; translucent circles illustrate tower range, not exact original-game statistics.

### Required sprite assets

Start with:

- One map background and a path definition for each track.
- Sprites for Bloon colors and special types.
- A small selection of tower sprites.
- Tower attack/projectile sprites and pop effects.
- Upgrade icons, money/lives/round HUD elements, and buttons.

The map itself can be a static image. The path should be stored separately as geometry, so Bloons can follow it and towers can measure their distance from it.

## 3. Bloon and tower mechanics

### Bloons have layers, not just hit points

A blue Bloon, for example, pops down into a red Bloon. The red Bloon then disappears when its final layer is popped. Stronger Bloons can contain multiple layers or spawn children when destroyed.

| Type                  | Special consideration                                   |
| --------------------- | ------------------------------------------------------- |
| Red through Pink      | Basic Bloons, with increasing speed and layers          |
| Black / White / Zebra | Different explosive and freezing resistances            |
| Lead                  | Ordinary sharp projectiles cannot pop it                |
| Camo                  | Requires suitable detection to target                   |
| Ceramic               | Tough shell with Rainbow Bloons inside                  |
| MOAB / BFB            | Large blimps with high durability and multiple children |

These types appear in BTD4, with their own defensive requirements.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom

+1



Represent each Bloon with its current layer, speed, special properties, and progress along the track. Popping a layer should either reveal the next layer or generate the appropriate children.

### Towers have range, damage and attack behavior

A tower needs a small but consistent set of properties:

```
Tower:
    type
    position
    range
    attack_cooldown
    damage
    pierce
    target_priority
    upgrade_level
```

The main targeting priorities in BTD4 are First, Last, Weak, and Strong. They affect which eligible Bloon a tower chooses to attack.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom



A single generic tower can establish the system, but distinct tower behaviors are essential to the strategy: Dart Monkeys fire individual projectiles, Tack Shooters attack in multiple directions, Bomb Towers deal explosive damage, Ice Towers freeze, and Glue Gunners slow Bloons.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom

+1



### Upgrades and economy

Each standard tower has four sequential upgrades. Buying an upgrade deducts money and changes its statistics, attack, or abilities. Tower unlocks and stronger upgrades are also tied to the game's career rank; for a small clone, you can initially make a limited selection available from the start.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom

+1



Money comes from popping Bloon layers. Banana Farms provide additional money at the end of rounds, making them an investment in future defenses rather than a direct attacker.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://en.wikipedia.org\&sz=32)

Wikipedia

+1



## 4. Implementation outline

Keep the simulation and rendering separate. The game should continue to behave correctly regardless of frame rate or sprite animation timing.

### Core data structures

```
Game:
    money
    lives
    round
    difficulty
    state
    selected_tower_type
    towers[]
    bloons[]
    projectiles[]
    current_wave_queue

Tower:
    type
    position
    upgrade_level
    attack_timer
    target_priority

Bloon:
    type
    layer
    path_distance
    speed
    properties

Wave:
    ordered_spawn_groups[]
```

Use a track represented by a polyline or a list of path segments. Each Bloon advances by distance along the path; its rendered position is calculated from that distance. This handles winding tracks without hardcoding different movement logic for every map.

### State machine

\#chatgpt-mermaid-\_r_v0\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_v0\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_v0\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_v0\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_v0\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_v0\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_v0\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_v0\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_v0\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_v0\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_v0\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_v0\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;font-size:16px;}#chatgpt-mermaid-\_r_v0\_ p{margin:0;}#chatgpt-mermaid-\_r_v0\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_v0\_ .label text,#chatgpt-mermaid-\_r_v0\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ .node rect,#chatgpt-mermaid-\_r_v0\_ .node circle,#chatgpt-mermaid-\_r_v0\_ .node ellipse,#chatgpt-mermaid-\_r_v0\_ .node polygon,#chatgpt-mermaid-\_r_v0\_ .node path{fill:rgb(51, 24, 37);stroke:rgb(171, 79, 122);stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ .rough-node .label text,#chatgpt-mermaid-\_r_v0\_ .node .label text,#chatgpt-mermaid-\_r_v0\_ .image-shape .label,#chatgpt-mermaid-\_r_v0\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_v0\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ .rough-node .label,#chatgpt-mermaid-\_r_v0\_ .node .label,#chatgpt-mermaid-\_r_v0\_ .image-shape .label,#chatgpt-mermaid-\_r_v0\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_v0\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_v0\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_v0\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_v0\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_v0\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_v0\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_v0\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_v0\_ .labelBkg{background-color:rgba(0, 0, 0, 0.5);}#chatgpt-mermaid-\_r_v0\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_v0\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_v0\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_v0\_ .icon-shape,#chatgpt-mermaid-\_r_v0\_ .image-shape{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_v0\_ .icon-shape p,#chatgpt-mermaid-\_r_v0\_ .image-shape p{background-color:rgb(0, 0, 0);padding:2px;}#chatgpt-mermaid-\_r_v0\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_v0\_ .image-shape .label rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_v0\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_v0\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_v0\_ .node .neo-node{stroke:rgb(171, 79, 122);}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_v0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_v0\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].node .neo-line path{stroke:rgb(171, 79, 122);filter:none;}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_v0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_v0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_v0\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_v0\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_v0\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(255, 186, 218);}#chatgpt-mermaid-\_r_v0\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(255, 186, 218);}#chatgpt-mermaid-\_r_v0\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_v0\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_v0\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(41, 16, 28);stroke:rgb(95, 53, 72);stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ .node rect,#chatgpt-mermaid-\_r_v0\_ .node circle,#chatgpt-mermaid-\_r_v0\_ .node ellipse,#chatgpt-mermaid-\_r_v0\_ .node polygon,#chatgpt-mermaid-\_r_v0\_ .node path{fill:rgb(77, 31, 52);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_v0\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_v0\_ .node.mermaid-decision .label-container{fill:rgb(41, 16, 28);stroke:rgb(95, 53, 72);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_v0\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_v0\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_v0\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;}Select map and difficultyInitialize cash, lives and roundPlace or upgrade towersStart roundSpawn and move BloonsAcquire targets and attackPop layers, spawn children,award cashBloons remain?Resolve round-end incomeLives exhausted?Game overFinal round cleared?Victory / Free PlayYesNoYesNoYesNo

### Build it in this order

1. Path and Bloon movement. Get Bloons moving along one track and leaking at the exit.
2. One working tower. Add range checks, automatic target selection, projectiles, collision, layer popping, and cash rewards.
3. Round progression. Add predefined spawn groups, start/complete conditions, and lives.
4. Upgrades and more towers. Add a few contrasting attack types, then sequential upgrades and a tower-selection UI.
5. Difficulty and progression. Add more Bloon types, tower unlocks, money balancing, and multiple maps.

## 5. What to leave out initially

BTD4 also has Apopalypse, which removes pauses between rounds, and Sandbox, which lets players spawn chosen Bloons. These are separate modes, so they do not need to exist in the first playable build.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://bloons.fandom.com\&sz=32)

Fandom

+1



The first milestone should be one track, one tower, a few Bloon types, and about ten rounds. Once movement, popping, targeting, and cash accounting are reliable, the rest of the game becomes a matter of adding content and balancing it rather than rewriting the simulation.
