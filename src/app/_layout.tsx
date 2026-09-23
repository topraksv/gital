import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { usePalette } from "../ui/use-palette";

export default function RootLayout() {
  const palette = usePalette();
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      />
      <StatusBar style="auto" />
    </>
  );
}
