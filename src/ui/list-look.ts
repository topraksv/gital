/**
 * The file each list picture name draws (`src/domain/lists.ts`): Noto Emoji 2D
 * at 100 pixels, a 46-point tile's 72% at three times, as WebP (SPEC 14.1).
 * Files inside the app, so a list draws offline (`docs/ARCHITECTURE.md`).
 */

import type { ImageSourcePropType } from "react-native";

import type { ListIcon } from "../domain/lists";

export const LIST_PICTURES: Record<ListIcon, ImageSourcePropType> = {
  cart: require("../../assets/noto/cart.webp"),
  vegetables: require("../../assets/noto/vegetables.webp"),
  fruit: require("../../assets/noto/fruit.webp"),
  bakery: require("../../assets/noto/bakery.webp"),
  breakfast: require("../../assets/noto/breakfast.webp"),
  meat: require("../../assets/noto/meat.webp"),
  fish: require("../../assets/noto/fish.webp"),
  coffee: require("../../assets/noto/coffee.webp"),
  dessert: require("../../assets/noto/dessert.webp"),
  care: require("../../assets/noto/care.webp"),
  cleaning: require("../../assets/noto/cleaning.webp"),
  laundry: require("../../assets/noto/laundry.webp"),
  pharmacy: require("../../assets/noto/pharmacy.webp"),
  baby: require("../../assets/noto/baby.webp"),
  pet: require("../../assets/noto/pet.webp"),
  home: require("../../assets/noto/home.webp"),
  hardware: require("../../assets/noto/hardware.webp"),
  garden: require("../../assets/noto/garden.webp"),
  gift: require("../../assets/noto/gift.webp"),
  party: require("../../assets/noto/party.webp"),
};
