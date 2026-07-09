import { describe, expect, it } from "vitest";
import { buildZelleLink, formatZelleHandle, parseZelleInput } from "@/lib/zelle";

describe("parseZelleInput", () => {
  it("accepts emails, lowercased", () => {
    expect(parseZelleInput("  Deepak@Bank.com ")).toEqual({
      type: "email",
      handle: "deepak@bank.com",
    });
  });

  it("accepts US phones in any common format", () => {
    for (const raw of ["(555) 123-4567", "555-123-4567", "5551234567", "+1 555 123 4567", "15551234567"]) {
      expect(parseZelleInput(raw)).toEqual({ type: "phone", handle: "5551234567" });
    }
  });

  it("rejects junk", () => {
    for (const raw of ["", "   ", "not-an-email", "12345", "+44 20 7946 0958", "@venmo-style"]) {
      expect(parseZelleInput(raw)).toBeNull();
    }
  });
});

describe("formatZelleHandle", () => {
  it("formats phones and passes emails through", () => {
    expect(formatZelleHandle("5551234567")).toBe("(555) 123-4567");
    expect(formatZelleHandle("a@b.com")).toBe("a@b.com");
  });
});

describe("buildZelleLink", () => {
  it("encodes the Zelle QR payload with E.164 phones and uppercased name", () => {
    const url = buildZelleLink("5551234567", "Deepak");
    expect(url.startsWith("https://enroll.zellepay.com/qr-codes?data=")).toBe(true);
    const data = decodeURIComponent(url.split("data=")[1]);
    const payload = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    expect(payload).toEqual({ token: "+15551234567", name: "DEEPAK", action: "payment" });
  });

  it("uses emails as-is", () => {
    const url = buildZelleLink("a@b.com", "Priya");
    const data = decodeURIComponent(url.split("data=")[1]);
    const payload = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    expect(payload.token).toBe("a@b.com");
  });
});
