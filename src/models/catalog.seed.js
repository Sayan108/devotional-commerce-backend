import { taxonomy } from "./catalog.entries.js";

const photo = name => name ? "/media/" + name + ".jpg" : "";
export const catalogRevision = "naivedya-bilingual-catalog-v1";

export const collections = taxonomy.map(({ items, image, ...category }) => ({
  ...category, active: true, image: photo(image), thumbnail: photo(image)
}));

export const products = taxonomy.flatMap(({ slug: category, items }) => items.map(
  ([id, name, bengali, description, bengaliDescription, aliases, image]) => ({
    id, slug: id, name, bengali, category, description, bengaliDescription,
    aliases: aliases.split("|"), image: photo(image), active: true,
    variants: [{ id, packSize: null, pricePaise: null, stock: 0 }]
  })
));

export const popular = ["diya", "incense-sticks", "puja-cotton-wicks", "lakshmi-puja-kit"];

export const coverage = Object.fromEntries([
  ["700001", "B.B.D. Bagh"], ["700019", "Ballygunge"], ["700020", "Bhawanipore"],
  ["700026", "Kalighat"], ["700027", "Alipore"], ["700029", "Ballygunge"],
  ["700046", "Topsia"], ["700053", "New Alipore"], ["700068", "Jodhpur Park"],
  ["700071", "Chowringhee"], ["700091", "Salt Lake"], ["700099", "Mukundapur", "paused"],
  ["700107", "Kasba"], ["700150", "Sonarpur"]
].map(([pin, locality, status = "eligible"]) => [pin, { pin, locality, status }]));

