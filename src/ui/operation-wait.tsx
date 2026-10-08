/**
 * Helix's `OperationFlow` waiting page: what covers the app while signing in,
 * signing out, freezing or deleting runs. Each names itself, in its own
 * colour, because all four end on the same blank moment and a bare spinner
 * would make a deletion look like a sign-out. The halo's breath is the only
 * motion on the page, opacity and scale only so it runs off the JS thread
 * that the operation is busy on; reduced motion holds it still.
 */

import { Animated, StyleSheet, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import KeyRound from "lucide-react-native/icons/key-round";
import LogOut from "lucide-react-native/icons/log-out";
import Snowflake from "lucide-react-native/icons/snowflake";
import Trash from "lucide-react-native/icons/trash";

import type { AccountOperation } from "../auth/session";
import { tr } from "../i18n/tr";
import { useWaitBreath } from "./motion";
import { borderWidth, circle, motion, operationWait, spacing, type, useTheme, type Palette } from "./theme";

const VISUALS: Record<AccountOperation, readonly [LucideIcon, (palette: Palette) => string]> = {
  "sign-in": [KeyRound, (palette) => palette.primary],
  "sign-out": [LogOut, (palette) => palette.secondary],
  freeze: [Snowflake, (palette) => palette.warning],
  delete: [Trash, (palette) => palette.error],
};

export function OperationWait({ operation }: { operation: AccountOperation }) {
  const { palette } = useTheme();
  const breath = useWaitBreath(motion.operation.breath, 0.7);
  if (!breath) return null;

  const [Icon, ink] = VISUALS[operation];
  const color = ink(palette);
  const { title, body } = tr.operation[operation];
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: palette.background }]}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${title}. ${body}`}
        style={{ width: "100%", maxWidth: operationWait.maxWidth, alignItems: "center", gap: spacing.lg }}
      >
        <View style={{ width: operationWait.halo, height: operationWait.halo, alignItems: "center", justifyContent: "center" }}>
          <Animated.View
            style={{
              position: "absolute",
              width: operationWait.halo,
              height: operationWait.halo,
              borderRadius: circle(operationWait.halo),
              backgroundColor: color + operationWait.haloTint,
              opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [...operationWait.haloOpacity] }),
              transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [...operationWait.haloScale] }) }],
            }}
          />
          <View
            style={{
              width: operationWait.medallion,
              height: operationWait.medallion,
              borderRadius: circle(operationWait.medallion),
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: color + operationWait.medallionTint,
              borderWidth: borderWidth.outline,
              borderColor: color + operationWait.medallionEdge,
            }}
          >
            <Icon accessible={false} size={operationWait.icon} color={color} />
          </View>
        </View>
        <View style={{ gap: spacing.sm, alignItems: "center" }}>
          <Text style={[type.heading, { color: operation === "delete" ? palette.errorText : palette.textStrong, textAlign: "center" }]}>{title}</Text>
          <Text accessibilityLiveRegion="polite" style={[type.body, { color: palette.textSecondary, textAlign: "center" }]}>
            {body}
          </Text>
        </View>
      </View>
    </View>
  );
}
