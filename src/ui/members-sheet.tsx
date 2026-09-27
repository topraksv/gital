/**
 * Who a list or a wish collection is shared with (SPEC 1.2, 1.4, 7.8): its
 * people, and for the owner each one's role, their removal, and a new
 * invitation as a link and a QR code. Anyone else only reads who is in it;
 * leaving is the screen's, where deleting is for the owner.
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

import { useMembers } from "../data/hooks";
import { leaveList, removeMember, roleOf, setMemberRole, type Member } from "../data/members";
import type { MemberRole } from "../db/schema";
import { memberNameOf, readSettings, setMemberName } from "../data/settings";
import { NAME_MAX } from "../domain/names";
import { tr } from "../i18n/tr";
import { shareText } from "../services/share";
import { setShopping, useShoppers } from "../sync/live";
import { createInvite, inviteLink, type InviteRole } from "../sync/sharing";
import { useSession } from "../auth/session";
import { useModalAccessibility } from "./accessibility";
import { Body, Button, ChoiceTile, IconButton, SectionHeader, Tile } from "./components";
import { radioGroupKeys } from "./keys";
import { Actions, DialogShell, appConfirm, appError, appPrompt } from "./dialog";
import { selectionTap } from "./haptics";
import { navigateBack } from "./navigation";
import { controlSize, itemRow, qrCode, spacing, type, useTheme } from "./theme";
import { showNotice } from "./undo";

type QrCode = typeof import("./qr-code").default;
const loadQr = () => import("./qr-code").then((module) => module.default);

/** The name the others see, asked for the first time it is needed and then kept on every device. */
export async function memberName(): Promise<string | null> {
  const known = memberNameOf(await readSettings());
  if (known) return known;
  const typed = await appPrompt(tr.sharing.nameTitle, tr.sharing.nameMessage, {
    confirmLabel: tr.common.save,
    placeholder: tr.sharing.namePlaceholder,
    maxLength: NAME_MAX,
  });
  if (typed == null || typed.trim() === "") return null;
  await setMemberName(typed);
  return memberNameOf(await readSettings());
}

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

function MembersSheet({ list, userId, onClose }: { list: { id: string; name: string }; userId: string; onClose: () => void }) {
  const titleRef = useModalAccessibility(true, list.id);
  const members = useMembers(list.id);
  const owner = roleOf(members.data, userId) === "owner";
  return (
    <DialogShell title={tr.sharing.title} titleRef={titleRef} onDismiss={onClose}>
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {members.updatedAt != null && members.data.length === 0 ? <Body muted>{tr.sharing.alone}</Body> : null}
        {members.data.map((member) => (
          <MemberRow key={member.id} member={member} me={member.userId === userId} manage={owner && member.role !== "owner"} />
        ))}
      </View>
      {owner ? <Invite list={list} /> : null}
      <Actions>
        <Button label={tr.common.done} size="sm" onPress={onClose} />
      </Actions>
    </DialogShell>
  );
}

function MemberRow({ member, me, manage }: { member: Member; me: boolean; manage: boolean }) {
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
          <IconButton
            icon={viewer ? Pencil : Eye}
            label={viewer ? tr.sharing.makeEditor(name) : tr.sharing.makeViewer(name)}
            onPress={act(() => setMemberRole(member.id, viewer ? "editor" : "viewer"))}
          />
          <IconButton icon={UserMinus} label={tr.sharing.remove(name)} tone="danger" onPress={act(remove)} />
        </>
      ) : null}
    </View>
  );
}

/** One link for one person, made on the server; the QR code is the same link for a phone beside this one. */
function Invite({ list }: { list: { id: string; name: string } }) {
  const [role, setRole] = useState<InviteRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [Qr, setQr] = useState<QrCode | null>(null);
  useEffect(() => {
    if (!link) return;
    let live = true;
    loadQr().then(
      (component) => live && setQr(() => component),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [link]);

  const create = async () => {
    setBusy(true);
    try {
      const name = await memberName();
      if (name == null) return;
      const made = await createInvite(list.id, role, name);
      if ("refused" in made) return void appError(made.refused);
      selectionTap();
      setLink(inviteLink(made.token));
    } catch {
      void appError(tr.sharing.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  const share = async (url: string) => {
    try {
      if ((await shareText(tr.sharing.inviteText(list.name, url))) === "clipboard") showNotice(tr.sharing.inviteCopied);
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
      <SectionHeader>{tr.sharing.invite}</SectionHeader>
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
      <Body muted>{tr.sharing.inviteHint}</Body>
      {link ? (
        <View style={{ alignItems: "center", gap: spacing.md }}>
          {Qr ? <Qr text={link} label={tr.sharing.qr} /> : <View style={{ width: qrCode.size, height: qrCode.size }} />}
          <Button label={tr.sharing.inviteShare} icon={Share2} onPress={() => share(link)} />
        </View>
      ) : (
        <Button label={tr.sharing.inviteCreate} icon={Link} disabled={busy} onPress={create} />
      )}
    </View>
  );
}
