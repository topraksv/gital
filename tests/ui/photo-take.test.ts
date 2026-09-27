/**
 * A photo is taken from the camera or the library and stored shrunk (SPEC
 * 8.2): its longest edge at most PHOTO_EDGE, a thumbnail beside it, both as
 * the JPEG data URIs `src/data/photos.ts` accepts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({
  requestCameraPermissionsAsync: vi.fn(async () => ({ granted: true })),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));
const resized = vi.hoisted(() => [] as unknown[]);
vi.mock("expo-image-picker", () => picker);
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  ImageManipulator: {
    manipulate: () => ({
      renderAsync: async () => ({ width: 1500, height: 1200 }),
      resize(size: unknown) {
        const base64 = `b${resized.push(size)}`;
        return { renderAsync: async () => ({ saveAsync: async () => ({ base64 }) }) };
      },
    }),
  },
}));

const { default: takePhoto, edgeOf, photoFromWeb, PHOTO_EDGE, THUMB_EDGE } = await import("../../src/ui/photo-take");

const shot = { canceled: false, assets: [{ uri: "file:///a.jpg", width: 4032, height: 3024 }] };

beforeEach(() => {
  resized.length = 0;
  picker.requestCameraPermissionsAsync.mockClear();
  picker.launchCameraAsync.mockReset().mockResolvedValue(shot);
  picker.launchImageLibraryAsync.mockReset().mockResolvedValue(shot);
});

describe("edgeOf", () => {
  it("bounds the longest edge and never enlarges", () => {
    expect(edgeOf(4032, 3024, 1024)).toEqual({ width: 1024 });
    expect(edgeOf(3024, 4032, 1024)).toEqual({ height: 1024 });
    expect(edgeOf(640, 480, 1024)).toEqual({ width: 640 });
  });
});

describe("takePhoto", () => {
  it("stores the photo and its thumbnail as JPEG data URIs, each shrunk", async () => {
    const taken = await takePhoto("camera");
    expect(taken).toEqual({ data: "data:image/jpeg;base64,b1", thumb: "data:image/jpeg;base64,b2" });
    expect(resized).toEqual([{ width: PHOTO_EDGE }, { width: THUMB_EDGE }]);
  });

  it("asks for the camera, and says so when it is refused", async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    expect(await takePhoto("camera")).toBe("denied");
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it("asks for nothing to pick from the library, and comes back empty when nothing was picked", async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await takePhoto("library")).toBe("cancelled");
    expect(picker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe("photoFromWeb", () => {
  // React Native's FileReader, which Node lacks: the one way it turns a blob into a data URI.
  vi.stubGlobal(
    "FileReader",
    class {
      result: string | null = null;
      onload: (() => void) | null = null;
      readAsDataURL(blob: Blob) {
        this.result = `data:${blob.type};base64,eA==`;
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  const answer = (type: string, status = 200) => vi.fn(async () => new Response(new Blob(["x"], { type }), { status }));

  it("fetches a shop's picture and shrinks it as a taken photo is", async () => {
    vi.stubGlobal("fetch", answer("image/webp"));
    expect(await photoFromWeb("https://cdn.example/1.jpg")).toEqual({ data: "data:image/jpeg;base64,b1", thumb: "data:image/jpeg;base64,b2" });
    expect(resized).toEqual([{ width: PHOTO_EDGE }, { width: THUMB_EDGE }]);
  });

  it("refuses what is not a picture, or did not come", async () => {
    vi.stubGlobal("fetch", answer("text/html"));
    await expect(photoFromWeb("https://cdn.example/1.jpg")).rejects.toThrow();
    vi.stubGlobal("fetch", answer("image/jpeg", 404));
    await expect(photoFromWeb("https://cdn.example/1.jpg")).rejects.toThrow();
    expect(resized).toEqual([]);
  });
});
