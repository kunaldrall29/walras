import { describe, expect, it } from "vitest";

import { mintResourceId, parseResourceId } from "../src/id.js";

describe("resource ids (D-029)", () => {
  it("round-trips an http identity", () => {
    const identity = {
      type: "http" as const,
      resource: "http://127.0.0.1:4022/weather",
      toolName: "",
    };
    expect(parseResourceId(mintResourceId(identity))).toEqual(identity);
  });

  it("round-trips an mcp identity", () => {
    const identity = {
      type: "mcp" as const,
      resource: "http://127.0.0.1:4023/mcp",
      toolName: "hello",
    };
    expect(parseResourceId(mintResourceId(identity))).toEqual(identity);
  });

  it("is deterministic: same tuple, same id", () => {
    const identity = { type: "http" as const, resource: "http://a/b", toolName: "" };
    expect(mintResourceId(identity)).toBe(mintResourceId({ ...identity }));
  });

  it.each([
    ["wrong prefix", "wr2:aaaa"],
    ["no prefix", "aaaa"],
    ["empty payload", "wr1:"],
    ["non-base64url payload", "wr1:!!!"],
    ["payload is not JSON", `wr1:${Buffer.from("not json").toString("base64url")}`],
    ["payload is not an array", `wr1:${Buffer.from('{"a":1}').toString("base64url")}`],
    ["wrong arity", `wr1:${Buffer.from('["http","u"]').toString("base64url")}`],
    ["bad type", `wr1:${Buffer.from('["ftp","u",""]').toString("base64url")}`],
    ["empty resource", `wr1:${Buffer.from('["http","",""]').toString("base64url")}`],
    ["http with toolName", `wr1:${Buffer.from('["http","u","t"]').toString("base64url")}`],
    ["mcp without toolName", `wr1:${Buffer.from('["mcp","u",""]').toString("base64url")}`],
  ])("rejects %s", (_label, id) => {
    expect(parseResourceId(id)).toBeNull();
  });
});
