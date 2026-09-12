/**
 * The food record and its tag vocabulary.
 *
 * Lives apart from the seeded `FOOD_LIBRARY` data because the types outlive it:
 * once foods are user-created the data array goes away, but every food the user
 * enters is still a `FoodItem` with these tags.
 */
import type { CatalogItem } from "@/constants/catalog";

/** Which tags a food carries, keyed by `CatalogItem.id`. 1 = yes, 0 = no. */
export type FoodTagMap = Record<string, 0 | 1>;

export interface FoodItem {
  id: string;
  name: string;
  category: string;
  tags: FoodTagMap;
  /**
   * How much of each tag this food carries — 1 Low, 2 Average, 3 High.
   *
   * Keyed by the same `CatalogItem.id` as `tags`, and only meaningful where
   * `tags[id] === 1`. A tag absent from this map is ungraded, which every
   * reader treats as 2: the arithmetic matches a stored default while the
   * export can still say which foods you actually graded.
   *
   * Kept apart from `tags` rather than widening it to more values, because
   * `isItemReferenced` tests `tags[id] === 1` and that narrowness is what
   * keeps a tag deletable once a food has been edited.
   */
  tag_intensity?: Record<string, 1 | 2 | 3>;
  is_elimination_safe: boolean;
  is_custom?: boolean;
  /**
   * Set when the food was deleted while a check-in log still named it. The
   * record has to stay so that log renders a name instead of a raw id, so it
   * is hidden from the picker instead of removed. Optional, and absent means
   * active: every food written before this existed is still selectable.
   */
  isArchived?: boolean;
  /**
   * ISO timestamp of the last local edit — the only thing that lets a restore
   * tell two versions of the same food apart. Without it the merge falls back
   * to local-wins and an edit made on the other phone is lost for good.
   */
  updated_at?: string;
}

export const EMPTY_TAGS: FoodTagMap = {};

/**
 * The categories and tags the app shipped with, as catalog items.
 *
 * Each `id` is the value already written into stored foods, so adopting the
 * catalog rewrites nothing: a food filed under "Grains" keeps pointing at the
 * item whose id is "Grains", and a rename moves only the label.
 */
export const SEED_FOOD_CATEGORIES: CatalogItem[] = [
  "Grains", "Vegetables", "Fruits", "Proteins", "Fats", "Legumes",
  "Dairy", "Beverages", "Condiments", "Sweets", "Snacks",
].map((name, order) => ({ id: name, name, order, isArchived: false }));

export const SEED_FOOD_TAGS: CatalogItem[] = [
  { id: "caffeine",    name: "Caffeine",    icon: "coffee" },
  { id: "dairy",       name: "Dairy",       icon: "cow" },
  { id: "soy",         name: "Soy",         icon: "leaf" },
  { id: "oat",         name: "Oat",         icon: "barley" },
  { id: "high_sugar",  name: "High Sugar",  icon: "cube-outline" },
  { id: "palm_oil",    name: "Palm Oil",    icon: "tree" },
  { id: "gluten",      name: "Gluten",      icon: "grain" },
  { id: "egg",         name: "Egg",         icon: "egg" },
  { id: "fried",       name: "Fried",       icon: "fire" },
  { id: "high_sodium", name: "High Sodium", icon: "shaker-outline" },
  { id: "high_fat",    name: "High Fat",    icon: "water" },
  { id: "spicy",       name: "Spicy",       icon: "chili-hot" },
  { id: "lye",         name: "Lye",         icon: "flask-outline" },
].map((t, order) => ({ ...t, order, isArchived: false }));
