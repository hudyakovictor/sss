# Asset Provenance and Workflow

Status: REQUIRED
Scope: assets, provenance, licensing, stable IDs and release gates
Owner: Signal Arena project owner
Last reviewed: 2026-09-16
Supersedes: none
Required evidence: asset manifest, provenance records, license review, visual/responsive/accessibility QA
Canonical dependencies: `brand.md`, `motion_interaction_system_spec.md`, `full_game_spec.md`

> Mandatory workflow for assets and external visual/audio/source materials. This document is linked from `AGENTS.md` and the Signal Arena project overlay.

## 1. Asset decision

Use an existing asset only when:

- license or permission is verified;
- commercial use is allowed when required;
- modification/derivative use is allowed when required;
- visual fit is approved;
- provenance is recorded;
- the asset can be replaced through a stable `assetId`.

Create an original or generated asset when:

- the element is part of Signal Arena's core identity;
- no suitable licensed asset exists;
- the asset needs a unique Entity, Helper, Coin, or motion identity;
- an external asset would create licensing or continuity risk.

Use placeholders only in local development. Placeholder use must be visible in the asset registry and blocked from release builds.

## 2. Asset origins

```ts
type AssetOrigin =
  | "original"
  | "generated"
  | "licensed"
  | "public_domain"
  | "placeholder";
```

Unknown or unverifiable origin is not accepted for production.

## 3. Provenance record

```ts
type AssetProvenance = {
  assetId: string;
  path: string;
  kind: "image" | "icon" | "audio" | "font" | "video" | "data_snapshot";
  origin: AssetOrigin;
  sourceUrl?: string;
  creator?: string;
  license?: string;
  licenseUrl?: string;
  attributionRequired: boolean;
  commercialUseAllowed: boolean;
  modificationAllowed: boolean;
  createdAt: string;
  approvedBy?: string;
  replacementPlan: string;
  status: "draft" | "approved" | "rejected" | "deprecated";
};
```

## 4. Stable asset IDs

Game and UI code must reference IDs:

```ts
const entity = {
  id: "fake_breakout_phantom",
  portraitAssetId: "entity_fake_breakout_phantom_portrait"
};
```

Do not use arbitrary filenames as domain references:

```text
bad: fake-breakout-final-final-2.png
good: entity_fake_breakout_phantom_portrait
```

The registry resolves IDs to files, variants, sizes, and fallbacks.

## 5. Asset workflow

```text
Need identified
→ existing asset search
→ license/provenance check
→ visual fit review
→ use or reject
→ registry entry
→ import
→ responsive/visual QA
→ approved release asset
```

For a custom asset:

```text
brief
→ concept variants
→ selected direction
→ production asset
→ required sizes/formats
→ registry entry
→ integration
→ visual QA
```

## 6. Signal Arena defaults

Prefer original/generated assets for:

- Coin icon;
- Stars treatment when not using a platform-provided icon;
- Entity portraits;
- The Helper;
- canonical Cards and Protocol icons;
- scenario completion effects;
- seal/reveal effects;
- brand motifs;
- unique UI frames.

Licensed assets may be used for generic backgrounds, ambient textures, neutral interface elements, and temporary prototypes when the license is documented.

Historical charts and market data are not decorative assets. They must use the executable ScenarioPackage and validation boundaries in `../packages/contracts/src/scenario.ts` and `../packages/content/src/validate.ts`, together with the point-in-time and source requirements in `full_game_spec.md`.

## 7. Asset acceptance gates

- [ ] Asset has a stable assetId.
- [ ] Origin and source are recorded.
- [ ] License/permission is verified.
- [ ] Commercial and modification rights are known.
- [ ] Required sizes and formats exist.
- [ ] Fallback exists where needed.
- [ ] Entity names remain exact English.
- [ ] Visual QA passes desktop and mobile.
- [ ] Reduced-motion behavior exists for animated effects.
- [ ] No unknown-license asset enters production.
- [ ] Placeholder is absent from release build.

## 8. Asset task prompt

```text
Work only on the assigned Signal Arena asset task.

Before creating or importing anything:
1. Read AGENTS.md.
2. Read docs/README.md.
3. Read docs/asset_provenance_and_workflow.md.
4. Read the relevant visual, motion, Entity, or scenario document.
5. Declare whether the asset is original, generated, licensed, public-domain,
   or placeholder.
6. Record stable assetId, provenance, license, formats, sizes, fallbacks,
   and replacement plan.

Do not use unknown-license assets.
Do not put domain logic behind a filename.
Run visual, responsive, accessibility, reduced-motion, typecheck, lint, tests,
and build checks relevant to the task.
Return evidence and acceptance status.
```

## 9. Pending provenance queue

Files that exist on disk but are intentionally **not** registered in `assets/asset-manifest.json` until the owner confirms origin. Any code that references them is out of spec until this queue is cleared.

| Path | Discovered | Blocking question |
|---|---|---|
| `assets/logopng.png` | 2026-09-26 | Original for Signal Arena, generated for Signal Arena, or licensed? If none of these, delete. |
| `assets/logosamall.png` | 2026-09-26 | Same as above. |
| `assets/ui/signal_arena_icon_96_transparent.png` | 2026-09-26 | Same as above; likely a resized derivative — confirm source and license of the parent. |

Owner decision required before these can enter the manifest, before the preloader or any branded surface may reference them, and before Iteration 03 asset-release approval can proceed. Until then the branded preloader in `apps/design-system-lab` uses only CSS-drawn tokens from `packages/ui-game` and does not depend on any file in this queue.
