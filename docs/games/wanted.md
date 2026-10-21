# Wanted! — gameplay loop and 2D clone outline

Wanted! is a spot-the-character game from Super Mario 64 DS and New Super Mario Bros.. The player sees a wanted poster, finds the matching character in a crowded field of portraits, and taps it before time runs out. Correct answers buy more time; mistakes are heavily penalized. The crowd gets progressively harder to search.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



The important design detail: this is one continuous timed run, not a series of independent rounds.

## 1. The complete gameplay loop

[Good memories | Super Mario 64 | Know Your Meme](https://images.openai.com/static-rsc-4/_Q1i_Qm5fwWZA3RHrq1KdDf2wnt6z9d6K0m0N51nDRP2htEbHmKUdSK2NAZTIvJvwUPQutAWfAx0QRnuIvbpcswcdKo0vTZDKJMNGxVw9-Hlnz_OJSj3iZTe_UoIWWXv0FCNJSVwjx8UhZIDN0U98jST40w_gS2TZ-Z-x7F_oeU?purpose=inline)

1\. Show the target

A wanted poster displays one of four characters: Mario, Luigi, Yoshi, or Wario. The single-player game starts with 10 seconds on the clock.

The player must remember the target's appearance and search the crowd for a matching portrait.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



[Find Luigi Nov 29 Answer | Wanted! / Find Luigi (Super Mario 64 DS Minigame) | Know Your Meme](https://images.openai.com/static-rsc-4/V6HA65fCPCXpG1T-piRbwX6NWKK-WE1y2YX2akMTu0FGu79mVKtBZ96DwAlXXsSdIzeAOQM39lfWeuIKNdA2KO81sFvlgW8ZEQYQ7N82ANvHSNoI1MAPxJGCa-5fxA93z20tAuVTtFLHWo1htP8oEpvphBTekAhjZAN9bQCCS0E?purpose=inline)

2\. Search the crowd

Character portraits fill the lower screen. Early challenges are relatively easy; later ones add more portraits, overlap characters, hide faces behind others, and introduce moving groups.

The challenge is rapid visual recognition, not puzzle solving. Distinctive details such as eyes, noses, hats, and chins help distinguish similar faces.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



[Super Mario 64 DS - Wanted](https://images.openai.com/static-rsc-4/R3hI9uqCjTOR5Rvt99MA0dXIRnk6YDP_umyZ0-gfSjTyT0lYtK2RXTKhV6PsNOw76Ml8_2oAEEt3G619FKdYeLlzG_vFgS9WjOQTnq5SsIo6SqLWCuKqglmCqN86CNBeLibOAmamA8Q8Cl2pq2W60u4xTgUFeoXV8w3Tel-EZig?purpose=inline)

3\. Tap a portrait

A correct selection advances to the next target and adds 5 seconds, up to a maximum of 50 seconds.

An incorrect selection removes 10 seconds. With only 10 seconds to start, one mistake can end a run immediately.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



[スーパーマリオブラザーズ35周年 (@supermario35th) on X](https://images.openai.com/static-rsc-4/ID-d700kGcrwKnwlPjqTC_5sV09_ha5ikwHBoY74c4d0SHZvPdvM8iaP1vZXczyuNPVjq7YfeU7FCHV6H4Vs8LxItVN0u8clSqf6r2GMNVoe6Bq7bLktPFWWofK_n_PLbuv5pGgUUw7M1rny-b58yQyLi-cSQkN3v4bXdw4QHjg?purpose=inline)

4\. Increase the difficulty

Every successful find progresses the challenge. The crowd grows, portraits become harder to distinguish, and movement and occlusion make scanning more demanding.

Luigi is the most common target, while Yoshi is the rarest. The tenth level always asks for Luigi.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



[Wanted - Super Mario 64 DS - DS / DSi - The Spriters Resource](https://images.openai.com/static-rsc-4/IaSkW0WstJZj_nxnocVqhCBttwM6_11hlSTxW-jQqt2bJSfPx2BnMNujG4eDcYCBsEqvRwM0yDlC0UkDce66064SxKKfEumHnolbtzB_GIqjhmNE2wDVFq1FEgHDWTViRTplm1LvAn-hIUcRzprHG5Li0ULdKIFKNdphOjIlpS8?purpose=inline)

5\. Run out of time

When the timer reaches zero, the game ends and reveals where the correct character was.

The high score can reach 9,999. At that point, the score and level counter stop increasing, but play continues.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



### Single-player rules at a glance

| Event                  | Effect                          |
| ---------------------- | ------------------------------- |
| Start                  | 10 seconds                      |
| Find correct character | +5 seconds                      |
| Choose wrong character | −10 seconds                     |
| Maximum timer          | 50 seconds                      |
| Target pool            | Mario, Luigi, Yoshi, Wario      |
| End condition          | Timer reaches zero              |
| Difficulty             | Increases with successful finds |

### Differences between the DS versions

The single-player gameplay is essentially identical in both games. One documented difference is that New Super Mario Bros. reuses the same sound for touched characters after turn 10.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



New Super Mario Bros. also has a multiplayer mode. It uses a fixed 30-second timer: each correct answer gives the player one point, each wrong answer subtracts one point, and neither changes the timer. Scores may go below zero. The highest score when time expires wins.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.mariowiki.com\&sz=32)

Super Mario Wiki, the Mario encyclopedia

+1



For the first clone, implement single-player only.

## 2. Rough 2D screen sketch

The original uses two DS screens: the wanted poster on top and the interactive crowd on the bottom. For a desktop or browser clone, combine them into one canvas.

## WANTED!

TIME LEFT

# 08.6

TARGET

[Super Mario: Luigi Laser Die Cut](https://images.openai.com/static-rsc-4/WZlz9TiVLcZHPpg03FFRc_8ITsV4OEGWfrnml4QlG1nj_p25KMC7ZTRUcbsPB1mQdjQZTw9zNOFGv3TJ2y2xyzBEVUEJnXvh_LnW-691x6WD0N7_2QkRaO8WaKTczWegxBeKs0BsYmKNLxP5P5Jr_HKTGE8uNDLJYDPjtvnUW40?purpose=inline)

LUIGI

Find the matching portrait.

LEVEL 4 · 12 FOUND

Correct: +5 sec

Wrong: −10 sec

FIND THE MATCH

### M

### Y

### W

### M

### L

### Y

### W

### M

### L

### Y

### W

### M

### Y

### L

### M

### W

### L

### Y

### M

### W

### Y

### L

### W

### M

### L

### Y

### M

### W

### Y

### L

### W

### M

### L

### Y

### W

### M

Portraits overlap at higher levels.

2D sprite mockup

Conceptual layout. Letters stand in for character portrait sprites, and the highlighted portrait is illustrative rather than a claim about a particular original level.

The poster and timer remain stationary. Most of the screen is devoted to the crowded character field. Avoid adding extra controls: the core interaction is simply clicking the correct portrait.

## 3. Sprite assets

The first version needs very little art:

- Four character portrait sprites: Mario, Luigi, Yoshi, and Wario.
- A wanted-poster frame and target portrait.
- A background for the crowd.
- Optional selection feedback: brief flash, bounce, or outline.
- A timer, level counter, and found-count display.

Use several portrait poses or expressions per character if you want more visual variety. Preserve a consistent silhouette and recognizable facial features so the difficulty comes from crowding rather than arbitrary visual ambiguity.

## 4. Implementation outline

### Data model

```
Character:
    MARIO
    LUIGI
    YOSHI
    WARIO

CrowdSprite:
    character
    position
    size
    velocity
    draw_order
    hitbox

Game:
    state
    target_character
    crowd[]
    elapsed_time
    remaining_time
    level
    score
```

Use a single game timer across the entire run. Each successful find changes the target and crowd but does not reset the clock.

### State machine

\#chatgpt-mermaid-\_r_2b7\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_2b7\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_2b7\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_2b7\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_2b7\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_2b7\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_2b7\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_2b7\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_2b7\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_2b7\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_2b7\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_2b7\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;font-size:16px;}#chatgpt-mermaid-\_r_2b7\_ p{margin:0;}#chatgpt-mermaid-\_r_2b7\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_2b7\_ .label text,#chatgpt-mermaid-\_r_2b7\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ .node rect,#chatgpt-mermaid-\_r_2b7\_ .node circle,#chatgpt-mermaid-\_r_2b7\_ .node ellipse,#chatgpt-mermaid-\_r_2b7\_ .node polygon,#chatgpt-mermaid-\_r_2b7\_ .node path{fill:rgb(51, 24, 37);stroke:rgb(171, 79, 122);stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ .rough-node .label text,#chatgpt-mermaid-\_r_2b7\_ .node .label text,#chatgpt-mermaid-\_r_2b7\_ .image-shape .label,#chatgpt-mermaid-\_r_2b7\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_2b7\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ .rough-node .label,#chatgpt-mermaid-\_r_2b7\_ .node .label,#chatgpt-mermaid-\_r_2b7\_ .image-shape .label,#chatgpt-mermaid-\_r_2b7\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_2b7\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_2b7\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_2b7\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_2b7\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_2b7\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_2b7\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_2b7\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_2b7\_ .labelBkg{background-color:rgba(0, 0, 0, 0.5);}#chatgpt-mermaid-\_r_2b7\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_2b7\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_2b7\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_2b7\_ .icon-shape,#chatgpt-mermaid-\_r_2b7\_ .image-shape{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_2b7\_ .icon-shape p,#chatgpt-mermaid-\_r_2b7\_ .image-shape p{background-color:rgb(0, 0, 0);padding:2px;}#chatgpt-mermaid-\_r_2b7\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_2b7\_ .image-shape .label rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_2b7\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_2b7\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_2b7\_ .node .neo-node{stroke:rgb(171, 79, 122);}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_2b7\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_2b7\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].node .neo-line path{stroke:rgb(171, 79, 122);filter:none;}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_2b7\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_2b7\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_2b7\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_2b7\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_2b7\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(255, 186, 218);}#chatgpt-mermaid-\_r_2b7\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(255, 186, 218);}#chatgpt-mermaid-\_r_2b7\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_2b7\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_2b7\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(41, 16, 28);stroke:rgb(95, 53, 72);stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ .node rect,#chatgpt-mermaid-\_r_2b7\_ .node circle,#chatgpt-mermaid-\_r_2b7\_ .node ellipse,#chatgpt-mermaid-\_r_2b7\_ .node polygon,#chatgpt-mermaid-\_r_2b7\_ .node path{fill:rgb(77, 31, 52);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_2b7\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_2b7\_ .node.mermaid-decision .label-container{fill:rgb(41, 16, 28);stroke:rgb(95, 53, 72);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_2b7\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_2b7\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_2b7\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,Segoe UI,Helvetica,Apple Color Emoji,Arial,sans-serif,Segoe UI Emoji,Segoe UI Symbol;}Start gameSet timer to 10sChoose target and build crowdSearch and move spritesPortrait clicked?Add 5s, cap at 50Increase level and scoreTimer still above zero?Subtract 10sGame over and reveal targetCorrectYesWrongNo

### Difficulty progression

Build difficulty from three independent parameters:

| Parameter  | Easier levels        | Harder levels              |
| ---------- | -------------------- | -------------------------- |
| Crowd size | Few portraits        | Many portraits             |
| Occlusion  | Faces mostly visible | Faces partly covered       |
| Movement   | Static or slow       | Moving, overlapping groups |

Do not increase every parameter simultaneously. The game should remain visually readable even when the player has very little time.

For target selection, use a weighted random choice, with Luigi more common than Yoshi. Make the weighting configurable; the exact original probabilities are not established by the references above. Make level 10 force Luigi to match the documented behavior.

### Input and timing details

- Use the actual rendered position of each sprite to determine its clickable area.
- If portraits overlap, resolve clicks against the topmost visible portrait.
- Update movement using elapsed frame time, not a fixed movement amount per frame.
- Clamp the timer to a maximum of 50 seconds.
- On a correct click, give brief visual feedback, generate the next challenge, and preserve the remaining time.
- On a wrong click, apply the penalty immediately. If time expires, stop accepting input and reveal the target.

## 5. Recommended first milestone

Implement one playable loop with four placeholder portrait sprites, a 10-second timer, the correct-answer bonus, the wrong-answer penalty, and automatic progression. Then add increasing crowd density, overlapping portraits, and movement.

That captures the defining gameplay of Wanted! without needing 3D graphics or complicated systems.
