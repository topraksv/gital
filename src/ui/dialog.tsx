/**
 * Themed alert and prompt, Helix's `dialog.tsx`: the one replacement for
 * `window.alert` and native `Alert.alert`, promise-based so a call site reads
 * like the blocking API it replaces:
 *
 *   await appError(message);
 *   const name = await appPrompt(title, message, { confirmLabel, initialValue });
 *
 * `DialogHost` and `PromptHost` render once in the root layout; RN's Modal
 * overlays every screen, and outlives the screen that asked. Helix's operation
 * header is left out until a caller needs it; a confirm is only for what the
 * undo bar cannot take back, which a list's delete is not.
 */

import { useState, type ReactNode, type RefObject } from "react";
import { Animated, Modal, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { tr } from "../i18n/tr";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, SlideUp, TextField } from "./components";
import { errorNotice } from "./haptics";
import { KeyboardSafeScrollView } from "./keyboard-safe";
import { PanelMotion } from "./list-motion";
import { useDragAway, useReducedMotion } from "./motion";
import { closeRequest, emptyRequestQueue, enqueueRequest, type RequestQueue } from "./request-queue";
import { shouldPresentAsSheet } from "./responsive";
import { circle, dialog, motion, radius, spacing, themeShadow, type, useTheme } from "./theme";

interface DialogRequest {
  title: string;
  message: string;
  /** The action a confirm asks for; an error has none and only closes. */
  confirmLabel: string | null;
  resolve: (confirmed: boolean) => void;
}

const useDialogStore = create<RequestQueue<DialogRequest>>(() => emptyRequestQueue<DialogRequest>());

function ask(request: Omit<DialogRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.setState(enqueueRequest(useDialogStore.getState(), { ...request, resolve }));
  });
}

/**
 * Helix's `appAlert`, cut to the one kind Gital shows: a failure, which says
 * so on the device too. Resolves when dismissed.
 */
export function appError(message: string): Promise<void> {
  errorNotice();
  return ask({ title: tr.errors.title, message, confirmLabel: null }).then(() => {});
}

/** Helix's `appConfirm`: true only for the named action, never for a tap outside. */
export function appConfirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return ask({ title, message, confirmLabel });
}

interface PromptRequest {
  /** Keys the field, so each prompt opens with its own value rather than the last one's. */
  id: number;
  title: string;
  message: string;
  placeholder: string;
  confirmLabel: string;
  initialValue: string;
  maxLength: number | undefined;
  multiline: boolean | undefined;
  kind: PromptKind;
  resolve: (value: string | null) => void;
}

/** What the field holds, which decides its keyboard and what the phone may fill in. */
type PromptKind = "text" | "email" | "password" | "new-password";

const usePromptStore = create<RequestQueue<PromptRequest>>(() => emptyRequestQueue<PromptRequest>());
let promptId = 0;

/** Themed input dialog. Resolves the entered value, or `null` on cancel or a tap outside. */
export function appPrompt(
  title: string,
  message: string,
  opts: { confirmLabel: string; placeholder?: string; initialValue?: string; maxLength?: number; multiline?: boolean; kind?: PromptKind },
): Promise<string | null> {
  return new Promise((resolve) => {
    const request: PromptRequest = {
      id: ++promptId,
      title,
      message,
      placeholder: opts.placeholder ?? "",
      confirmLabel: opts.confirmLabel,
      initialValue: opts.initialValue ?? "",
      maxLength: opts.maxLength,
      multiline: opts.multiline,
      kind: opts.kind ?? "text",
      resolve,
    };
    usePromptStore.setState(enqueueRequest(usePromptStore.getState(), request));
  });
}

/**
 * The overlay every dialog and sheet renders, so what must not drift between
 * them is written once: the scrim that dismisses, the container Pressables
 * marked `accessible={false}` (or they swallow their children), the modal's
 * name, and the heading that takes focus.
 */
export function DialogShell({
  title,
  message,
  titleRef,
  onDismiss,
  lead,
  action,
  children,
}: {
  title: string;
  /** Beside the title: a control that acts on the whole thing the dialog is about, the item panel's star. */
  action?: ReactNode;
  message?: string;
  /** Drawn above the title: the tour's picture of the slide. */
  lead?: ReactNode;
  titleRef: RefObject<View | null>;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const asSheet = shouldPresentAsSheet(width);
  // A sheet goes down by its handle and title, not by its body, whose own
  // fields and lists take a vertical drag first.
  const { dragY, panHandlers } = useDragAway(dialog.dragAway, height, onDismiss);
  const surface = [
    {
      backgroundColor: palette.surface,
      padding: spacing.lg,
      // A sheet is attached to the bottom edge: only its top corners round,
      // and its padding carries the home indicator.
      ...(asSheet
        ? { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: spacing.lg + insets.bottom }
        : { borderRadius: radius.lg }),
      borderCurve: "continuous" as const,
    },
    themeShadow.card(palette),
  ];
  const content = (
    <>
      <View {...(asSheet ? panHandlers : {})}>
        {asSheet ? (
          // The grab handle every bottom sheet wears: pulled down, it closes the sheet.
          <View
            accessible={false}
            style={{
              alignSelf: "center",
              width: dialog.handle.width,
              height: dialog.handle.height,
              borderRadius: circle(dialog.handle.height),
              backgroundColor: palette.surfaceStrong,
              marginBottom: spacing.md,
            }}
          />
        ) : null}
        {lead}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm }}>
          <View ref={titleRef} accessible accessibilityRole="header" aria-level={2} tabIndex={-1} style={{ flex: 1 }}>
            <Text style={[type.heading, { color: palette.text }]}>{title}</Text>
          </View>
          {action}
        </View>
      </View>
      {message ? <Body muted>{message}</Body> : null}
      {children}
    </>
  );
  return (
    // On the web the Modal is the element with `role="dialog"`, and takes the
    // name there; a label on a generic element inside it names nothing.
    <Modal aria-label={title} transparent animationType={reducedMotion ? "none" : "fade"} visible onRequestClose={onDismiss}>
      <Pressable
        accessible={false}
        tabIndex={-1}
        style={{ flex: 1, backgroundColor: palette.scrim, justifyContent: asSheet ? "flex-end" : "center" }}
        onPress={onDismiss}
      >
        <KeyboardSafeScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: asSheet ? "flex-end" : "center", padding: asSheet ? 0 : spacing.lg }}
          bottomOffset={Math.min(dialog.keyboardGap, Math.round(height * dialog.keyboardGapShare))}
          extraKeyboardSpace={spacing.lg}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* The modal surface carries the dialog's name on a phone, or a
              screen reader announces an anonymous dialog as it takes focus. */}
          <Pressable
            accessible={false}
            tabIndex={-1}
            accessibilityViewIsModal
            aria-label={title}
            onPress={() => {}}
            style={{ alignSelf: "center", width: "100%", maxWidth: asSheet ? undefined : dialog.maxWidth }}
          >
            <Animated.View style={{ transform: [{ translateY: dragY }] }}>
              <PanelMotion>
                <SlideUp distance={asSheet ? motion.travel.sheet : motion.travel.rise} style={surface}>
                  {content}
                </SlideUp>
              </PanelMotion>
            </Animated.View>
          </Pressable>
        </KeyboardSafeScrollView>
      </Pressable>
    </Modal>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.lg }}>{children}</View>;
}

function PromptBody({ request, onClose }: { request: PromptRequest; onClose: (value: string | null) => void }) {
  const [value, setValue] = useState(request.initialValue);
  const titleRef = useModalAccessibility(true, request.id, false);
  const ready = value.trim() !== "";
  return (
    <DialogShell title={request.title} message={request.message} titleRef={titleRef} onDismiss={() => onClose(null)}>
      <TextField
        value={value}
        maxLength={request.maxLength}
        onChangeText={setValue}
        accessibilityLabel={request.title}
        accessibilityHint={request.message}
        placeholder={request.placeholder}
        autoFocus
        // A rename opens on the whole name selected, so typing replaces it.
        selectTextOnFocus={request.initialValue !== ""}
        multiline={request.multiline}
        {...fieldFor(request.kind)}
        // Enter in a multi-line field is a new line and never submits, so
        // only the button confirms it, and the key must not promise more.
        returnKeyType={request.multiline ? "default" : "done"}
        onSubmitEditing={() => ready && onClose(value)}
        style={[{ marginTop: spacing.lg }, request.multiline && { height: dialog.multilineHeight, textAlignVertical: "top" }]}
      />
      <Actions>
        <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => onClose(null)} />
        <Button label={request.confirmLabel} size="sm" disabled={!ready} onPress={() => onClose(value)} />
      </Actions>
    </DialogShell>
  );
}

function fieldFor(kind: PromptKind) {
  if (kind === "text") return {};
  if (kind === "email") return { autoCapitalize: "none", autoCorrect: false, autoComplete: "email", keyboardType: "email-address", textContentType: "emailAddress" } as const;
  const fresh = kind === "new-password";
  return {
    autoCapitalize: "none",
    secureTextEntry: true,
    autoComplete: fresh ? "new-password" : "current-password",
    textContentType: fresh ? "newPassword" : "password",
  } as const;
}

export function PromptHost() {
  const current = usePromptStore((s) => s.current);
  if (!current) return null;
  const close = (value: string | null) => closeRequest(usePromptStore, current, (request) => request.resolve(value));
  return <PromptBody key={current.id} request={current} onClose={close} />;
}

export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const titleRef = useModalAccessibility(current != null, current);
  if (!current) return null;
  const close = (confirmed: boolean) => closeRequest(useDialogStore, current, (request) => request.resolve(confirmed));
  return (
    <DialogShell title={current.title} message={current.message} titleRef={titleRef} onDismiss={() => close(false)}>
      <Actions>
        {current.confirmLabel ? (
          <>
            <Button label={tr.common.cancel} variant="ghost" size="sm" onPress={() => close(false)} />
            <Button label={current.confirmLabel} size="sm" onPress={() => close(true)} />
          </>
        ) : (
          <Button label={tr.common.done} size="sm" onPress={() => close(false)} />
        )}
      </Actions>
    </DialogShell>
  );
}
