/**
 * The KVKK notice (SPEC 9.1), Helix's `privacy.tsx`, on a route that opens
 * before an account exists: the screen that asks for an e-mail address is the
 * one that has to say what happens to it. Sign-up pushes it rather than
 * opening a sheet, since the form stays mounted under a pushed screen; opened
 * from there, its end carries the consent the form waits for.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import Check from "lucide-react-native/icons/check";
import { Text, View } from "react-native";

import { useSession } from "../auth/session";
import { tr } from "../i18n/tr";
import { Body, Button, Screen, SectionHeader } from "../ui/components";
import { navigateBack } from "../ui/navigation";
import { font, spacing, type, useTheme } from "../ui/theme";

const { legal } = tr;

/** A line whose `**lead:**` is set in the semibold face. */
function Entry({ text }: { text: string }) {
  const [, lead, rest] = /^\*\*(.+?)\*\*(.*)$/s.exec(text) ?? [null, null, text];
  return (
    <Body style={{ marginBottom: spacing.sm }}>
      {lead ? <Text style={{ fontFamily: font.semibold }}>{lead}</Text> : null}
      {rest}
    </Body>
  );
}

function Section({ title, intro, entries }: { title: string; intro?: string; entries: readonly string[] }) {
  return (
    <>
      <SectionHeader>{title}</SectionHeader>
      {intro ? <Body style={{ marginBottom: spacing.sm }}>{intro}</Body> : null}
      {entries.map((entry) => (
        <Entry key={entry} text={entry} />
      ))}
    </>
  );
}

export default function PrivacyScreen() {
  const { palette } = useTheme();
  const router = useRouter();
  const signedIn = useSession((s) => s.userId != null);
  const asksConsent = useLocalSearchParams<{ consent?: string }>().consent === "1";
  const back = signedIn ? "/settings" : "/sign-in";

  const accept = () => {
    useSession.setState({ consented: true });
    navigateBack(router, back);
  };

  return (
    <Screen back={back} title={legal.title} width="form">
      <Text style={[type.small, { color: palette.textSecondary, marginBottom: spacing.md }]}>{legal.updated}</Text>
      <Body>{legal.intro}</Body>
      <Section title={legal.controllerTitle} entries={[legal.controllerBody(legal.controllerName, legal.contactEmail)]} />
      <Section title={legal.collectedTitle} intro={legal.collectedIntro} entries={legal.collected} />
      <Section title={legal.methodTitle} entries={[legal.methodBody]} />
      <Section title={legal.purposeTitle} entries={legal.purposes} />
      <Section title={legal.transferTitle} intro={legal.transferIntro} entries={[...legal.transfers, legal.transferNote]} />
      <Section title={legal.retentionTitle} entries={legal.retention} />
      <Section title={legal.rightsTitle} intro={legal.rightsIntro} entries={legal.rights.map((right, at) => `${at + 1}. ${right}`)} />
      <Section title={legal.selfServiceTitle} entries={legal.selfService} />
      <Section title={legal.contactTitle} entries={[legal.contactBody(legal.contactEmail)]} />
      <Body muted style={{ marginTop: spacing.lg }}>{legal.disclaimer}</Body>
      {asksConsent ? (
        <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
          <Body>{legal.acceptLabel}</Body>
          <Button label={legal.accept} icon={Check} onPress={accept} />
        </View>
      ) : null}
    </Screen>
  );
}
