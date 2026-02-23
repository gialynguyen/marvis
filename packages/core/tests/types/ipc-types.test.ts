import { describe, it, expect } from "vitest";

describe("IPCRequestType", () => {
  it("should accept list_conversations as a valid type", async () => {
    const type: import("../../src/types/index").IPCRequestType = "list_conversations";
    expect(type).toBe("list_conversations");
  });

  it("should accept switch_conversation as a valid type", async () => {
    const type: import("../../src/types/index").IPCRequestType = "switch_conversation";
    expect(type).toBe("switch_conversation");
  });
});
