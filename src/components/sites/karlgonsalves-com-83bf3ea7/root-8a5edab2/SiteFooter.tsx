const PAGES = [
  { id: "Page_01_Home", variant: "page_01" },
  { id: "Page_02_About", variant: "page_02" },
  { id: "Page_03_Work", variant: "page_03" },
  { id: "Page_04_Play", variant: "page_04" },
  { id: "Page_05_Contact", variant: "page_05" },
];

/** `.section.section_behind` — five transparent 100vh pages. They are the only
 *  in-flow content, so they are what gives the document its 500vh scroll
 *  height (everything else is `position: fixed`). */
export function SectionBehind() {
  return (
    <div className="section section_behind">
      {PAGES.map((page) => (
        <div key={page.id} id={page.id} className={`page ${page.variant}`} />
      ))}
    </div>
  );
}

/** The two click hotspots that appear at scroll 37.5–62.5% (Vimeo) and
 *  87.5–100% (phone / email). The old "Art by Ivan Vlasov" credit in the
 *  bottom-right corner was replaced by the dock FAB (see KarlSite.tsx). */
export default function SiteFooter() {
  return (
    <div className="section">
      <div className="button_holder">
        <div
          data-w-id="c4ecb8b9-957a-b61d-2f65-1f283e1cc9c5"
          className="button_overlay work"
        >
          <a
            id="Vimeo"
            href="https://vimeo.com/karlgonsalves"
            target="_blank"
            rel="noreferrer"
            className="button_link w-button"
          />
        </div>

        <div
          data-w-id="0ac0f1ae-12a4-d3e0-f773-dfc5f4533187"
          className="button_overlay contact"
        >
          <a id="Phone" href="tel:+13107214620" className="button_link w-button" />
          <a
            id="Email"
            href="mailto:karl.gonsalves@gmail.com?subject=From%20website"
            className="button_link w-button"
          />
        </div>
      </div>
    </div>
  );
}
