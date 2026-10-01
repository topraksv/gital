/**
 * Who a list, a wish collection or the household's Kiler is shared with (SPEC
 * 1.2, 1.4, 7.8, 12.13): its people, and for the owner each one's role, their
 * removal, and a new invitation as a link. Anyone else only reads who is in
 * it; leaving is the screen's, where deleting is for the owner.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import Eye from "lucide-react-native/icons/eye";
import Link from "lucide-react-native/icons/link";
import LogOut from "lucide-react-native/icons/log-out";
import Pencil from "lucide-react-native/icons/pencil";
import Share2 from "lucide-react-native/icons/share-2";
import Trash from "lucide-react-native/icons/trash";
import UserMinus from "lucide-react-native/icons/user-minus";
import Users from "lucide-react-native/icons/users";

import { useHeldPantry, useMembers, useSettings } from "../data/hooks";
import { leaveList, removeMember, roleOf, setMemberRole, type Member } from "../data/members";
import type { MemberRole } from "../db/schema";
import { memberNameOf, setMemberName } from "../data/settings";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { shareText } from "../services/share";
import { setShopping, useShoppers } from "../sync/live";
import { syncNow } from "../sync/engine";
import { inviteLink, inviteToList, type InviteRole } from "../sync/sharing";
import { useSession } from "../auth/session";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, ChoiceTile, IconButton, Notice, SectionHeader, TextField, Tile } from "./components";
import { radioGroupKeys } from "./keys";
import { Actions, DialogShell, appConfirm, appError } from "./dialog";
import { selectionTap } from "./haptics";
import { navigateBack } from "./navigation";
import { controlSize, itemRow, radius, spacing, type, useTheme } from "./theme";
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

/** Says on a shared list's channel that this person is shopping it, while `shopping` holds (SPEC 1.6). */
export function useShoppingHere(listId: string, shopping: boolean, viewer: boolean) {
  const on = shopping && !viewer;
  useEffect(() => {
    if (!on) return;
    setShopping(listId);
    return () => setShopping(null);
  }, [listId, on]);
}

/** Who else is at the shop with this list now, by the name they gave it. */
export function ShoppersNote({ listId, members }: { listId: string; members: readonly Member[] }) {
  const here = useShoppers((s) => s.byList[listId]);
  if (!here?.length) return null;
  const names = here.map((userId) => members.find((member) => member.userId === userId)?.name || tr.sharing.unnamed);
  return <Body muted style={{ marginBottom: spacing.lg }}>{tr.sharing.shopping(names)}</Body>;
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
      <IconButton icon={Users} label={tr.sharing.open(list.name)} onPress={() => setOpen(true)} />
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
      <IconButton icon={Users} label={tr.sharing.open(tr.tabs.pantry)} onPress={() => setOpen(true)} />
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
  return (
    <DialogShell title={tr.sharing.title} titleRef={titleRef} onDismiss={onClose}>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {members.updatedAt != null && members.data.length === 0 ? <Body muted>{tr.sharing.alone}</Body> : null}
        {members.data.map((member) => (
          <MemberRow key={member.id} member={member} me={member.userId === userId} manage={owner && member.role !== "owner"} roles={!household} />
        ))}
      </View>
      {owner ? <Invite list={list} household={household} /> : null}
      <Actions>
        <Button label={tr.common.done} size="sm" onPress={onClose} />
      </Actions>
    </DialogShell>
  );
}

function MemberRow({ member, me, manage, roles }: { member: Member; me: boolean; manage: boolean; roles: boolean }) {
  const { palette } = useTheme();
  const name = member.name || tr.sharing.unnamed;
  const act = (work: () => Promise<void>) => () =>
    work().then(selectionTap, () => appError(tr.errors.saveFailed));
  const remove = async () => {
    if (!(await appConfirm(tr.sharing.removeTitle, tr.sharing.removeMessage(name), tr.sharing.removeConfirm))) return;
    await removeMember(member.id);
  };
  const viewer = member.role === "viewer";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <Tile id={member.userId} name={name} size={itemRow.tile} round />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.body, { color: palette.textStrong }]}>
          {me ? tr.sharing.you(name) : name}
        </Text>
        <Text style={[type.small, { color: palette.textSecondary }]}>{tr.sharing.roles[member.role]}</Text>
      </View>
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
          <Button label={tr.sharing.inviteShare} icon={Share2} onPress={() => share(link)} />
        </View>
      ) : (
        <Button label={tr.sharing.inviteCreate} icon={Link} loading={busy} disabled={busy || name === ""} onPress={create} />
      )}
    </View>
  );
}
