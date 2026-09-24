# Changelog

One section per released version, newest first, a sentence per bullet: what
changed, and the symptom if it was a defect. `scripts/release-notes.mjs` turns a
section into the GitHub Release for its tag, so a version without a section
cannot be released.

## Unreleased

- The project stands up as Gital: the two repositories, CI, the release
  workflow, the Supabase heartbeat and the planning documents. No app yet.
- The Supabase project's configuration and the heartbeat's table, the EAS
  project and `expo-updates`, so each delivery surface has a target.
- The first screens: five tabs (Listeler, Kiler, İstekler, Geçmiş, Ayarlar)
  on Helix's floating tab bar, still empty apart from Ayarlar.
- Ayarlar chooses the theme (Sistem, Açık, Koyu) and one of Helix's three
  palettes (Amber, Petrol, Servi); the choice stays on the device and the
  first frame already wears it.
- Listeler makes, renames and deletes lists; a delete can be taken back from
  the bar that confirms it for six seconds.
- Lists are kept in a database on the device, so they are there offline and
  after a restart; nothing leaves the device yet.
