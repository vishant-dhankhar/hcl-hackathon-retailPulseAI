import 'dotenv/config';
import argon2 from 'argon2';
import { db } from '../src/config/database.js';
import { chunkText } from '../src/services/knowledge.service.js';
import type { Role, Tier } from '../src/generated/prisma/enums.js';
// Seed fixtures are explicitly fictional hackathon data. Re-running preserves existing orders and stock.
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12)
  throw new Error('Set DEMO_PASSWORD to at least 12 characters.');
const hash = await argon2.hash(password);
const locations = [
  {
    id: 'store-bengaluru',
    name: 'Indiranagar',
    city: 'Bengaluru',
    address: '100 Feet Road, Indiranagar',
    warehouse: false,
  },
  {
    id: 'store-mumbai',
    name: 'Bandra',
    city: 'Mumbai',
    address: 'Linking Road, Bandra',
    warehouse: false,
  },
  {
    id: 'warehouse-central',
    name: 'Central fulfillment',
    city: 'Bengaluru',
    address: 'Distribution Park',
    warehouse: true,
  },
];
for (const l of locations) await db.location.upsert({ where: { id: l.id }, update: {}, create: l });
const users: { email: string; name: string; role: Role; tier: Tier }[] = [
  { email: 'customer@retailpulse.demo', name: 'Alex Morgan', role: 'CUSTOMER', tier: 'STANDARD' },
  { email: 'silver@retailpulse.demo', name: 'Silver Customer', role: 'CUSTOMER', tier: 'SILVER' },
  { email: 'gold@retailpulse.demo', name: 'Gold Customer', role: 'CUSTOMER', tier: 'GOLD' },
  {
    email: 'platinum@retailpulse.demo',
    name: 'Platinum Customer',
    role: 'CUSTOMER',
    tier: 'PLATINUM',
  },
  {
    email: 'manager@retailpulse.demo',
    name: 'Store Manager',
    role: 'STORE_MANAGER',
    tier: 'STANDARD',
  },
  { email: 'admin@retailpulse.demo', name: 'Platform Admin', role: 'ADMIN', tier: 'STANDARD' },
  {
    email: 'manager.bengaluru@retailpulse.demo',
    name: 'Bengaluru Manager',
    role: 'STORE_MANAGER',
    tier: 'STANDARD',
  },
  {
    email: 'manager.mumbai@retailpulse.demo',
    name: 'Mumbai Manager',
    role: 'STORE_MANAGER',
    tier: 'STANDARD',
  },
  {
    email: 'manager.warehouse@retailpulse.demo',
    name: 'Fulfillment Manager',
    role: 'STORE_MANAGER',
    tier: 'STANDARD',
  },
];
for (const u of users) {
  const user = await db.user.upsert({
    where: { email: u.email },
    update: {},
    create: { ...u, passwordHash: hash },
  });
  const assignedLocation = u.email.includes('.mumbai@')
    ? 'store-mumbai'
    : u.email.includes('.warehouse@')
      ? 'warehouse-central'
      : 'store-bengaluru';
  if (u.role === 'STORE_MANAGER')
    await db.storeAssignment.upsert({
      where: { userId_locationId: { userId: user.id, locationId: assignedLocation } },
      update: {},
      create: { userId: user.id, locationId: assignedLocation },
    });
}
const products = [
  [
    'Everyday wireless headphones',
    'Audio',
    'Sonic',
    2499,
    3499,
    'sage',
    '40 hour battery • active noise cancellation',
  ],
  [
    'Studio over ear headphones',
    'Audio',
    'Sonic',
    5999,
    7999,
    'cream',
    '60 hour battery • studio sound',
  ],
  ['Pocket Bluetooth speaker', 'Audio', 'Echo', 1799, 2499, 'peach', 'IP67 • 12 hour playtime'],
  ['Home smart speaker', 'Audio', 'Echo', 3999, 4999, 'sage', 'Wi-Fi • voice controls'],
  [
    'Airbook 14 laptop',
    'Computers',
    'Nova',
    54999,
    62999,
    'cream',
    '16 GB RAM • 512 GB SSD • Ryzen 5',
  ],
  [
    'Probook 16 laptop',
    'Computers',
    'Nova',
    79999,
    89999,
    'sage',
    '32 GB RAM • 1 TB SSD • Ryzen 7',
  ],
  [
    'Workday wireless mouse',
    'Computers',
    'Orbit',
    1299,
    1799,
    'peach',
    'Bluetooth • silent clicks',
  ],
  [
    'Compact mechanical keyboard',
    'Computers',
    'Orbit',
    3499,
    4499,
    'cream',
    'Hot swap switches • USB-C',
  ],
  ['Daily smartwatch', 'Wearables', 'Pulse', 2999, 3999, 'peach', 'AMOLED • 7 day battery'],
  ['Active fitness band', 'Wearables', 'Pulse', 1499, 1999, 'sage', 'Heart rate • 14 day battery'],
  [
    'Everyday smartphone',
    'Mobiles',
    'Nova',
    18999,
    21999,
    'cream',
    '8 GB RAM • 128 GB • 50 MP camera',
  ],
  ['Pro smartphone', 'Mobiles', 'Nova', 32999, 36999, 'peach', '12 GB RAM • 256 GB • OLED'],
  ['Pour over coffee maker', 'Home', 'Haven', 2999, 3999, 'sage', '750 ml • reusable filter'],
  ['Quiet air purifier', 'Home', 'Haven', 8999, 10999, 'cream', 'HEPA • 300 sq ft coverage'],
  ['Smart desk lamp', 'Home', 'Haven', 1999, 2499, 'peach', 'Dimmable • warm to cool light'],
  [
    'Double door refrigerator',
    'Home',
    'Haven',
    27999,
    31999,
    'sage',
    '260 L • frost free • 3 star',
  ],
  [
    'Creator 15 laptop',
    'Computers',
    'Nova',
    64999,
    71999,
    'sage',
    '16 GB RAM • 1 TB SSD • Ryzen 7',
  ],
  [
    'Sport wireless earbuds',
    'Audio',
    'Sonic',
    2999,
    3999,
    'peach',
    'Bluetooth • IPX5 • 24 hour battery',
  ],
  ['Brew espresso machine', 'Home', 'Haven', 12999, 14999, 'cream', '15 bar pressure • 1.2 L tank'],
  ['Outdoor GPS watch', 'Wearables', 'Pulse', 6999, 8999, 'sage', 'GPS • AMOLED • 10 day battery'],
  ['Compact 5G smartphone', 'Mobiles', 'Nova', 22999, 25999, 'peach', '8 GB RAM • 256 GB • AMOLED'],
  ['Cinema soundbar', 'Audio', 'Echo', 8999, 10999, 'cream', 'Bluetooth • HDMI ARC • 120 W'],
  ['Portable induction cooker', 'Home', 'Haven', 3499, 4499, 'sage', '1800 W • touch controls'],
  [
    'Travel wireless keyboard',
    'Computers',
    'Orbit',
    2499,
    3299,
    'peach',
    'Bluetooth • compact layout • rechargeable',
  ],
] as const;
const attributes: Record<string, string>[] = [
  {
    'Product type': 'Headphones',
    Connectivity: 'Bluetooth',
    'Noise cancellation': 'Yes',
    'Battery life': '40 hours',
  },
  { 'Product type': 'Headphones', Connectivity: 'Bluetooth', 'Battery life': '60 hours' },
  {
    'Product type': 'Speaker',
    Connectivity: 'Bluetooth',
    'Water resistance': 'IP67',
    'Battery life': '12 hours',
  },
  { 'Product type': 'Speaker', Connectivity: 'Wi-Fi', 'Voice control': 'Yes' },
  { 'Product type': 'Laptop', RAM: '16 GB', Storage: '512 GB', Processor: 'Ryzen 5' },
  { 'Product type': 'Laptop', RAM: '32 GB', Storage: '1 TB', Processor: 'Ryzen 7' },
  { 'Product type': 'Mouse', Connectivity: 'Bluetooth' },
  { 'Product type': 'Keyboard', Connectivity: 'USB-C' },
  { 'Product type': 'Smartwatch', Display: 'AMOLED', 'Battery life': '7 days' },
  { 'Product type': 'Fitness band', 'Battery life': '14 days' },
  { RAM: '8 GB', Storage: '128 GB', Camera: '50 MP' },
  { RAM: '12 GB', Storage: '256 GB', Display: 'OLED' },
  { 'Product type': 'Coffee maker', Capacity: '750 ml' },
  { 'Product type': 'Air purifier', Filter: 'HEPA', Coverage: '300 sq ft' },
  { 'Product type': 'Desk lamp', Lighting: 'Dimmable' },
  { 'Product type': 'Refrigerator', Capacity: '260 L', 'Energy rating': '3 star' },
  { 'Product type': 'Laptop', RAM: '16 GB', Storage: '1 TB', Processor: 'Ryzen 7' },
  {
    'Product type': 'Earbuds',
    Connectivity: 'Bluetooth',
    'Water resistance': 'IPX5',
    'Battery life': '24 hours',
  },
  { 'Product type': 'Espresso machine', Capacity: '1.2 L' },
  { 'Product type': 'Smartwatch', Display: 'AMOLED', GPS: 'Yes', 'Battery life': '10 days' },
  { RAM: '8 GB', Storage: '256 GB', Display: 'AMOLED', Network: '5G' },
  { 'Product type': 'Soundbar', Connectivity: 'Bluetooth', Power: '120 W' },
  { 'Product type': 'Induction cooker', Power: '1800 W' },
  { 'Product type': 'Keyboard', Connectivity: 'Bluetooth' },
];
for (const [i, p] of products.entries()) {
  const [name, category, brand, price, originalPrice, color, description] = p;
  const product = await db.product.upsert({
    where: { sku: `RP-${String(i + 1).padStart(3, '0')}` },
    update: { specifications: { highlights: description.split(' • '), attributes: attributes[i] } },
    create: {
      name,
      sku: `RP-${String(i + 1).padStart(3, '0')}`,
      category,
      brand,
      price,
      originalPrice,
      color,
      description,
      rating: 4 + (i % 9) / 10,
      featured: i < 4,
      specifications: { highlights: description.split(' • '), attributes: attributes[i] },
    },
  });
  for (const [j, l] of locations.entries()) {
    // Existing demo products remain shared; new assortments are exclusive to one store plus delivery stock.
    if (
      !l.warehouse &&
      ((i >= 16 && i < 20 && l.id !== 'store-bengaluru') || (i >= 20 && l.id !== 'store-mumbai'))
    )
      continue;
    await db.inventory.upsert({
      where: { productId_locationId: { productId: product.id, locationId: l.id } },
      update: {},
      create: {
        productId: product.id,
        locationId: l.id,
        quantity: i === 15 && j === 1 ? 0 : i % 5 === 0 ? 3 : 12 + j * 5,
        reorderPoint: 5,
        targetStock: 25,
      },
    });
  }
}
const policies = [
  [
    'Delivery and membership policy',
    '# Standard delivery\n\nDemo policy: Standard delivery costs INR 99. Silver members receive free standard delivery for orders of INR 1999 or more. Gold and Platinum members receive free standard delivery.\n\n# Express delivery\n\nDemo policy: Express delivery costs INR 199 for Standard and Silver, INR 99 for Gold, and is free for Platinum. Availability depends on the selected store. Store pickup is free for every tier.',
  ],
  [
    'Returns and warranty policy',
    '# Opened electronics\n\nDemo policy: Opened mobile phones are not eligible for change of mind returns. A manufacturing defect can be reported to support within seven days for inspection.\n\n# Discounted purchases\n\nDemo policy: Discounted products follow their category return rules. A proof of purchase is required for store returns.\n\n# Refrigerator warranty\n\nDemo policy: Haven refrigerators include a one year manufacturer warranty. Damage from misuse is excluded. Contact support for a warranty claim.',
  ],
];
for (const [title, text] of policies) {
  const existing = await db.knowledgeDocument.findFirst({ where: { title, version: 'demo-1' } });
  if (!existing)
    await db.knowledgeDocument.create({
      data: {
        title,
        version: 'demo-1',
        effectiveFrom: new Date('2026-01-01'),
        active: true,
        status: 'READY',
        tiers: ['STANDARD', 'SILVER', 'GOLD', 'PLATINUM'],
        audience: ['CUSTOMER', 'STORE_MANAGER', 'ADMIN'],
        retrievalMode: 'LEXICAL',
        chunks: { create: chunkText(text) },
      },
    });
}
console.log(
  'Demo stores, 24 products, location managers and sample policies are ready. Existing stock and passwords are preserved.',
);
await db.$disconnect();
