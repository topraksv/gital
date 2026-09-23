import { useColorScheme } from "react-native";

import { darkPalette, lightPalette, type Palette } from "./theme";

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? darkPalette : lightPalette;
}
