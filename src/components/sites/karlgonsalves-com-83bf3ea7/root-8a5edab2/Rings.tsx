import type { CSSProperties } from "react";
import { pad2 } from "./pad";

/**
 * The 24 ring slots of the tunnel. On the live site these come from 24 static
 * stylesheet rules (`.angle.axis.item_01` .. `.angle.axis.item_24`), each
 * `rotateX(NN * 15deg) rotateY(0deg) rotateZ(0deg)` with `preserve-3d`.
 * Emitting them as inline styles keeps the exact same computed values.
 */
export function angleStyle(slot: number): CSSProperties {
  return {
    transform: `rotateX(${slot * 15}deg) rotateY(0deg) rotateZ(0deg)`,
    transformStyle: "preserve-3d",
  };
}

export function angleClassName(slot: number, extra = "") {
  return `angle axis item_${pad2(slot)}${extra ? ` ${extra}` : ""}`;
}

const BUILDING_VARIANTS = ["building_a", "building_b", "building_c", "building_d"] as const;

/** `.buildings.tilt.axis` — 24 buildings alternating through the 4 artworks. */
export function BuildingRing({ side }: { side: "left" | "right" }) {
  return (
    <div className={side === "right" ? "buildings tilt axis right" : "buildings tilt axis"}>
      <div className="rotation axis">
        {Array.from({ length: 24 }, (_, index) => {
          const slot = index + 1;
          const variant = BUILDING_VARIANTS[index % BUILDING_VARIANTS.length];
          return (
            <div key={slot} className={angleClassName(slot)} style={angleStyle(slot)}>
              <div className={`item ${variant}${side === "right" ? " right" : ""}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** `.lamps.tilt.axis` — 24 identical lamp posts. */
export function LampRing({ side }: { side: "left" | "right" }) {
  return (
    <div className={side === "right" ? "lamps tilt axis right" : "lamps tilt axis"}>
      <div className="rotation axis">
        {Array.from({ length: 24 }, (_, index) => {
          const slot = index + 1;
          return (
            <div key={slot} className={angleClassName(slot)} style={angleStyle(slot)}>
              <div className={`item lamp${side === "right" ? " right" : ""}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * `.clouds.tilt.axis` — the live DOM only uses 11 of the 24 slots; the cloud
 * art per slot is copied verbatim from the published markup.
 */
const CLOUD_SLOTS: string[][] = [
  ["cloud_a"],
  ["cloud_b", "cloud_c"],
  ["cloud_d", "cloud_e"],
  ["cloud_f", "cloud_g", "cloud_h"],
  ["cloud_i", "cloud_j", "cloud_k", "cloud_l"],
  ["cloud_m", "cloud_n"],
  ["cloud_o", "cloud_p", "cloud_q", "cloud_r"],
  ["cloud_s", "cloud_t", "cloud_u"],
  ["cloud_v", "cloud_w"],
  ["cloud_x", "cloud_y"],
  ["cloud_z"],
];

export function CloudRing() {
  return (
    <div className="clouds tilt axis">
      <div data-w-id="28f20c06-a8f4-4ae8-6c45-cc6e2bb8d61c" className="rotate axis">
        {CLOUD_SLOTS.map((clouds, index) => {
          const slot = index + 1;
          return (
            <div key={slot} className={angleClassName(slot)} style={angleStyle(slot)}>
              {clouds.map((cloud) => (
                <div key={cloud} className={`item ${cloud}`} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
