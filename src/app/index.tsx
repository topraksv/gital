import { StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { tr } from "../i18n/tr";
import { layout, space, type } from "../ui/theme";
import { usePalette } from "../ui/use-palette";

export default function Home() {
  const palette = usePalette();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <Text accessibilityRole="header" style={[type.display, { color: palette.text }]}>
        {tr.home.title}
      </Text>
      <Text style={[type.body, styles.subtitle, { color: palette.textMuted }]}>
        {tr.home.subtitle}
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: layout.screenGutter },
  subtitle: { marginTop: space.sm },
});
