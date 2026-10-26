import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queueScoreFor } from "./queue-order";

describe("queueScoreFor", () => {
  it("picks a longer known video before a shorter one", () => {
    assert.ok(queueScoreFor(200, "1000") > queueScoreFor(10, "999999999"));
  });

  it("picks a known uploadable video before a file whose length is unknown", () => {
    assert.ok(queueScoreFor(10, "1") > queueScoreFor(null, String(2 * 1024 * 1024 * 1024)));
  });

  it("picks a larger unknown file before a smaller unknown file", () => {
    assert.ok(queueScoreFor(null, String(50 * 1024 * 1024)) > queueScoreFor(null, String(1024 * 1024)));
  });

  it("picks an unknown file before a known clip under 10 seconds", () => {
    assert.ok(queueScoreFor(null, "1") > queueScoreFor(9, String(500 * 1024 * 1024)));
  });

  it("treats a missing length like an unknown file, ranked by size", () => {
    assert.equal(queueScoreFor(0, "1"), queueScoreFor(null, "1"));
    assert.equal(queueScoreFor(Number.NaN, "1"), queueScoreFor(null, "1"));
  });
});
