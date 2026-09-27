/**
 * An invitation's QR code (SPEC 1.4), loaded apart from the page: the encoder
 * is only needed when the owner makes a link. Dark on white in every theme,
 * since a scanner reads the light margin as the code's edge.
 */

import Svg, { Path, Rect } from "react-native-svg";
import { qrPath } from "../domain/qr";
import { qrCode } from "./theme";

export default function QrCode({ text, label }: { text: string; label: string }) {
  const { size: cells, path } = qrPath(text);
  return (
    <Svg width={qrCode.size} height={qrCode.size} viewBox={`0 0 ${cells} ${cells}`} accessibilityLabel={label} role="img">
      <Rect width={cells} height={cells} fill={qrCode.light} />
      <Path d={path} fill={qrCode.dark} />
    </Svg>
  );
}
