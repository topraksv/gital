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
- A list holds items: one field adds them, reading "2 kg domates, 1,5 lt süt
  ve ekmek" as three with their quantities, typed or dictated ("iki kilo
  domates ve bir de süt"), and a product added twice stays one row.
- Ticking an item strikes it through and moves it to a "Sepette" group under
  the rest, with the shop's progress above; its panel renames it, steps its
  quantity and deletes it, and the delete can be taken back. Renamed to a
  product already on the list, it joins that one.
- Each list card on Listeler says how many items it holds and how far the
  shop has got.
- On the phone, swiping an item right ticks it or takes the tick back, and
  swiping it left deletes it, with undo; the circle and the item panel do the
  same everywhere.
- A list's basket ends in "Alışverişi Bitir": what is in it is filed as a
  finished shop and leaves the list, what was not bought stays, and the bar
  takes it back for six seconds.
- Geçmiş lists finished shops, newest first; each opens to what it bought,
  and any item goes back onto its list with its quantity in one tap.
- On a wide screen, Listeler, a list and Geçmiş take the same width as the
  other tabs, so the page no longer narrows when you switch to them.
- Typing a product in a list's field offers what the household had before
  as chips under it — `sut` finds Süt, and `pe` finds Beyaz peynir too; one
  tap adds it with the quantity typed, and the keyboard stays up.
- An item's panel takes a note or a brand ("Pınar olsun"), shown under its
  name, and an "Acil" switch that lifts it to the top of the list and marks
  it in red; a product added again comes back without either.
- An item can be marked "Bulunamadı": it stays on the list, drops below the
  rest and says so in orange until it is ticked. Once not found, or in the
  basket, its panel takes what was bought instead ("Yerine: Sütaş"), which
  puts it in the basket and stays in Geçmiş; taking the tick back forgets it.
- An item's panel sends it to another list, or with "Bu listede de kalsın"
  a copy: it lands on top there, or joins the same product already on that
  list, and the bar takes the save back for six seconds.
- A list's header shares what is still to buy as text — its name, then a
  line per item, quantity first — to any app the phone offers; a browser
  without a share sheet copies it.
- A list's and a finished shop's title sit on their own line under the back
  button, so a long name no longer breaks mid-word beside the buttons.
- A list's header takes a pasted list: Gital's own shared text comes back
  with its notes and urgency, a list typed with bullets loses its heading,
  and plain lines read as the quick-add field reads them; the bar takes the
  paste back.
- A list takes a colour of its own and a picture from twenty drawings, chosen
  in the panel its pencil now opens beside the name; its cards on Listeler
  and Geçmiş wear both.
- A bought item takes what was paid for it; the basket adds up the prices so
  far, and each shop in Geçmiş shows what it cost.
- A price or a shop's total can be worked out on Helix's calculator, opened
  from the field, and a shop's total can be corrected to its receipt.
- A price typed a tenth or more above what the product recently cost is
  labelled so under its field ("Son alışlardan %22 pahalı").
- A list offers what its own history says has run out ("Süt · 5 günde
  bir") under the empty add field; a tap puts it back with its last quantity.
- Finishing a shop is celebrated: confetti, and a card with what was bought,
  what it cost counting up, what stayed on the list and the month so far. A
  tap skips it, and taking the finish back closes it.
- An item's panel says when the product was last bought on any list, what it
  cost then, and its last three prices.
- The web app installs to a phone's home screen with its own icon, the Noto
  shopping cart, and opens without a connection once it has been opened once.
- A list's items can be sorted: "Sırala" puts a grip on each row to drag it
  by, and the order stays; urgent items stay on top while sorting.
- İstekler keeps wishes in collections of your own: a name, or a link pasted
  from Trendyol, Hepsiburada or Amazon; each wish takes a priority, a
  guessed price and several shops' links with their prices, leads with the
  cheapest, and the collection says what the open wishes come to.
- The first open plays a five-step tour of what Gital does; Ayarlar plays it
  again.
- On the web, Space ticks an item or a wish and flips a switch, and the arrow
  keys move a row while sorting; an item's and a wish's circle now tell a
  screen reader whether they are ticked, which they never did on the web.
- Geçmiş opens on six months' totals as bars, the finish card's month rises
  as the same bars, an item's panel draws its last prices as a line, and a
  list's card fills a ring as its items go into the basket.
- On the web, the keyboard's focus ring is the palette's own, follows each
  control's rounded corners, and no longer shows as a square around a header
  button or a thin browser line clipped by a list card.
- A product added again pulses its row once, and the basket's subtotal and a
  collection's total count to their new figure instead of jumping.
- Gital knows about 350 everyday products: an item named after one wears
  its picture, and typing offers them beside what the household had before,
  finding süt from "sut" and domates from "domtes".
- The grid button beside the add field opens the catalogue an aisle at a
  time: a tap puts a product on the list, a second tap takes it off.
