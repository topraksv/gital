/**
 * The photo on an item's or a wish's panel (SPEC 7.1, 8.2): shown when it has
 * one, taken from the camera or picked from the library, and taken off. The
 * panel's save writes what was chosen, so Vazgeç leaves the row as it was.
 */

import { useEffect, useState } from "react";
import { Image, Platform, View } from "react-native";
import Camera from "lucide-react-native/icons/camera";
import ImagePlus from "lucide-react-native/icons/image-plus";
import X from "lucide-react-native/icons/x";

import { readPhoto, type PhotoChange } from "../data/photos";
import { tr } from "../i18n/tr";
import { Body, Button, IconButton } from "./components";
import { appError } from "./dialog";
import { photoPreview, radius, spacing, useTheme } from "./theme";

const loadTake = () => import("./photo-take").then((module) => module.default);

/** The stored photo at full size once read, its thumbnail until then. */
function useStored(photoId: string | null | undefined, thumb: string | null | undefined): string | null {
  const [full, setFull] = useState<{ id: string; data: string } | null>(null);
  useEffect(() => {
    if (!photoId) return;
    let live = true;
    readPhoto(photoId).then(
      (data) => live && data && setFull({ id: photoId, data }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [photoId]);
  return full && full.id === photoId ? full.data : (thumb ?? null);
}

export function PhotoField({
  name,
  photoId,
  thumb,
  value,
  onChange,
}: {
  name: string;
  /** Optional, as a `ShownItem`'s are. */
  photoId?: string | null;
  thumb?: string | null;
  value: PhotoChange;
  onChange: (change: PhotoChange) => void;
}) {
  const { palette } = useTheme();
  const stored = useStored(photoId, thumb);
  const shown = value === undefined ? stored : (value?.data ?? null);
  // Fetched while the panel is open, so the first tap offline still finds the chunk.
  useEffect(() => void loadTake().catch(() => {}), []);
  const take = (from: "camera" | "library") =>
    loadTake()
      .then((takePhoto) => takePhoto(from))
      .then(
        (taken) => {
          if (taken === "denied") return appError(tr.photos.denied);
          if (taken !== "cancelled") onChange(taken);
        },
        () => appError(tr.photos.failed),
      );
  return (
    <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
      <Body>{tr.photos.title}</Body>
      {shown ? (
        <Image
          source={{ uri: shown }}
          accessibilityLabel={tr.photos.of(name)}
          resizeMode="contain"
          style={{ width: "100%", height: photoPreview.height, borderRadius: radius.md, backgroundColor: palette.surfaceAlt }}
        />
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {/* A phone's browser offers its camera from the file picker itself, so
            the web has one button where a phone app has two. */}
        {Platform.OS === "web" ? (
          <Button label={shown ? tr.photos.change : tr.photos.add} icon={ImagePlus} variant="ghost" size="sm" onPress={() => void take("library")} />
        ) : (
          <>
            <Button label={tr.photos.camera} icon={Camera} variant="ghost" size="sm" onPress={() => void take("camera")} />
            <Button label={tr.photos.library} icon={ImagePlus} variant="ghost" size="sm" onPress={() => void take("library")} />
          </>
        )}
        <View style={{ flex: 1 }} />
        {shown ? <IconButton icon={X} label={tr.photos.remove} onPress={() => onChange(null)} /> : null}
      </View>
    </View>
  );
}
