/**
 * Interaction timeline reverse-engineered from karlgonsalves.com.
 *
 * Source of truth: the IX2 payload embedded at the end of
 * https://karlgonsalves.com/js/webflow.js
 * (extracted verbatim to docs/research/karlgonsalves-com-83bf3ea7/root-8a5edab2/ix2.json)
 *
 * The live site declares exactly two IX2 events, both continuous:
 *   e   PAGE_SCROLL  -> actionList "a"   (scroll progress, 0-100)
 *   e-2 MOUSE_MOVE   -> actionList "a-2" (mouse X + mouse Y, 0-100 each)
 * Every value below is copied from that payload — nothing is estimated.
 *
 * Engine semantics (read straight out of the minified IX2 runtime):
 *   - smoothing 50  ->  per animation frame: pos += (target - pos) * (1 - 50/100)
 *   - keyframes are linear; below the first keyframe the first value is held,
 *     above the last keyframe the last value is held.
 *   - transforms are emitted as
 *     translate3d(x, y, z) rotateX(a) rotateY(b) rotateZ(c) scale3d(sx, sy, 1)
 *
 * Loop adjustments (so the tunnel can rotate forever, driven by virtual scroll):
 *   - every track is periodic now: value(100%) === value(0%)
 *   - ring rotation end 165° -> 180° (a full 360° turn)
 *   - CONTACT menu button and the contact overlay fade back out before 100%
 *   - the page_a/page_e opacity crossfade is gone: the original design parked
 *     panels a and e on the same 180° slot and swapped them at the back of the
 *     tunnel; the five lyric panels now sit 72° apart instead, so each panel
 *     owns its slot and never fades
 */

export type Unit = "px" | "vw" | "vh" | "deg";

export interface Keyframe {
  /** percent of the driving parameter, as written in the IX2 payload */
  at: number;
  value: number;
  unit?: Unit;
}

export type PropName =
  | "moveX"
  | "moveY"
  | "moveZ"
  | "rotateX"
  | "rotateY"
  | "rotateZ"
  | "scale"
  | "opacity";

export type Track = Partial<Record<PropName, Keyframe[]>>;

export interface Target {
  /** CSS selector, resolved inside the .karl-site root */
  sel: string;
  /** what this element is, for auditability */
  name: string;
  scroll?: Track;
  mouseX?: Track;
  mouseY?: Track;
}

/* ------------------------------------------------------------------ *
 * Action list "a" — Page Scroll (smoothing 50, startsEntering true)
 * ------------------------------------------------------------------ */
export const SCROLL_TARGETS: Target[] = [
  {
    name: "all ring rotations (.rotation.axis)",
    sel: ".rotation.axis",
    scroll: {
      rotateX: [
        { at: 0, value: -180, unit: "deg" },
        { at: 100, value: 180, unit: "deg" },
      ],
    },
  },
  {
    name: "pages ring rotation",
    sel: '[data-w-id="3963195e-5a86-d9a1-1fc7-2991c592ff89"]',
    scroll: {
      rotateX: [
        { at: 0, value: 165, unit: "deg" },
        { at: 100, value: -195, unit: "deg" },
      ],
    },
  },
  {
    name: "menu HOME",
    sel: '[data-w-id="5b25b9d1-0356-3960-6e98-3efebd5db7e5"]',
    scroll: {
      scale: [
        { at: 12.25, value: 1.5 },
        { at: 12.5, value: 1 },
        { at: 99.5, value: 1 },
        { at: 100, value: 1.5 },
      ],
    },
  },
  {
    name: "menu ABOUT",
    sel: '[data-w-id="15bef578-00f5-2289-6d44-96461a6f69da"]',
    scroll: {
      scale: [
        { at: 12.5, value: 1 },
        { at: 12.75, value: 1.5 },
        { at: 37.25, value: 1.5 },
        { at: 37.5, value: 1 },
      ],
    },
  },
  {
    name: "menu WORK",
    sel: '[data-w-id="272c6054-5e7e-4110-5372-d630c5b3dfee"]',
    scroll: {
      scale: [
        { at: 37.5, value: 1 },
        { at: 37.75, value: 1.5 },
        { at: 62.25, value: 1.5 },
        { at: 62.5, value: 1 },
      ],
    },
  },
  {
    name: "menu PLAY",
    sel: '[data-w-id="b5dea7c1-bd7c-eadc-5d7d-e7563761f032"]',
    scroll: {
      scale: [
        { at: 62.5, value: 1 },
        { at: 62.75, value: 1.5 },
        { at: 87.25, value: 1.5 },
        { at: 87.5, value: 1 },
      ],
    },
  },
  {
    name: "menu CONTACT",
    sel: '[data-w-id="7cf04f6a-4f80-4e0-2a9a-b4643b38d530"]',
    scroll: {
      scale: [
        { at: 87.5, value: 1 },
        { at: 87.75, value: 1.5 },
        { at: 99.25, value: 1.5 },
        { at: 99.5, value: 1 },
      ],
    },
  },
  {
    name: "work overlay",
    sel: '[data-w-id="c4ecb8b9-957a-b61d-2f65-1f283e1cc9c5"]',
    scroll: {
      scale: [
        { at: 37.5, value: 0 },
        { at: 45, value: 1 },
        { at: 55, value: 1 },
        { at: 62.25, value: 1.5 },
        { at: 62.75, value: 0 },
      ],
      moveY: [
        { at: 37.5, value: 18.75, unit: "vh" },
        { at: 45, value: -3.125, unit: "vh" },
        { at: 55, value: 6.25, unit: "vh" },
        { at: 62.5, value: 78.125, unit: "vh" },
      ],
    },
  },
  {
    name: "contact overlay",
    sel: '[data-w-id="0ac0f1ae-12a4-d3e0-f773-dfc5f4533187"]',
    scroll: {
      scale: [
        { at: 87.5, value: 0 },
        { at: 90, value: 1 },
        { at: 97, value: 1 },
        { at: 99.5, value: 0 },
      ],
      moveY: [
        { at: 87.5, value: 12.5, unit: "vh" },
        { at: 90, value: 0, unit: "vh" },
        { at: 97, value: 0, unit: "vh" },
        { at: 99.5, value: 12.5, unit: "vh" },
      ],
    },
  },
  {
    name: "balloon",
    sel: '[data-w-id="4cdaec35-9e39-5e08-47ff-7cfe65316369"]',
    scroll: {
      rotateZ: [
        { at: 18.75, value: -120, unit: "deg" },
        { at: 81.25, value: 75, unit: "deg" },
      ],
      moveY: [
        { at: 18.75, value: 200, unit: "vw" },
        { at: 81.25, value: -200, unit: "vw" },
      ],
    },
  },
];

/* ------------------------------------------------------------------ *
 * Action list "a-2" — Mouse Animation (MOUSE_X, smoothing 50, resting 50)
 * ------------------------------------------------------------------ */
export const MOUSE_X_TARGETS: Target[] = [
  {
    name: "camera 1",
    sel: '[data-w-id="0e854f06-c83a-8c8a-26ef-befe62c43436"]',
    mouseX: {
      rotateZ: [
        { at: 0, value: -30, unit: "deg" },
        { at: 100, value: 30, unit: "deg" },
      ],
      moveX: [
        { at: 0, value: 12.5, unit: "vw" },
        { at: 100, value: -12.5, unit: "vw" },
      ],
    },
  },
  {
    name: "clouds ring rotation",
    sel: '[data-w-id="28f20c06-a8f4-4ae8-6c45-cc6e2bb8d61c"]',
    mouseX: {
      rotateX: [
        { at: 0, value: -30, unit: "deg" },
        { at: 100, value: 30, unit: "deg" },
      ],
    },
  },
  {
    name: "camera 2",
    sel: '[data-w-id="4cdaec35-9e39-5e08-47ff-7cfe65316368"]',
    mouseX: {
      rotateZ: [
        { at: 0, value: -45, unit: "deg" },
        { at: 100, value: 45, unit: "deg" },
      ],
      moveX: [
        { at: 0, value: -25, unit: "vw" },
        { at: 100, value: 25, unit: "vw" },
      ],
    },
  },
];

/* ------------------------------------------------------------------ *
 * Action list "a-2" — Mouse Animation (MOUSE_Y)
 * ------------------------------------------------------------------ */
export const MOUSE_Y_TARGETS: Target[] = [
  {
    name: "camera 1",
    sel: '[data-w-id="0e854f06-c83a-8c8a-26ef-befe62c43436"]',
    mouseY: {
      scale: [
        { at: 0, value: 0.625 },
        { at: 100, value: 1.125 },
      ],
    },
  },
  {
    name: "clouds ring rotation",
    sel: '[data-w-id="28f20c06-a8f4-4ae8-6c45-cc6e2bb8d61c"]',
    mouseY: {
      rotateY: [
        { at: 0, value: 0, unit: "deg" },
        { at: 100, value: -15, unit: "deg" },
      ],
    },
  },
  {
    name: "camera 2",
    sel: '[data-w-id="4cdaec35-9e39-5e08-47ff-7cfe65316368"]',
    mouseY: {
      scale: [
        { at: 0, value: 0.55 },
        { at: 100, value: 1.5 },
      ],
    },
  },
];

/** IX2 smoothing 50 -> per-frame factor 1 - 50/100 */
export const SMOOTHING_FACTOR = 0.5;

/** IX2 restingState 50 (mouse events) */
export const MOUSE_RESTING = 50;

/** IX2 `optimizeFloat` rounds to 3 decimals */
export const OPTIMIZE_FLOAT = 1000;
