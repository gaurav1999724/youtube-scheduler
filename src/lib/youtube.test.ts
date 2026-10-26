import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDuration, shapeForYouTube } from "./youtube";

describe("classifyDuration", () => {
  it("skips videos under 10 seconds", () => {
    assert.equal(classifyDuration(0.1), "skip");
    assert.equal(classifyDuration(9.9), "skip");
  });

  it("treats 10 seconds through 2 minutes as Shorts", () => {
    assert.equal(classifyDuration(10), "short");
    assert.equal(classifyDuration(120), "short");
  });

  it("treats anything longer than 2 minutes as a normal video", () => {
    assert.equal(classifyDuration(120.1), "standard");
    assert.equal(classifyDuration(3600), "standard");
  });

  it("does not treat an unreadable length as a normal video", () => {
    assert.equal(classifyDuration(0), "unknown");
    assert.equal(classifyDuration(Number.NaN), "unknown");
    assert.equal(classifyDuration(-5), "unknown");
  });
});

describe("shapeForYouTube", () => {
  it("marks a short and keeps the title inside 100 characters", () => {
    const shaped = shapeForYouTube({
      title: "A".repeat(120),
      description: "A cartoon.",
      tags: ["cartoon"],
      playlist: "Stories",
      format: "short",
    });
    assert.ok(shaped.title.endsWith("#Shorts"));
    assert.ok(shaped.title.length <= 100);
    assert.match(shaped.description, /#Shorts/);
    assert.equal(shaped.playlist, "YouTube Shorts");
    assert.ok(shaped.tags.includes("Shorts"));
  });

  it("keeps a longer video out of Shorts", () => {
    const shaped = shapeForYouTube({
      title: "Story #Shorts",
      description: "A long story.\n\n#Shorts",
      tags: ["cartoon", "Shorts"],
      playlist: "Stories",
      format: "standard",
    });
    assert.equal(shaped.title, "Story");
    assert.equal(shaped.description.includes("#Shorts"), false);
    assert.deepEqual(shaped.tags, ["cartoon"]);
    assert.equal(shaped.playlist, "Stories");
  });
});
