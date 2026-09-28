/**
 * Helix's error boundary: a screen that throws while drawing would otherwise
 * unmount the whole tree to a blank page with no way back. This catches it and
 * shows a themed screen whose retry mounts the routes again. It sits inside
 * the theme so the fallback wears the palette. Nothing leaves the device:
 * Gital collects no crash reports (`docs/PRIVACY.md`), so the error reaches the
 * console only in development.
 */

import { Component, type ReactNode } from "react";
import { View } from "react-native";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";

import { tr } from "../i18n/tr";
import { Button, EmptyState } from "./components";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    if (__DEV__) console.error("error-boundary", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ flex: 1 }}>
        <EmptyState
          icon={TriangleAlert}
          title={tr.errors.appCrashed}
          hint={tr.errors.appCrashedHint}
          action={<Button label={tr.common.retry} onPress={() => this.setState({ failed: false })} />}
        />
      </View>
    );
  }
}
