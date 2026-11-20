const photo = name => `/media/${name}.jpg`;

export const collections = [
  ["lamps", "Lamps & diyas"],
  ["incense", "Incense"],
  ["wicks", "Wicks"],
  ["brassware", "Brassware"],
  ["cloth", "Cloth"],
  ["packages", "Packages"]
].map(([slug, name]) => ({
  slug, name, image: photo(`category-${slug}`), thumbnail: photo(slug === "packages" ? "category-packages" : `icon-${slug}`)
}));

function item(id, name, category, image, options) {
  const { price, stock, pack, variants = [], ...details } = options;
  return {
    id, slug: id, name, category, image: photo(image), active: true, ...details,
    variants: [
      { id, packSize: pack, pricePaise: price * 100, stock },
      ...variants.map(([suffix, packSize, amount, stock]) => ({
        id: `${id}-${suffix}`, packSize, pricePaise: amount * 100, stock
      }))
    ]
  };
}

export const products = [
  item("brass-lotus-diya", "Brass Lotus Diya", "lamps", "brass-lotus", {
    pack: "1 pc", price: 499, stock: 18, material: "Brass", tags: ["brass"],
    bengali: "প্রদীপ", aliases: ["brass lamp", "puja lamp", "arati", "puja accessories"]
  }),
  item("brass-panchapradip", "Brass Panchapradip", "lamps", "brass-panchapradip", {
    pack: "5 wick", price: 1299, stock: 12, material: "Brass", tags: ["brass", "panchapradip"],
    aliases: ["five wick", "pancha pradip", "brass lamp", "arati"]
  }),
  item("clay-lamps", "Terracotta Diya", "lamps", "terracotta-diya", {
    pack: "Set of 6", price: 179, stock: 18, material: "Terracotta", tags: ["terracotta"],
    bengali: "মাটির প্রদীপ", aliases: ["clay lamps", "mitti diya", "puja lamp"]
  }),
  item("brass-hanging-diya", "Brass Hanging Diya", "lamps", "brass-hanging", {
    pack: "1 pc", price: 899, stock: 0, material: "Brass", tags: ["brass", "hanging"],
    aliases: ["brass lamp", "puja lamp", "hanging lamp"]
  }),
  item("brass-pradip", "Brass Pradip", "lamps", "brass-pradip", {
    pack: "1 pc", price: 395, stock: 20, material: "Brass", tags: ["brass"],
    bengali: "প্রদীপ", aliases: ["brass lamp", "puja lamp", "arati"],
    variants: [["pair", "Set of 2", 749, 8]],
    description: "A traditional brass oil lamp for daily puja. Let it cool before cleaning and wipe it dry after use."
  }),
  item("chandan-incense", "Chandan Incense Sticks", "incense", "chandan-incense", {
    pack: "50 g", price: 159, stock: 24, material: "Sandalwood fragrance",
    bengali: "চন্দন ধূপ", aliases: ["chandan incense", "chandan agarbatti", "sandalwood", "dhup"]
  }),
  item("chandan-dhoop", "Chandan Dhoop Cones", "incense", "chandan-dhoop", {
    pack: "Set of 12", price: 199, stock: 15, material: "Sandalwood fragrance",
    aliases: ["chandan dhoop", "sandalwood", "dhup"]
  }),
  item("chandan-powder", "Chandan Powder", "incense", "chandan-powder", {
    pack: "100 g", price: 249, stock: 14, material: "Sandalwood powder",
    aliases: ["chandan powder", "sandalwood"]
  }),
  item("morning-incense", "Incense Sticks", "incense", "category-incense", {
    pack: "12 sticks", price: 85, stock: 32, material: "Incense", bengali: "ধূপ",
    aliases: ["morning incense", "dhup", "agarbatti"]
  }),
  item("cotton-wicks", "Cotton Wicks", "wicks", "cotton-wicks", {
    pack: "100 pcs", price: 85, stock: 24, material: "Cotton", bengali: "সলতে",
    aliases: ["solte", "wick", "cotton batti"], variants: [["large", "200 pcs", 155, 12]]
  }),
  item("brass-bell", "Brass Bell", "brassware", "brass-bell", {
    pack: "1 pc", price: 595, stock: 12, material: "Brass", aliases: ["ghanta", "puja accessories"]
  }),
  item("gamcha", "Gamcha", "cloth", "gamcha", {
    pack: "Cotton, red border", price: 175, stock: 18, material: "Cotton",
    bengali: "গামছা", aliases: ["ritual cloth", "puja cloth"]
  })
];

const contents = [
  { name: "Cotton Wicks", unit: "50 pcs", image: photo("icon-wicks") },
  { name: "Incense Sticks", unit: "1 pack", image: photo("icon-incense") },
  { name: "Camphor", unit: "25 g", icon: "box" },
  { name: "Sindoor", unit: "10 g", icon: "lotus" }
];
export const plans = [
  {
    id: "weekly-puja", slug: "weekly-puja", name: "Weekly Plan", cadence: "weekly",
    drops: 4, intervalDays: 7, pricePaise: 48000, total: "₹480", duration: "1 month",
    items: contents, firstDrop: { "cotton-wicks": 1, "morning-incense": 1, camphor: 1, sindoor: 1 },
    contents: "Cotton wicks, incense, camphor and sindoor in each drop"
  },
  {
    id: "monthly-puja", slug: "monthly-puja", name: "Monthly Plan", cadence: "monthly",
    drops: 4, pricePaise: 180000, total: "₹1,800", duration: "4 months",
    items: [
      { ...contents[0], unit: "100 pcs" }, { ...contents[1], unit: "2 packs" },
      { name: "Terracotta Diyas", unit: "Set of 6", image: photo("icon-lamps") }, ...contents.slice(2)
    ],
    firstDrop: { "cotton-wicks": 1, "morning-incense": 2, "clay-lamps": 1, camphor: 1, sindoor: 1 },
    contents: "Cotton wicks, incense, diyas, camphor and sindoor in each drop"
  }
].map(plan => ({ ...plan, image: photo("package-contents") }));

export const popular = ["brass-lotus-diya", "chandan-incense", "cotton-wicks", "brass-pradip"];
export const coverage = Object.fromEntries([
  ["700001", "B.B.D. Bagh"], ["700019", "Ballygunge"], ["700020", "Bhawanipore"],
  ["700026", "Kalighat"], ["700027", "Alipore"], ["700029", "Ballygunge"],
  ["700046", "Topsia"], ["700053", "New Alipore"], ["700068", "Jodhpur Park"],
  ["700071", "Chowringhee"], ["700091", "Salt Lake"], ["700099", "Mukundapur", "paused"],
  ["700107", "Kasba"], ["700150", "Sonarpur"]
].map(([pin, locality, status = "eligible"]) => [pin, { pin, locality, status }]));

