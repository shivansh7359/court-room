import { describe, it, expect } from "vitest";
import { tallyStatus, allowedOutcomes } from "./jury";

describe("jury rules", () => {
  it("is pending until every juror votes", () => expect(tallyStatus(3, 1, 1)).toBe("pending"));
  it("majority guilty forces a guilty verdict", () => {
    expect(tallyStatus(3, 2, 1)).toBe("majority_guilty");
    expect(allowedOutcomes("majority_guilty")).toEqual(["guilty"]);
  });
  it("majority not guilty forces not guilty", () => expect(allowedOutcomes(tallyStatus(5, 2, 3))).toEqual(["not_guilty"]));
  it("an even split is a deadlock that only allows a mistrial", () => {
    expect(tallyStatus(4, 2, 2)).toBe("deadlock");
    expect(allowedOutcomes("deadlock")).toEqual(["mistrial"]);
  });
  it("a bench trial (no jurors) lets the judge decide", () => expect(allowedOutcomes(tallyStatus(0, 0, 0))).toHaveLength(3));
  it("no verdict is allowed while votes are pending", () => expect(allowedOutcomes("pending")).toEqual([]));
});
