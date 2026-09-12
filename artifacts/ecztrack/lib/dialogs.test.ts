import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * react-native-web's Alert is `static alert() {}` — a no-op — so the web
 * branch must not go through Alert at all. These tests pin that.
 */

const alertMock = vi.fn();
let platform = "ios";

vi.mock("react-native", () => ({
  Alert: { alert: (...a: unknown[]) => alertMock(...a) },
  get Platform() {
    return { get OS() { return platform; } };
  },
}));

const { confirmDestructive, notify } = await import("./dialogs");

beforeEach(() => {
  alertMock.mockReset();
  vi.stubGlobal("window", { confirm: vi.fn(() => true), alert: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("confirmDestructive", () => {
  it("resolves true when the confirm button is pressed on native", async () => {
    platform = "ios";
    alertMock.mockImplementation((_t, _m, buttons) => buttons[1].onPress());
    await expect(confirmDestructive("T", "M")).resolves.toBe(true);
  });

  it("resolves false when cancelled on native", async () => {
    platform = "ios";
    alertMock.mockImplementation((_t, _m, buttons) => buttons[0].onPress());
    await expect(confirmDestructive("T", "M")).resolves.toBe(false);
  });

  it("resolves false when dismissed by tapping outside on Android", async () => {
    platform = "android";
    alertMock.mockImplementation((_t, _m, _b, opts) => opts.onDismiss());
    await expect(confirmDestructive("T", "M")).resolves.toBe(false);
  });

  it("uses window.confirm on web and never touches Alert", async () => {
    platform = "web";
    await expect(confirmDestructive("T", "M")).resolves.toBe(true);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("returns the user's refusal from window.confirm on web", async () => {
    platform = "web";
    vi.stubGlobal("window", { confirm: vi.fn(() => false) });
    await expect(confirmDestructive("T", "M")).resolves.toBe(false);
  });
});

describe("notify", () => {
  it("uses window.alert on web and never touches Alert", () => {
    platform = "web";
    notify("Export failed", "disk full");
    expect(window.alert).toHaveBeenCalledOnce();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("uses Alert on native", () => {
    platform = "ios";
    notify("Export failed", "disk full");
    expect(alertMock).toHaveBeenCalledWith("Export failed", "disk full");
  });
});
