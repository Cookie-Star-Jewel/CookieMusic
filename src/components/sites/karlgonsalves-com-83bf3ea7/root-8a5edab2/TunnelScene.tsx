import { BuildingRing, CloudRing, LampRing } from "./Rings";
import { DEFAULT_SONG, lyricLineForPanel } from "./lyrics";

/**
 * `.pages.tilt.axis` — the five text panels posted inside the tunnel.
 * Rotations come from `.angle.axis.page_a` .. `.angle.axis.page_e`
 * (72° apart, so each panel fronts the camera once per loop).
 * The panels show lyrics from ./lyrics.ts; useKarlInteractions rewrites
 * each panel's text as the ring rotates, so the tunnel cycles through the
 * whole song forever.
 */
function PagesRing() {
  return (
    <div className="pages tilt axis">
      <div
        data-w-id="3963195e-5a86-d9a1-1fc7-2991c592ff89"
        className="pages rotate axis"
      >
        <div className="angle axis page_a">
          <div className="item pages">
            <div className="text_lyric" data-lyric-panel="0">
              {lyricLineForPanel(0, 0, DEFAULT_SONG)}
            </div>
          </div>
        </div>

        <div className="angle axis page_b">
          <div className="item pages">
            <div className="text_lyric" data-lyric-panel="1">
              {lyricLineForPanel(1, 0, DEFAULT_SONG)}
            </div>
          </div>
        </div>

        <div className="angle axis page_c">
          <div className="item pages">
            <div className="text_lyric" data-lyric-panel="2">
              {lyricLineForPanel(2, 0, DEFAULT_SONG)}
            </div>
          </div>
        </div>

        <div className="angle axis page_d">
          <div className="item pages">
            <div className="text_lyric" data-lyric-panel="3">
              {lyricLineForPanel(3, 0, DEFAULT_SONG)}
            </div>
          </div>
        </div>

        <div className="angle axis page_e">
          <div className="item pages">
            <div className="text_lyric" data-lyric-panel="4">
              {lyricLineForPanel(4, 0, DEFAULT_SONG)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The centrepiece: `.section.section_middle > .camera` with `perspective: 75vw`.
 * Everything inside is laid out on a 100vw × 100vw ring and seen "from inside"
 * a tunnel; the rings are rotated on scroll, the whole camera is tilted and
 * scaled by the pointer.
 */
export default function TunnelScene() {
  return (
    <div className="section section_middle tunnel-root">
      <div
        data-w-id="0e854f06-c83a-8c8a-26ef-befe62c43436"
        className="camera"
      >
        <div className="axis" />
        <BuildingRing side="left" />
        <BuildingRing side="right" />
        <LampRing side="left" />
        <LampRing side="right" />
        <CloudRing />
        <PagesRing />
        <div className="world axis" />
      </div>
    </div>
  );
}
