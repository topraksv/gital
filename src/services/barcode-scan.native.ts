/**
 * The phone's own barcode scanner (SPEC 2.8): Google's code scanner on
 * Android, VisionKit's on iOS 16 and later, each a system screen over the
 * app. It says when a code is read and never when it was closed, so a scan is
 * a launch plus a listener the screen holds, and closing it is nothing.
 */

import { Platform } from "react-native";
import { Camera, CameraView, type BarcodeType } from "expo-camera";

// The codes on what a grocery sells; a QR code on a packet is an advert.
const PRODUCT_CODES: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e"];

/** Without Google Play services, or before iOS 16, there is no scanner and no button. */
export const canScan = CameraView.isModernBarcodeScannerAvailable;

/** Each code read, until the returned function stops listening. */
export function onScanned(read: (code: string) => void): () => void {
  const subscription = CameraView.onModernBarcodeScanned(({ data }) => {
    // Android closes its scanner on the first code; iOS's stays until told.
    if (Platform.OS === "ios") void CameraView.dismissScanner();
    read(data);
  });
  return () => subscription.remove();
}

/** `false` when the camera was refused. Google's scanner needs no permission; VisionKit's does. */
export async function launchScanner(): Promise<boolean> {
  if (Platform.OS === "ios" && !(await Camera.requestCameraPermissionsAsync()).granted) return false;
  await CameraView.launchScanner({ barcodeTypes: PRODUCT_CODES });
  return true;
}
