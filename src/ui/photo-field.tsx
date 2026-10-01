/**
 * The photo on an item's or a wish's panel and a shop's receipt (SPEC 7.1,
 * 8.2, 5.4), the one place any of them is taken: shown when there is one,
 * taken from the camera or picked from the library, and taken off. The
 * panel's save writes what was chosen, so Vazgeç leaves the row as it was.
 */

import { useEffect, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import Camera from "lucide-react-native/icons/camera";
import ImagePlus from "lucide-react-native/icons/image-plus";
import X from "lucide-react-native/icons/x";
import type { LucideIcon } from "lucide-react-native";

import { readPhoto, type PhotoChange } from "../data/photos";
import { tr } from "../i18n/tr";
import { Body, IconButton } from "./components";
import { appError } from "./dialog";
import { interactionSurface } from "./interaction";
import { Press } from "./press";
import { borderWidth, circle, font, iconStroke, photoPreview, radius, spacing, type, useTheme } from "./theme";

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
  title = tr.photos.title,
  name,
  photoId,
  thumb,
  value,
  onChange,
  readOnly = false,
}: {
  title?: string;
  name: string;
  /** Optional, as a `ShownItem`'s are. */
  photoId?: string | null;
  thumb?: string | null;
  value: PhotoChange;
  onChange: (change: PhotoChange) => void;
  /** A viewer's (SPEC 1.4): the photo is shown, and nothing offers to change it. */
  readOnly?: boolean;
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
  // A phone's browser offers its camera from the file picker itself, so the
  // web has one way in where a phone app has two.
  const sources: [LucideIcon, string, "camera" | "library"][] =
    Platform.OS === "web"
      ? [[ImagePlus, shown ? tr.photos.change : tr.photos.add, "library"]]
      : [[Camera, tr.photos.camera, "camera"], [ImagePlus, tr.photos.library, "library"]];
  if (readOnly && !shown) return null;
  return (
    <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
      <Body>{title}</Body>
      {shown ? (
        <View>
          <Image
            source={{ uri: shown }}
            accessibilityLabel={tr.photos.of(name)}
            resizeMode="contain"
            style={{ width: "100%", height: photoPreview.height, borderRadius: radius.md, backgroundColor: palette.surfaceAlt }}
          />
          {/* On the photo's own corners: what is drawn is what they act on. */}
          {readOnly ? null : (
            <>
              <View style={{ position: "absolute", top: spacing.xs, right: spacing.xs }}>
                <IconButton icon={X} label={tr.photos.remove} onPress={() => onChange(null)} />
              </View>
              <View style={{ position: "absolute", bottom: spacing.xs, right: spacing.xs, flexDirection: "row" }}>
                {sources.map(([icon, label, from]) => (
                  <IconButton key={from} icon={icon} label={label} onPress={() => void take(from)} />
                ))}
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {sources.map(([icon, label, from]) => (
            <Source key={from} icon={icon} label={label} onPress={() => void take(from)} />
          ))}
        </View>
      )}
    </View>
  );
}

/** One way to bring a photo in, drawn as the empty frame it would fill. */
function Source({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const { palette } = useTheme();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => ({
        flex: 1,
        minHeight: photoPreview.source,
        padding: spacing.sm,
        gap: spacing.sm,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        borderWidth: borderWidth.control,
        borderStyle: "dashed",
        borderColor: palette.controlBorder,
        ...interactionSurface(palette, state, { base: palette.surfaceAlt }),
      })}
    >
      <View
        style={{
          width: photoPreview.disc,
          height: photoPreview.disc,
          borderRadius: circle(photoPreview.disc),
          backgroundColor: palette.primarySoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon accessible={false} size={photoPreview.icon} color={palette.accentText} strokeWidth={iconStroke.quiet} />
      </View>
      <Text style={[type.small, { color: palette.text, fontFamily: font.medium, textAlign: "center" }]}>{label}</Text>
    </Press>
  );
}
