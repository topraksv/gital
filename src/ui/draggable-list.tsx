/**
 * Helix's press-and-drag list (`~/helix/src/ui/draggable-list.tsx`), for rows
 * of their own heights: an item with a note is taller than one without, where
 * Helix's settings rows share one. Only the grip starts a drag, so the rest of
 * a row stays tappable; the lifted row rises under the finger and the rows it
 * crosses slide out of its way (`docs/UI.md` section 7, "Reorder"). The order
 * is committed on release, and the grip's increment and decrement move a row
 * without a drag.
 *
 * PanResponder and Animated rather than gesture-handler: this runs on the web,
 * where `list-motion.tsx` keeps gesture-handler out of the bundle.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, Platform, View, type GestureResponderHandlers, type ViewStyle } from "react-native";
import GripVertical from "lucide-react-native/icons/grip-vertical";

import { tr } from "../i18n/tr";
import { errorNotice, mediumImpact, selectionTap } from "./haptics";
import { useReducedMotion } from "./motion";
import { follow } from "./reorder";
import { controlSize, drag, iconSize, motion, useTheme } from "./theme";

export interface DragHandle {
  panHandlers: GestureResponderHandlers;
  /** This row is the one held. */
  lifted: boolean;
  moveUp: () => void;
  moveDown: () => void;
}

const nativeDriver = Platform.OS !== "web";

// React Native types none of these. On the web the grip says it can be held, a
// touch drag on it moves the row rather than scrolling the page, and a mouse
// drag does not select the text it passes over.
const web = (style: object) => (Platform.OS === "web" ? style : {}) as ViewStyle;
const GRIP_WEB = web({ cursor: "grab", touchAction: "none" });
const LIST_WEB = web({ userSelect: "none" });

export function DraggableList<T>({
  items,
  keyOf,
  gap,
  onReorder,
  onDragging,
  renderRow,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  gap: number;
  onReorder: (orderedKeys: string[]) => Promise<void>;
  /** The screen's scroll stops while a row is held, or it takes the vertical pan. */
  onDragging: (dragging: boolean) => void;
  renderRow: (item: T, handle: DragHandle, position: number) => ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const [order, setOrder] = useState<readonly T[]>(items);
  const orderRef = useRef(order);
  orderRef.current = order;
  const latest = useRef({ items, keyOf, onReorder, onDragging });
  latest.current = { items, keyOf, onReorder, onDragging };
  const dragging = useRef<{ key: string; at: number; shift: number } | null>(null);
  const pending = useRef<string[] | null>(null);
  const heights = useRef(new Map<string, number>());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragY] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));
  // Each row's slide out of the way, set when the order changes under it and
  // played from there once the new order is laid out.
  const offsets = useRef(new Map<string, Animated.Value>());
  const makingWay = useRef(new Map<string, number>());

  // A live query can render the old order after the drag ends but before its
  // write is read back; the dragged order is kept through that window, or the
  // row snaps back and the drag looks as if it did nothing (Helix's reason).
  useEffect(() => {
    if (dragging.current) return;
    const incoming = items.map(keyOf);
    const local = new Set(orderRef.current.map(keyOf));
    const wanted = pending.current;
    if (!wanted || incoming.length !== local.size || !incoming.every((key) => local.has(key)) || incoming.every((key, index) => key === wanted[index])) {
      pending.current = null;
      setOrder(items);
      return;
    }
    const byKey = new Map(items.map((item) => [keyOf(item), item]));
    setOrder(wanted.flatMap((key) => byKey.get(key) ?? []));
  }, [items, keyOf]);

  useLayoutEffect(() => {
    for (const [key, from] of reducedMotion ? [] : makingWay.current) {
      const offset = offsetOf(key);
      offset.setValue(from);
      Animated.timing(offset, { toValue: 0, duration: motion.standard, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }).start();
    }
    makingWay.current.clear();
  }, [order, reducedMotion]);

  function offsetOf(key: string): Animated.Value {
    let offset = offsets.current.get(key);
    if (!offset) offsets.current.set(key, (offset = new Animated.Value(0)));
    return offset;
  }

  const commit = (next: readonly T[]) => {
    const keys = next.map(latest.current.keyOf);
    const incoming = latest.current.items.map(latest.current.keyOf);
    pending.current = incoming.every((key, index) => key === keys[index]) ? null : keys;
    latest.current.onReorder(keys).catch(() => {
      pending.current = null;
      setOrder(latest.current.items);
      errorNotice();
    });
  };

  const place = (next: readonly T[]) => {
    orderRef.current = next;
    setOrder(next);
    selectionTap();
  };

  const api = useRef({ begin: (_key: string) => {}, move: (_dy: number) => {}, end: () => {} });
  api.current.begin = (key) => {
    const at = orderRef.current.findIndex((item) => keyOf(item) === key);
    if (at < 0 || dragging.current) return;
    dragging.current = { key, at, shift: 0 };
    dragY.setValue(0);
    setActiveKey(key);
    if (reducedMotion) lift.setValue(1);
    else Animated.spring(lift, { toValue: 1, ...motion.spring.entrance, useNativeDriver: nativeDriver }).start();
    mediumImpact();
    latest.current.onDragging(true);
  };
  api.current.move = (dy) => {
    const held = dragging.current;
    if (!held) return;
    const current = orderRef.current;
    const next = follow(current.map((item) => heights.current.get(keyOf(item)) ?? 0), gap, held.at, held.shift, dy);
    if (next.at !== held.at) {
      const reordered = [...current];
      const [moved] = reordered.splice(held.at, 1);
      reordered.splice(next.at, 0, moved!);
      // The rows it crossed step one held row's height the other way.
      const step = ((heights.current.get(held.key) ?? 0) + gap) * Math.sign(next.at - held.at);
      const [low, high] = next.at > held.at ? [held.at, next.at - 1] : [next.at + 1, held.at];
      for (let index = low; index <= high; index += 1) makingWay.current.set(keyOf(reordered[index]!), step);
      dragging.current = { key: held.key, ...next };
      place(reordered);
    }
    dragY.setValue(dy - next.shift);
  };
  api.current.end = () => {
    if (!dragging.current) return;
    dragging.current = null;
    latest.current.onDragging(false);
    const duration = reducedMotion ? 0 : motion.feedback;
    Animated.parallel([
      Animated.timing(dragY, { toValue: 0, duration, easing: Easing.out(Easing.cubic), useNativeDriver: nativeDriver }),
      Animated.timing(lift, { toValue: 0, duration, useNativeDriver: nativeDriver }),
    ]).start(() => setActiveKey(null));
    commit(orderRef.current);
  };

  const moveBy = (key: string, delta: -1 | 1) => {
    if (dragging.current) return;
    const current = orderRef.current;
    const at = current.findIndex((item) => keyOf(item) === key);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= current.length) return;
    const next = [...current];
    [next[at], next[to]] = [next[to]!, next[at]!];
    place(next);
    commit(next);
  };

  return (
    <View style={{ gap, ...LIST_WEB }}>
      {order.map((item, position) => {
        const key = keyOf(item);
        const lifted = activeKey === key;
        return (
          <DraggableRow
            key={key}
            itemKey={key}
            api={api}
            onHeight={(height) => heights.current.set(key, height)}
            style={
              lifted
                ? {
                    zIndex: drag.layer,
                    transform: [{ translateY: dragY }, { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, drag.scale] }) }],
                  }
                : { transform: [{ translateY: offsetOf(key) }] }
            }
          >
            {(panHandlers) => renderRow(item, { panHandlers, lifted, moveUp: () => moveBy(key, -1), moveDown: () => moveBy(key, 1) }, position)}
          </DraggableRow>
        );
      })}
    </View>
  );
}

function DraggableRow({
  itemKey,
  api,
  onHeight,
  style,
  children,
}: {
  itemKey: string;
  api: { current: { begin: (key: string) => void; move: (dy: number) => void; end: () => void } };
  onHeight: (height: number) => void;
  style: object;
  children: (panHandlers: GestureResponderHandlers) => ReactNode;
}) {
  const [pan] = useState(() =>
    PanResponder.create({
      // Taken on the grip before the scroll view can claim it, and never given up.
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => api.current.begin(itemKey),
      onPanResponderMove: (_event, gesture) => api.current.move(gesture.dy),
      onPanResponderRelease: () => api.current.end(),
      onPanResponderTerminate: () => api.current.end(),
    }),
  );
  return (
    <Animated.View onLayout={(event) => onHeight(event.nativeEvent.layout.height)} style={style}>
      {children(pan.panHandlers)}
    </Animated.View>
  );
}

/**
 * The grip a row is dragged by. `adjustable`, because increment and decrement
 * move the row without a drag; the role needs a value, so the row's place is
 * published, which also makes it heard as "3 of 12" (Helix's axe finding).
 */
export function ReorderGrip({ handle, name, position, count }: { handle: DragHandle; name: string; position: number; count: number }) {
  const { palette } = useTheme();
  return (
    <View
      {...handle.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel={tr.items.reorder(name)}
      aria-valuemin={1}
      aria-valuemax={Math.max(count, 1)}
      aria-valuenow={position}
      accessibilityActions={[
        { name: "increment", label: tr.items.moveUp },
        { name: "decrement", label: tr.items.moveDown },
      ]}
      onAccessibilityAction={(event) => (event.nativeEvent.actionName === "increment" ? handle.moveUp() : handle.moveDown())}
      collapsable={false}
      style={{ minWidth: controlSize.minimumTarget, alignSelf: "stretch", alignItems: "center", justifyContent: "center", ...GRIP_WEB }}
    >
      <GripVertical accessible={false} size={iconSize.control} color={palette.textSecondary} />
    </View>
  );
}
