import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const navigation = readFileSync(new URL("./Navigation.tsx", import.meta.url), "utf8");

describe("responsive navigation", () => {
  test("collapses secondary actions before the search field is squeezed", () => {
    expect(styles).toContain("@media (max-width: 920px)");
    expect(styles).toContain(".nav-actions .nav-link,\n  .nav-actions .nav-create");
    expect(styles).toContain("grid-template-columns: auto minmax(0, 1fr) auto auto;");
  });

  test("keeps compact controls usable on narrow phones", () => {
    expect(styles).toContain("@media (max-width: 480px)");
    expect(styles).toContain(".wallet-button .wallet-label");
    expect(styles).toContain("inline-size: 42px;");
  });

  test("offers connected wallets a profile link in the hamburger sheet", () => {
    expect(navigation).toContain("{address && (");
    expect(navigation).toContain('route="profile"');
    expect(navigation).toContain(">Profile</AppLink>");
  });
});
