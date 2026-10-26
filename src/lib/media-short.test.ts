import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsVerticalShort } from "./media";

describe("needsVerticalShort", () => {
  it("leaves a vertical video as a Short", () => {
    assert.equal(needsVerticalShort(1080, 1920), false);
  });

  it("rebuilds a landscape or square video so YouTube can file it as a Short", () => {
    assert.equal(needsVerticalShort(1920, 1080), true);
    assert.equal(needsVerticalShort(1080, 1080), true);
  });
});
