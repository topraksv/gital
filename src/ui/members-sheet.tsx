/**
 * Who a list, a wish collection or the household's Kiler is shared with (SPEC
 * 1.2, 1.4, 7.8, 12.13): its people, and for the owner each one's role, their
 * removal, and a new invitation as a link. Anyone else only reads who is in
 * it; leaving is the screen's, where deleting is for the owner.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Eye from "lucide-react-native/icons/eye";
import Link from "lucide-react-native/icons/link";
import LogOut from "lucide-react-native/icons/log-out";
import Pencil from "lucide-react-native/icons/pencil";
import Share from "lucide-react-native/icons/share";
import Trash from "lucide-react-native/icons/trash";
import UserMinus from "lucide-react-native/icons/user-minus";
import UserPlus from "lucide-react-native/icons/user-plus";
import Users from "lucide-react-native/icons/users";

import { useHeldPantry, useMembers, useSettings, useShoppingTicks } from "../data/hooks";
import { leaveList, removeMember, roleOf, setMemberRole, type Member } from "../data/members";
import type { MemberRole } from "../db/schema";
import { memberNameOf, setMemberName } from "../data/settings";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { announce, nextExpiry, shoppersNow } from "../domain/shopping";
import { kvSwitch } from "../services/kv";
import { shareText } from "../services/share";
import { syncNow } from "../sync/engine";
import { inviteLink, inviteToList, type InviteRole } from "../sync/sharing";
import { useSession } from "../auth/session";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, ChoiceTile, IconButton, Notice, SectionHeader, TextField, Tile } from "./components";
import { radioGroupKeys } from "./keys";
import { Actions, DialogShell, appConfirm, appError } from "./dialog";
import { selectionTap } from "./haptics";
import { navigateBack } from "./navigation";
import { Press } from "./press";
import { interactionSurface } from "./interaction";
import { controlSize, iconSize, iconStroke, itemRow, radius, spacing, type, useTheme } from "./theme";
import { showNotice } from "./undo";

/** This person's part in a list: a viewer reads it and changes nothing (SPEC 1.4). */
export function useShare(listId: string) {
  const userId = useSession((s) => s.userId) ?? "";
  const members = useMembers(listId);
  const role = roleOf(members.data, userId);
  return { members, userId, role, viewer: role === "viewer" };
}

/** What only an editor or the owner is offered; a viewer sees `fallback` in its place. */
export function EditorsOnly({ viewer, fallback = null, children }: { viewer: boolean; fallback?: ReactNode; children: ReactNode }) {
  return viewer ? fallback : children;
}

/** The clock, read apart from the render that asks for it: a run lapsing is the one change no data announces, so the render passes
 * the count of lapses to read it again. */
const clockNow = (_lapse: number) => Date.now();

/**
 * The people shopping the lists this person is in, now (SPEC 1.6), read from
 * ticks. The clock is read again when the data changes and at the earliest
 * lapse, since nothing else changes when a run simply stops.
 */
export function useShoppingNow() {
  const userId = useSession((s) => s.userId) ?? "";
  const ticks = useShoppingTicks(userId).data;
  const [lapse, setLapse] = useState(0);
  const shoppers = useMemo(
    () => shoppersNow(ticks, userId, clockNow(lapse)).map((shopper) => ({ ...shopper, name: shopper.name || tr.sharing.unnamed })),
    [ticks, userId, lapse],
  );
  const expiry = nextExpiry(shoppers);
  useEffect(() => {
    if (expiry == null) return;
    const timer = setTimeout(() => setLapse((n) => n + 1), Math.max(expiry - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [expiry]);
  return shoppers;
}

/**
 * Whether a new run of shopping shows a banner, Ayarlar's switch. On by
 * default, kept on this device like the stay-awake choice: whether this phone
 * is told is its owner's business, not the account's. It hides the banner and
 * nothing else; the list still says who is at the shop.
 */
const notices = kvSwitch("gital.shoppingNotices");

export function useShoppingNoticesAllowed(): boolean {
  return useSyncExternalStore(notices.subscribe, notices.get, notices.get);
}

export const setShoppingNoticesAllowed = notices.set;

/**
 * One banner for each list, person and run: "X alışverişte", for the
 * shoppers `useShoppingNow` gave. Mounted once, by the Lists tab: it is the
 * tabs' first screen and tabs stay mounted under every list and sheet pushed
 * over them, so it watches wherever the person is. A run seen while the
 * switch is off is still counted as told.
 */
export function useShoppingNotices(shoppers: ReturnType<typeof useShoppingNow>): void {
  const told = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const next = announce(shoppers, told.current);
    told.current = next.announced;
    if (notices.get() && next.fresh.length) showNotice(tr.sharing.shoppingNotice(next.fresh.map((shopper) => shopper.name)));
  }, [shoppers]);
}

/** Who else is at the shop with this list now, by the name they gave it. */
export function ShoppersNote({ listId }: { listId: string }) {
  const here = useShoppingNow().filter((shopper) => shopper.listId === listId);
  if (!here.length) return null;
  return <Body muted style={{ marginBottom: spacing.lg }}>{tr.sharing.shopping(here.map((shopper) => shopper.name))}</Body>;
}

/**
 * A shared record's header, after its own actions: its people, the edit the
 * screen passes in, then delete for the owner or leave for anyone else. The
 * server forgets a member who leaves at once; the device lets the list go with
 * the next sync.
 */
export function PeopleActions({
  list,
  userId,
  role,
  back,
  deleteLabel,
  onDelete,
  children,
}: {
  list: { id: string; name: string };
  userId: string;
  role: MemberRole;
  back: "/" | "/wishes";
  deleteLabel: string;
  onDelete: () => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const leave = async () => {
    if (!(await appConfirm(tr.sharing.leaveTitle, tr.sharing.leaveMessage(list.name), tr.sharing.leaveConfirm))) return;
    try {
      await leaveList(list.id, userId);
      showNotice(tr.sharing.left(list.name));
      navigateBack(router, back);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <>
      {/* The owner's sheet is where an invitation is made, so its mark says so; anyone else's only lists the people. */}
      <IconButton icon={role === "owner" ? UserPlus : Users} label={tr.sharing.open(list.name)} onPress={() => setOpen(true)} />
      {children}
      {role === "owner" ? (
        <IconButton icon={Trash} label={deleteLabel} tone="danger" onPress={onDelete} />
      ) : (
        <IconButton icon={LogOut} label={tr.sharing.leave(list.name)} tone="danger" onPress={() => void leave()} />
      )}
      {open ? <MembersSheet list={list} userId={userId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Kiler's people (SPEC 12.13): the household this device holds, whose id is
 * its owner's. The owner invites and removes; a member leaves, and goes on
 * with an empty Kiler of their own. Nobody deletes it, and it has no viewers.
 */
export function HouseholdActions({ userId, children }: { userId: string; children: ReactNode }) {
  const home = useHeldPantry(userId).data[0]?.id ?? userId;
  const [open, setOpen] = useState(false);
  const leave = async () => {
    if (!(await appConfirm(tr.sharing.leaveHousehold, tr.sharing.leaveHouseholdMessage, tr.sharing.leaveConfirm))) return;
    try {
      await leaveList(home, userId);
      showNotice(tr.sharing.leftHousehold);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };
  return (
    <>
      <IconButton icon={home === userId ? UserPlus : Users} label={tr.sharing.open(tr.tabs.pantry)} onPress={() => setOpen(true)} />
      {children}
      {home === userId ? null : <IconButton icon={LogOut} label={tr.sharing.leaveHousehold} tone="danger" onPress={() => void leave()} />}
      {open ? <MembersSheet list={{ id: home, name: tr.tabs.pantry }} userId={userId} household onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MembersSheet({ list, userId, household = false, onClose }: { list: { id: string; name: string }; userId: string; household?: boolean; onClose: () => void }) {
  const titleRef = useModalAccessibility(true, list.id);
  const members = useMembers(list.id);
  // A household's owner is the person whose id it is, even before anyone is in it.
  const owner = household ? list.id === userId : roleOf(members.data, userId) === "owner";
  const router = useRouter();
  const openPerson = (member: Member) => {
    onClose();
    router.push({ pathname: "/person/[id]", params: { id: member.userId, list: list.id, name: member.name } });
  };
  return (
    <DialogShell title={tr.sharing.title} titleRef={titleRef} onDismiss={onClose}>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {members.updatedAt != null && members.data.length === 0 ? <Body muted>{tr.sharing.alone}</Body> : null}
        {members.data.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            me={member.userId === userId}
            manage={owner && member.role !== "owner"}
            roles={!household}
            onOpen={member.userId === userId ? undefined : () => openPerson(member)}
          />
        ))}
      </View>
      {owner ? <Invite list={list} household={household} /> : null}
      <Actions>
        <Button label={tr.common.done} size="sm" onPress={onClose} />
      </Actions>
    </DialogShell>
  );
}

/** `onOpen` is the person's access to what this person owns (SPEC 1.4), for anyone but oneself. */
function MemberRow({ member, me, manage, roles, onOpen }: { member: Member; me: boolean; manage: boolean; roles: boolean; onOpen?: () => void }) {
  const { palette } = useTheme();
  const name = member.name || tr.sharing.unnamed;
  const act = (work: () => Promise<void>) => () =>
    work().then(selectionTap, () => appError(tr.errors.saveFailed));
  const remove = async () => {
    if (!(await appConfirm(tr.sharing.removeTitle, tr.sharing.removeMessage(name), tr.sharing.removeConfirm))) return;
    await removeMember(member.id);
  };
  const viewer = member.role === "viewer";
  const who = (
    <>
      <Tile id={member.userId} name={name} size={itemRow.tile} round />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.body, { color: palette.textStrong }]}>
          {me ? tr.sharing.you(name) : name}
        </Text>
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.sharing.roles[member.role]}</Text>
      </View>
    </>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      {onOpen ? (
        <Press
          accessibilityRole="button"
          accessibilityLabel={tr.sharing.openPerson(name)}
          onPress={onOpen}
          style={(state) => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.sm, ...interactionSurface(palette, state) })}
        >
          {who}
          <ChevronRight accessible={false} size={iconSize.control} color={palette.textSecondary} strokeWidth={iconStroke.regular} />
        </Press>
      ) : (
        who
      )}
      {manage ? (
        <>
          {roles ? (
            <IconButton
              icon={viewer ? Pencil : Eye}
              label={viewer ? tr.sharing.makeEditor(name) : tr.sharing.makeViewer(name)}
              onPress={act(() => setMemberRole(member.id, viewer ? "editor" : "viewer"))}
            />
          ) : null}
          <IconButton icon={UserMinus} label={tr.sharing.remove(name)} tone="danger" onPress={act(remove)} />
        </>
      ) : null}
    </View>
  );
}

/**
 * One link for one person, made on the server. Everything it asks or answers
 * stays inside the sheet: a prompt or an alert opened over this modal did not
 * show in Expo Go, and the button seemed to do nothing. The list is sent only
 * when the server says it does not hold it yet.
 */
function Invite({ list, household }: { list: { id: string; name: string }; household: boolean }) {
  const { palette } = useTheme();
  const userId = useSession((s) => s.userId);
  const known = memberNameOf(useSettings().data);
  const [typed, setTyped] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = known ?? typed.trim();

  const create = async () => {
    setBusy(true);
    setRefused(null);
    try {
      if (!known) await setMemberName(name);
      const made = await inviteToList(list.id, role, name, () => (userId ? syncNow(userId) : Promise.resolve()));
      if ("refused" in made) return setRefused(made.refused);
      selectionTap();
      setLink(inviteLink(made.token));
    } catch {
      setRefused(tr.sharing.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const share = async (url: string) => {
    try {
      const text = household ? tr.sharing.householdInviteText(url) : tr.sharing.inviteText(list.name, url);
      if ((await shareText(text)) === "clipboard") showNotice(tr.sharing.inviteCopied);
    } catch {
      void appError(tr.errors.shareFailed);
    }
  };

  const choose = (next: InviteRole) => {
    setRole(next);
    // A link already made carries the role it was made with.
    setLink(null);
  };

  return (
    <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
      <SectionHeader>{household ? tr.sharing.inviteHousehold : tr.sharing.invite}</SectionHeader>
      {/* Everyone in a household keeps it: it has no one who only looks. */}
      {household ? null : (
        <View role="radiogroup" {...radioGroupKeys()} accessibilityLabel={tr.sharing.inviteRole} style={{ flexDirection: "row", gap: spacing.sm }}>
          {(["editor", "viewer"] as const).map((choice) => (
            <ChoiceTile
              key={choice}
              label={tr.sharing.roles[choice]}
              selected={role === choice}
              minHeight={controlSize.minimumTarget}
              onPress={() => choose(choice)}
            />
          ))}
        </View>
      )}
      <Body muted>{tr.sharing.inviteHint}</Body>
      {known ? null : (
        <TextField label={tr.sharing.nameTitle} value={typed} onChangeText={setTyped} maxLength={NAME_MAX} examples={tr.placeholders.memberName} />
      )}
      {refused ? <Notice tone="error" text={refused} /> : null}
      {link ? (
        <View style={{ gap: spacing.sm }}>
          <Text selectable numberOfLines={1} ellipsizeMode="middle" style={[type.small, { color: palette.textSecondary, backgroundColor: palette.surfaceAlt, borderRadius: radius.sm, padding: spacing.md }]}>
            {link}
          </Text>
          <Button label={tr.sharing.inviteShare} icon={Share} onPress={() => share(link)} />
        </View>
      ) : (
        <Button label={tr.sharing.inviteCreate} icon={Link} loading={busy} disabled={busy || name === ""} onPress={create} />
      )}
    </View>
  );
}
