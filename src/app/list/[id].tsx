import { useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import DatabaseZap from "lucide-react-native/icons/database-zap";
import ListPlus from "lucide-react-native/icons/list-plus";
import Pencil from "lucide-react-native/icons/pencil";
import Trash from "lucide-react-native/icons/trash";

import { useLists } from "../../data/hooks";
import { deleteList, renameList, restoreList, type ListSummary } from "../../data/lists";
import { LIST_NAME_MAX } from "../../domain/lists";
import { tr } from "../../i18n/tr";
import { Button, EmptyState, IconButton, Screen } from "../../ui/components";
import { appError, appPrompt } from "../../ui/dialog";
import { mediumImpact } from "../../ui/haptics";
import { navigateBack } from "../../ui/navigation";
import { showUndo } from "../../ui/undo";

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const lists = useLists();
  // The list this screen is deleting, held so its title stays while the screen
  // animates away, and so nothing on it can be pressed a second time.
  const [leaving, setLeaving] = useState<ListSummary | null>(null);
  const list = leaving ?? lists.data.find((candidate) => candidate.id === id);

  // A link to a list that is not here — deleted elsewhere, or never existed.
  if (lists.updatedAt != null && !list) return <Redirect href="/" />;

  const rename = async (current: ListSummary) => {
    const name = await appPrompt(tr.lists.renameTitle, tr.lists.renameMessage, {
      initialValue: current.name,
      confirmLabel: tr.common.save,
      maxLength: LIST_NAME_MAX,
    });
    if (name == null) return;
    try {
      await renameList(current.id, name);
    } catch {
      void appError(tr.errors.saveFailed);
    }
  };

  const remove = async (current: ListSummary) => {
    setLeaving(current);
    mediumImpact();
    try {
      const snapshot = await deleteList(current.id);
      if (snapshot) showUndo(tr.lists.deleted(current.name), () => restoreList(snapshot));
      navigateBack(router, "/");
    } catch {
      setLeaving(null);
      void appError(tr.errors.deleteFailed);
    }
  };

  return (
    <Screen
      back="/"
      title={list?.name}
      actions={
        list && !leaving ? (
          <>
            <IconButton icon={Pencil} label={tr.lists.rename(list.name)} onPress={() => rename(list)} />
            <IconButton icon={Trash} label={tr.lists.delete(list.name)} tone="danger" onPress={() => remove(list)} />
          </>
        ) : null
      }
    >
      {lists.status === "error" ? (
        <EmptyState
          icon={DatabaseZap}
          title={tr.errors.readFailedTitle}
          hint={tr.errors.readFailedHint}
          action={<Button label={tr.common.retry} onPress={lists.retry} />}
        />
      ) : list ? (
        <EmptyState icon={ListPlus} title={tr.lists.itemsEmptyTitle} hint={tr.lists.itemsEmptyHint} />
      ) : null}
    </Screen>
  );
}
