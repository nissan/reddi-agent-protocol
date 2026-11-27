# Image prompts for the marketing versions of these diagrams

These prompts turn the Mermaid diagrams on the other pages into collateral art: slides, the article (Choose, Pay,
Verify), social cards and video backdrops. They follow the site's image rules
([`apps/marketing/docs/IMAGE_PROMPTS.md`](../../apps/marketing/docs/IMAGE_PROMPTS.md)) and its palette
(`apps/marketing/app/globals.css`):

1. **No text in the image.** Image models garble labels, and words belong in the page where they can be read aloud and
   translated. Each prompt asks for blank label plates; the labels are set over the art afterwards (SVG or HTML), from
   the Mermaid source, so the marketing version can never say something the diagram does not.
2. **An image shows an idea, never a result.** Nothing may suggest a product state the status page does not list
   (no "live on mainnet" before it is).
3. **Never edit a prompt that has been run.** Add the next version and leave the old one.
4. **Log every run** below: day, provider, model, file, score (1 to 5, the lowest of palette, subject, no text, holds up
   at size) and notes.
5. **Programmatic first.** Our own CSS/JS versions come first; a paid run (OpenAI Images, Nano Banana) only after the
   owner has seen these prompts and said go. rtwin1 (`z-image-turbo`, free) may be used for drafts once the owner OKs
   the job list.

The text sent to a provider is always the style block, then the subject, then the size.

## Style block `diagram-v1`

> Flat editorial technical illustration, like a page from a well-made printed field guide. Palette only: paper #f4f0e6
> background, card #fffdf7 for panels, ink #14161a for outlines, violet #6a35d9 as the single strong accent (used only
> for the on-chain program), mint #14f195 for small highlights where money moves, green #0b7a4b sparingly for things
> that are working, amber #f2b53c only for things still being built, drawn with dashed outlines. Thick, even ink
> outlines, simple geometric shapes, flat front view, generous empty space, consistent line weight across the whole
> image. No gradients, no glow, no 3D rendering, no isometric perspective, no photorealism. No text, letters, numbers,
> logos or brand marks anywhere in the image; where a label belongs, leave a blank rounded plate in card colour with an
> ink outline. No people's faces. No coins, coin stacks, rising charts or other symbols of financial gain; money is a
> small plain mint disc.

## Style block `diagram-night-v1` (dark slides and video)

> The same as `diagram-v1`, on a night #101216 background with panels in #181b21, outlines in #ece9df, violet #b49cff
> as the single strong accent, mint #14f195 for money. Everything else unchanged.

## Style block `diagram-v2`

Added after the v1 drafts (26 November 2026) printed words, drew coin stacks and overused violet. It is `diagram-v1`
with these sentences added at the end:

> Absolutely no writing of any kind: no words, letters, numerals, captions, signage or symbols that look like text,
> even on plates, screens or labels. Money is only ever a single flat mint disc the size of a button; never draw coins,
> coin stacks, piles, bags, banknotes or currency signs. Label plates are always plain card colour with an ink outline,
> never filled with violet, amber or any other colour. Violet is only for the on-chain program and its small seals,
> never for plates, panels or backgrounds. The agent is always the campaign's small kawaii ant: a round ink-outlined body in card colour, two short antennae,
> two dot eyes, no mouth, no clothes. People appear only as hands and forearms in plain sleeves, never a head or face.

## Style block `diagram-night-v2` (dark slides and video)

> The same as `diagram-v2`, on a night #101216 background with panels in #181b21, outlines in #ece9df, violet #b49cff
> as the single strong accent, mint #14f195 for money. Everything else unchanged.

## Prompts

| Id | Diagram | Use | Size |
|---|---|---|---|
| DIAG-01 | [01 System architecture](01-system-architecture.md) | Article header, deck "How it fits together" | 1920x1080 |
| DIAG-02 | [02 Mainnet target layout](02-mainnet-target-layout.md) | Deck "Built to keep keys apart" | 1920x1080 |
| DIAG-03 | [03 Per-call x402](03-per-call-x402.md) | Article, "Pay" section | 1600x900 |
| DIAG-04 | [04 Metered escrow](04-metered-escrow.md) | Article, "Pay for what you use" | 1600x900 |
| DIAG-05 | [05 Budget lifecycle](05-budget-lifecycle.md) | Hero of the Budget launch, social card | 1920x1080 and 1080x1350 |
| DIAG-06 | [06 Budget judge](06-budget-judge.md) | Article, "Verify" section | 1600x900 |
| DIAG-07 | [07 Ratings and attestations](07-rating-attestation.md) | Deck "Reputation you earn" | 1600x900 |
| DIAG-08 | [08 Receipts v2](08-receipts-v2.md) | Article, "Verify" section; share card | 1600x900 |

### DIAG-01 v1 (style `diagram-v1`, 1920x1080)

> A wide system map read left to right. On the left, three small rounded figures without faces: a person holding a
> plain wallet card, a small boxy robot agent holding a slim key, and a person at a workbench. In the middle, four
> separate rounded rectangular rooms drawn as flat panels with ink outlines, each with two or three blank label plates
> inside: the largest room has a small doorway the robot's key fits; the second, smaller room holds a sealed safe with a
> tiny padlock; the third holds three small identical machines in a row; the fourth is a simple storefront. Below them,
> a row of three plain cylinders for stored records. On the right, one large violet hexagonal block standing for the
> on-chain program, with a smaller vault box beside it joined by a short line carrying a mint disc. Thin ink connector
> lines with small arrowheads link the figures to the rooms and the rooms to the violet block. Two small clock faces
> without numerals sit above the largest room, one drawn with a dashed amber outline. Paper background, even spacing,
> nothing else in frame.

### DIAG-02 v1 (style `diagram-v1`, 1920x1080)

> The same kind of flat system map, now showing rooms deliberately set apart. Five separate rounded panels spaced
> widely on a paper background, with clear gaps between them: a front room with a doorway; a room holding a safe with a
> padlock, drawn twice side by side with a thin wall between the two safes; a room with three small machines and their
> own small wallet cards; a small watchtower panel with a bell, drawn with a dashed amber outline; and a small booth
> with a gavel resting on a plain block, also with a dashed amber outline. Each panel has one or two blank label
> plates. At the bottom centre, one large violet hexagonal block with a vault box beside it marked by two of three
> small keyholes filled. Thin ink lines run from each panel down to the violet block; no panel connects directly to
> another except the front room to the safe room. Generous empty space between panels to show separation.

### DIAG-03 v1 (style `diagram-v1`, 1600x900)

> A simple left to right sequence in three beats on a paper background. Left: a small boxy robot agent holds up a slim
> request card. Middle: a plain shop counter with a small bell; above it a blank ticket plate showing where the price
> would be. A single ink line runs from the robot's wallet card through a small split junction: most of the line
> carries one mint disc to the counter, a thin branch carries a much smaller mint disc to a small vault box. Right: the
> counter hands back an answer card with a long receipt slip attached and a small violet seal on it. Three blank label
> plates under the three beats. Nothing else in frame.

### DIAG-04 v1 (style `diagram-v1`, 1600x900)

> A clear glass jar with a ruled scale on its side, drawn in ink outline, standing on a paper background, filled to the
> top mark with small mint discs. A thin ink line leads from the jar to a small machine on the right that answers a
> request card. Below the jar, three short lines leave it: one to the machine carrying several mint discs, one very
> thin line to a small vault box carrying a single tiny disc, and one curling back to a robot agent on the left
> carrying the discs that were not used. The jar's level is shown dropping to a lower mark with a dashed outline of the
> old level. A small violet hexagon sits behind the jar as its lid. Blank label plates under the jar, the machine and
> the robot.

### DIAG-05 v1 (style `diagram-v1`, 1920x1080; also run at 1080x1350 with the same subject stacked top to bottom)

> A horizontal timeline story in five panels joined by one thin ink line, on a paper background. Panel one: a person's
> hand places mint discs into a large clear jar with a violet hexagonal lid and hands a slim key to a small boxy robot
> agent. Panel two: the jar's contents are divided by thin vertical ink dividers into three slices, each slice tagged
> with a blank plate and joined by a thin line to one of three small identical machines. Panel three: the robot holds
> the key up to a small doorway; behind the doorway a closed safe with a padlock, with only a small mint tick
> beside it; the machines each fill a short receipt slip. Panel four: the jar's lid closes, an hourglass stands beside
> it, a small bell rings above it. Panel five: the slices empty into three small open hands of the machines, a thin
> branch carries one tiny disc to a vault box, and leftover discs curl back to the person. A small gavel on a block
> sits beneath panel four with a dashed amber outline. Blank label plate under each panel.

### DIAG-06 v1 (style `diagram-v1`, 1600x900)

> A balance scale in ink outline at the centre of a paper background, its beam level. On the left pan, a short stack of
> receipt slips each with a small violet seal; on the right pan, a single slice of a jar drawn as a wedge. Behind the
> scale, a plain booth with a gavel resting on a block, drawn with a dashed amber outline because it is still being
> built. To the left, a person holds up a small flag; to the right, a small machine holds its receipt slips. Below, two
> thin lines leave the scale: one to the machine carrying a mint disc, one back to the person carrying a mint disc.
> Blank label plates under the person, the booth and the machine.

### DIAG-07 v1 (style `diagram-v1`, 1600x900)

> Two small figures facing each other across a plain table, one a person and one a small boxy machine, on a paper
> background. Each slides a sealed envelope into a shared ink-outlined box in the middle with a violet lid. In a second
> beat to the right, the box is open and both envelopes are open, each showing a blank card with a row of ten small
> empty circles where one is filled in mint. Above the table, two simple ledger books, each with one new ruled line
> filled. A third, smaller figure stands at the edge holding a clipboard with five blank ruled rows. Blank label plates
> under each beat.

### DIAG-08 v1 (style `diagram-v1`, 1600x900)

> A single long receipt slip lying flat on a paper background, divided by dashed lines into six blank ruled sections of
> different heights, the top section the largest. A small violet wax seal at the bottom of the slip. Thin ink leader
> lines from four of the sections run out to small plain icons around the slip: a speech bubble, an answer card, a
> small hexagon with a mint disc, and a short chain of three linked slips. A small magnifying glass in ink outline
> rests over the seal. Blank label plates at the end of each leader line. Nothing else in frame.

### v2 prompts (style `diagram-v2`)

Same ids, sizes and uses as v1. Each v2 fixes what its v1 draft got wrong (see Runs) and uses the ant agent.

### DIAG-01 v2 (style `diagram-v2`, 1920x1080)

> A wide system map read left to right on a paper background. On the left, three small subjects stacked top to bottom:
> a hand holding a plain wallet card, the kawaii ant agent holding a slim key, and a hand resting on a small workbench.
> In the middle, four separate rounded rectangular rooms drawn as flat panels with ink outlines, each with two blank
> card-coloured plates inside: the largest room has a small doorway the ant's key fits; the second, smaller room holds
> a sealed safe with a tiny padlock; the third holds three small identical machines in a row; the fourth is a simple
> storefront with an empty awning. Below them, a row of three plain cylinders for stored records. On the right, one
> large violet hexagon with six equal sides, plain and unmarked, with a smaller vault box beside it joined by a short
> line carrying one mint disc. Thin ink connector lines with small arrowheads link the subjects to the rooms and the
> rooms to the hexagon. Even spacing, nothing else in frame.

### DIAG-02 v2 (style `diagram-v2`, 1920x1080)

> The same kind of flat system map, now showing rooms deliberately set apart. Five separate rounded panels spaced
> widely on a paper background, with clear gaps between them: a front room with a doorway; a room holding two safes side
> by side with a thin wall between them; a room with three small machines; a small watchtower with a bell, drawn with a
> dashed amber outline; and a small booth with a gavel resting on a plain block, also with a dashed amber outline. Each
> panel has one blank card-coloured plate. At the bottom centre, one large violet hexagon with a plain vault box beside
> it. On the vault's door, exactly three round keyholes in a row: the left two filled solid ink, the right one empty.
> Thin ink lines run from each panel down to the hexagon; only the front room also connects to the safe room. Generous
> empty space between panels.

### DIAG-03 v2 (style `diagram-v2`, 1600x900)

> A simple left to right sequence in three beats on a paper background. Left: the kawaii ant agent holds up a slim
> blank request card. Middle: a plain shop counter with a small bell; above it a blank card-coloured ticket plate. A
> single ink line runs from the ant through a small split junction: the main line carries one mint disc to the counter,
> and a thin branch carries one much smaller mint disc to a small plain vault box. Right: the counter hands back a
> blank answer card with a long blank receipt slip attached, and a small violet seal on the slip. Three blank
> card-coloured plates under the three beats. Nothing else in frame.

### DIAG-04 v2 (style `diagram-v2`, 1600x900)

> A clear glass jar drawn in ink outline at the centre of a paper background, with plain tick marks on its side and a
> flat violet hexagon as its lid. Inside, a few loose mint discs lie flat on the bottom, filling it only to the lower
> tick mark; a dashed ink line higher up shows where the level was. Three thin ink lines leave the jar: one to a small
> machine on the right carrying two mint discs, one very thin line down to a plain vault box carrying one tiny mint
> disc, and one curving back to the kawaii ant agent on the left carrying one mint disc. Blank card-coloured plates
> under the jar, the machine and the ant. Nothing else in frame, no coins outside the jar.

### DIAG-05 v2 (style `diagram-v2`, 1920x1080; also run at 1080x1350 with the panels stacked top to bottom)

> Exactly five equal panels in a single row, joined by one thin ink line, on a paper background; no sixth panel.
> Panel 1: a hand drops a mint disc into a clear jar with a violet hexagon lid and passes a slim key to the kawaii ant
> agent. Panel 2: thin vertical ink dividers split the jar into three slices, each joined by a thin line to one of three
> small identical machines. Panel 3: the ant holds the key up to a small doorway; the three machines each print a short
> blank slip. Panel 4: the jar's lid is closed, a small hourglass stands beside it and a small bell hangs above it;
> beneath it a small gavel on a block drawn with a dashed amber outline. Panel 5: one mint disc goes to each machine, a
> thin branch carries one tiny disc to a plain vault box, and one disc curves back to the hand. Violet only on the jar
> lid. One blank card-coloured plate under each panel.

### DIAG-06 v2 (style `diagram-v2`, 1600x900)

> A balance scale in ink outline at the centre of a paper background, its beam level. On the left pan, three blank
> receipt slips each with a small violet seal; on the right pan, one wedge-shaped slice of a clear jar. Behind the
> scale, a plain booth with a gavel resting on a block, drawn with a dashed amber outline. To the left, a hand holds up
> a small plain flag; to the right, a small machine holds its blank slips. Below, two thin ink lines leave the scale:
> one to the machine carrying one mint disc, one back to the hand carrying one mint disc. Blank card-coloured plates
> under the hand, the booth and the machine.

### DIAG-07 v2 (style `diagram-v2`, 1600x900)

> Two beats on a paper background. Left beat: across a plain table, a hand on one side and a small boxy machine on the
> other each slide a sealed blank envelope into a shared ink-outlined box with a violet lid. Right beat: the box is
> open and both envelopes are open, each showing a blank card with a row of ten small empty circles, one of them filled
> mint. Above the table, two plain closed ledger books, each with one ruled line drawn in. At the far edge, the kawaii
> ant agent holds a clipboard with five blank ruled rows. Blank card-coloured plates under each beat. No coins, no
> stacks.

### DIAG-08 v2 (style `diagram-v2`, 1600x900)

> A single long blank receipt slip lying flat on a paper background, divided by dashed lines into six blank ruled
> sections of different heights, the top section the largest. A small violet wax seal at the bottom of the slip. Thin
> ink leader lines from four of the sections run out to small plain icons around the slip: a blank speech bubble, a
> blank answer card, a small plain hexagon outline with one mint disc beside it, and a short chain of three linked
> blank slips. A small magnifying glass in ink outline rests over the seal. Blank card-coloured plates at the end of
> each leader line. Nothing else in frame.

### v3 prompts (style `diagram-v2` plus the v3 sentences)

Written after the v2 drafts still drew coin stacks and spread violet. Only for the six v2 misses. Sent to the
provider as `diagram-v2`, then these sentences, then the subject and size:

> Colour budget for this image: ink outlines on paper and card only, plus exactly one violet object (named below) and
> a few mint dots. Every other shape is unfilled card colour. Money is drawn only as small flat mint dots, each a
> simple circle with no rim, no edge thickness and no stacking; never more than three dots touching. Leave label areas
> as empty paper; do not draw plates, tags, flags or signs.

### DIAG-02 v3 (1920x1080)

> Five rounded card-coloured panels spaced widely across the top half, with clear gaps: a doorway; two safes side by
> side with a thin wall between them; three small machines; a small watchtower with a bell (dashed amber outline); a
> small booth with a gavel on a block (dashed amber outline). At the bottom centre, the one violet object: a plain
> flat hexagon. Beside it a plain card-coloured vault box with three round keyholes in a row, the left two filled ink,
> the right one empty. Thin ink lines from each panel down to the hexagon. No money in this image.

### DIAG-03 v3 (1600x900)

> Three beats left to right. Left: the kawaii ant agent holds a blank card. Middle: a plain card-coloured counter with
> a small bell. Right: a blank answer card with a long blank slip; on the slip, the one violet object, a small round
> seal. A single thin ink line runs from the ant to the counter carrying one mint dot; a thin branch off it carries
> one smaller mint dot to a small plain vault box. Nothing else.

### DIAG-04 v3 (1600x900)

> A tall clear glass jar in ink outline at the centre with plain tick marks on its side; its lid is the one violet
> object, a flat hexagon. Three mint dots lie on the jar's floor; a dashed ink line higher up marks the old level.
> Three thin ink lines leave the jar: right to a small machine carrying one mint dot, down to a plain vault box
> carrying one tiny mint dot, left to the kawaii ant agent carrying one mint dot.

### DIAG-06 v3 (1600x900)

> A balance scale in ink outline at the centre, beam level. Left pan: three blank slips; on the top slip, the one
> violet object, a small round seal. Right pan: one wedge cut from a clear jar. Behind the scale, a plain booth with a
> gavel on a block (dashed amber outline). Left: a hand in a plain sleeve, open palm up. Right: a small machine. Two
> thin ink lines below the scale, one to the machine and one to the hand, each carrying one mint dot.

### DIAG-07 v3 (1600x900)

> Two beats. Left: a hand in a plain sleeve and a small boxy machine on either side of a plain table each push a blank
> card-coloured envelope into a box whose lid is the one violet object. Right: the same box open, two blank cards each
> showing a row of ten small empty circles with one filled mint. Above, two closed ledger books in card colour. At the
> far right, the kawaii ant agent holds a clipboard with five blank ruled rows.

### DIAG-08 v3 (1600x900)

> One long blank receipt slip lying flat at the centre, divided by dashed lines into six blank sections, the top one
> largest. At its bottom, the one violet object, a small round seal, with a small ink magnifying glass resting over
> it. Thin ink leader lines from four sections run out to four small plain icons: a blank speech bubble, a blank card,
> a small hexagon outline (unfilled) with one mint dot beside it, and a short chain of three linked blank slips.
> Nothing else.

### Style block `diagram-v4`

Written after a v3 draft drew a hex colour code as text. It names colours instead of giving codes and replaces the
earlier blocks for v4 prompts:

> Flat editorial technical illustration, like a page from a well-made printed field guide. Colours: warm off-white
> paper background, cream panels, near-black ink outlines, one strong violet accent, small bright mint dots, and
> dashed amber outlines only for things still being built. Thick, even ink outlines, simple geometric shapes, flat
> front view, generous empty space, consistent line weight. No gradients, no glow, no 3D, no isometric perspective, no
> photorealism. Absolutely no writing of any kind: no words, letters, numbers, codes, captions, signage or anything
> that looks like text. No coins, coin stacks, piles, discs on edge, bags, banknotes or currency signs anywhere. No
> people's faces; people appear only as hands in plain sleeves. The agent is a small kawaii ant: round cream body, two
> short antennae, two dot eyes. Every shape is unfilled cream except the one violet object named below and the mint
> dots. Leave label areas as empty paper; no plates, tags, flags or signs.

### DIAG-02 v4 (style `diagram-v4`, 1920x1080)

> Five rounded cream panels spaced widely across the top half, with clear gaps between them. Panel 1: a plain open
> doorway. Panel 2: two plain safes side by side with a thin wall between them. Panel 3: three small plain machines in
> a row. Panel 4, drawn with a dashed amber outline: a slim lit pillar with a small bell on top, nothing else inside.
> Panel 5, drawn with a dashed amber outline: a small gavel resting on a plain block, nothing else inside. At the
> bottom centre, the one violet object: a plain flat hexagon. Beside it a plain cream vault box with three round
> keyholes in a row, the left two filled ink, the right one empty. Thin ink lines run from each panel down to the
> hexagon. No money anywhere in this image.

### DIAG-08 v4 (style `diagram-v4`, 1600x900)

> One long blank cream receipt slip lying flat at the centre, divided by dashed lines into six empty sections, the top
> one largest. At its bottom, the one violet object: a small round wax seal with nothing on it. A small ink magnifying
> glass rests over the seal. Thin ink leader lines from four sections run out to four small plain cream icons: an
> empty speech bubble, an empty card, a small unfilled hexagon outline with one mint dot beside it, and a short chain
> of three linked empty slips. Nothing else in frame.

## Runs

Drafts only: free runs on 26 November 2026 to see how the v1 prompts land before any paid run. Unscored until the
owner has looked at them at full size; the notes are the defects found so far. Files are in the project's
`rap-architecture/drafts/` folder, not in the repository. Common faults (text, coin stacks, faces) point to a v2 with
stronger negatives and the campaign's ant agent in place of the robot. The v2 runs (rtwin1, same day) removed text and
faces everywhere but still drew coin stacks and spread violet; DIAG-01 and 05 come closest. The six others have v3
wording in the project's `rap-architecture/diag-prompts-v3.json`, to be added here as v3 when it is run.

| Id | Version | Day | Provider | Model | File | Score | Notes |
|---|---|---|---|---|---|---|---|
| DIAG-01 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 101 | `DIAG-01-v1-zimage-seed101.webp` | | Printed the words "On-chain program" (fails rule 1); octagon not hexagon. |
| DIAG-02 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 102 | `DIAG-02-v1-zimage-seed102.webp` | | No text, separation reads well; three keyholes filled instead of two of three. |
| DIAG-03 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 103 | `DIAG-03-v1-zimage-seed103.webp` | | Label plates filled violet and amber, so accent misused; robot has a face. |
| DIAG-04 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 104 | `DIAG-04-v1-zimage-seed104.webp` | | Drew coin stacks (fails the money rule). |
| DIAG-05 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 105 | `DIAG-05-v1-zimage-seed105.webp` | | Six panels not five; robot has a face; violet overused. |
| DIAG-06 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 106 | `DIAG-06-v1-zimage-seed106.webp` | | Closest to the style; label plates amber; partial face on the figure. |
| DIAG-07 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 107 | `DIAG-07-v1-zimage-seed107.webp` | | Coin stacks and faces. |
| DIAG-08 | v1 | 2026-11-26 | Hugging Face Space (free) | z-image-turbo, 1536x864, seed 108 | `DIAG-08-v1-zimage-seed108.webp` | | Good; one small coin stack to remove. |
| DIAG-01 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1920x1080, seed 201 | `DIAG-01-v2-rtwin1-seed201.png` | | Closest so far: no text, hexagon right. Ants drawn with violet bodies (violet misused); an ant at the desk where a hand belongs. |
| DIAG-02 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1920x1080, seed 202 | `DIAG-02-v2-rtwin1-seed202.png` | | Coin stacks in the booth panel; violet cube in the watchtower panel; safe drawn inside the hexagon. Keyholes right (two of three). |
| DIAG-03 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 203 | `DIAG-03-v2-rtwin1-seed203.png` | | Label plates filled violet and amber; small coin stack in the answer machine. |
| DIAG-04 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 204 | `DIAG-04-v2-rtwin1-seed204.png` | | Discs piled in the jar (reads as coins); grey and amber plates; jar lid round, not a hexagon. |
| DIAG-05 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1920x1080, seed 205 | `DIAG-05-v2-rtwin1-seed205.png` | | Strong style. Six panels with one empty (asked for five); violet lids repeated on every jar. |
| DIAG-06 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 206 | `DIAG-06-v2-rtwin1-seed206.png` | | Good composition; violet flag, a small coin stack by the gavel, amber plates; hands drawn as sleeves, no faces. |
| DIAG-07 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 207 | `DIAG-07-v2-rtwin1-seed207.png` | | Violet box flaps read well; one amber plate; only five circles, not ten; clipboard has a face. |
| DIAG-08 | v2 | 2026-11-26 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 208 | `DIAG-08-v2-rtwin1-seed208.png` | | Coin stack; violet speech bubbles and magnifier; amber plate. |
| DIAG-02 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1920x1080, seed 209 | `DIAG-02-v3-rtwin1-seed209.png` | | Small stack of discs in the last room. |
| DIAG-03 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 210 | `DIAG-03-v3-rtwin1-seed210.png` | | Kept. Passes; two small violet circles and an amber vault box to settle at the label stage. |
| DIAG-04 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 211 | `DIAG-04-v3-rtwin1-seed211.png` | | Amber-filled plates. |
| DIAG-06 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 212 | `DIAG-06-v3-rtwin1-seed212.png` | | Kept. Passes; one amber disc by the machine to soften at the label stage. |
| DIAG-07 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 213 | `DIAG-07-v3-rtwin1-seed213.png` | | Amber-filled plates. |
| DIAG-08 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 214 | `DIAG-08-v3-rtwin1-seed214.png` | | Printed the words "On chain program". |
| DIAG-02 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1920x1080, seed 215 | `DIAG-02-v3-rtwin1-seed215.png` | | Coin stacks in three panels. |
| DIAG-04 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 216 | `DIAG-04-v3-rtwin1-seed216.png` | | Kept. No text, no coins, plates in card colours. |
| DIAG-07 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 217 | `DIAG-07-v3-rtwin1-seed217.png` | | Kept. Violet envelope (violet is for the program); fix at the label stage. |
| DIAG-08 | v3 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 218 | `DIAG-08-v3-rtwin1-seed218.png` | | Drew a hex colour code as text. |
| DIAG-02 | v4 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1920x1080, seed 219 | `DIAG-02-v4-rtwin1-seed219.png` | | Kept. Passes hard rules; one safe not two, amber outline on every panel. |
| DIAG-08 | v4 | 2026-11-27 | rtwin1 (free, own GPU) | z-image-turbo, 1600x900, seed 220 | `DIAG-08-v4-rtwin1-seed220.png` | | Kept. Passes hard rules; six icons not four, hexagon drawn as a circle. |

Kept set (one per diagram, copies in the project's `rap-architecture/final/`): 01 v2 seed 201, 02 v4 seed 219, 03 v3
seed 210, 04 v3 seed 216, 05 v2 seed 205, 06 v3 seed 212, 07 v3 seed 217, 08 v4 seed 220. All free runs; no paid run so far.
Scores wait for the owner's review at full size.
