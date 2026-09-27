/**
 * The KVKK notice (SPEC 9.1) where Ayarlar and feedback reach it, on a route
 * that opens before an account exists. Only the route: the text and its shape
 * are `LegalNoticeBody`, shared with the sheet sign-up opens, so the copy read
 * before consenting and this one cannot drift apart.
 */

import { useSession } from "../auth/session";
import { Screen } from "../ui/components";
import { LegalNoticeBody } from "../ui/legal-notice";

export default function PrivacyScreen() {
  const signedIn = useSession((s) => s.userId != null);
  return (
    <Screen back={signedIn ? "/settings" : "/sign-in"} width="form">
      <LegalNoticeBody />
    </Screen>
  );
}
