import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollapsibleSection } from "./CollapsibleSection";

describe("CollapsibleSection", () => {
  it("renders an expanded accessible region when requested", () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection
        contentId="expanded-content"
        title="Expanded"
        icon={<span>icon</span>}
        storageKey="test.expanded"
        defaultExpanded
      >
        <p>body</p>
      </CollapsibleSection>
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="expanded-content"');
    expect(html).not.toContain('id="expanded-content" hidden=""');
  });

  it("hides a collapsed region without unmounting its content", () => {
    const html = renderToStaticMarkup(
      <CollapsibleSection
        contentId="collapsed-content"
        title="Collapsed"
        icon={<span>icon</span>}
        storageKey="test.collapsed"
      >
        <p>preserved form state</p>
      </CollapsibleSection>
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="collapsed-content" hidden=""');
    expect(html).toContain("preserved form state");
  });
});
