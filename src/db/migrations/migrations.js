// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_lists.sql';
import m0001 from './0001_items.sql';
import m0002 from './0002_shops.sql';
import m0003 from './0003_item_note_urgent.sql';
import m0004 from './0004_item_not_found.sql';
import m0005 from './0005_list_look.sql';
import m0006 from './0006_item_price.sql';
import m0007 from './0007_shop_total.sql';
import m0008 from './0008_wishes.sql';
import m0009 from './0009_pantry.sql';
import m0010 from './0010_list_pantry.sql';
import m0011 from './0011_pantry_expiry.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008,
m0009,
m0010,
m0011
    }
  }
  