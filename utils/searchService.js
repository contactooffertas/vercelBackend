const SearchKeyword = require("../models/searchKeywordModel");
const ForbiddenTerm = require("../models/forbiddenTermModel");
const Category = require("../models/categoryModel");

const DEFAULT_CATEGORIES = [
  ["Electrónica","electronica","Monitor"],["Ropa y Moda","ropa-moda","Shirt"],
  ["Hogar","hogar","Home"],["Deportes","deportes","Dumbbell"],
  ["Alimentos","alimentos","ShoppingBag"],["Salud y Belleza","salud-belleza","Heart"],
  ["Automotriz","automotriz","Car"],["Juguetes","juguetes","Gift"],
  ["Libros","libros","BookOpen"],["Mascotas","mascotas","PawPrint"],
];

const CATEGORY_ROOTS = {
  "electronica": ["electronica","tecnologia","celular","telefono","smartphone","notebook","computadora","pc","monitor","televisor","tv","auriculares","parlante","cargador","tablet","teclado","mouse","impresora","camara","consola","joystick","router"],
  "ropa-moda": ["zapatillas","zapatos","pollera","remera","camisa","pantalon","jean","vestido","campera","buzo","gorra","sombrero","cartera","mochila","cinturon","medias","ropa","moda","calzado","accesorios"],
  "hogar": ["mesa","silla","sillon","mueble","colchon","cama","almohada","sabana","cortina","lampara","decoracion","cocina","heladera","freezer","microondas","vajilla","termo","mate","organizador","limpieza"],
  "deportes": ["pelota","futbol","basquet","voley","tenis","raqueta","pesas","mancuernas","bicicleta","casco","botines","camiseta","short","fitness","gimnasio","running","yoga","protector","guantes","deporte"],
  "alimentos": ["comida","alimentos","pan","facturas","torta","galletitas","chocolate","cafe","te","yerba","mate","frutas","verduras","carne","pollo","pasta","queso","fiambre","bebidas","delivery"],
  "salud-belleza": ["perfume","maquillaje","crema","shampoo","acondicionador","jabon","desodorante","labial","mascara","esmalte","cepillo","salud","belleza","cosmetica","skincare","protector solar","barberia","peluqueria","uñas","spa"],
  "automotriz": ["automotriz","automotor","auto","moto","cubierta","neumatico","bateria","aceite","filtro","repuesto","amortiguador","freno","llanta","casco","lavado","detailing","accesorios auto","stereo","alarma","motor","taller"],
  "juguetes": ["juguete","muñeca","muñeco","peluche","rompecabezas","puzzle","bloques","lego","autito","camion","juego","mesa","cartas","didactico","bebe","infantil","patin","monopatin","disfraz","regalo"],
  "libros": ["libro","novela","cuento","manual","escolar","diccionario","enciclopedia","comic","manga","revista","literatura","historia","ciencia","infantil","juvenil","poesia","biografia","estudio","lectura","libreria"],
  "mascotas": ["perro","gato","mascota","alimento perro","alimento gato","correa","collar","pretal","cucha","cama mascota","juguete mascota","arena","piedritas","shampoo mascota","veterinaria","peluqueria canina","comedero","bebedero","transportadora","accesorios mascota"],
};

const INTENT_PREFIXES = ["quiero comprar","donde comprar","busco","necesito","comprar","precio de","oferta de","tienda de","negocio de","venta de"];
const STOPWORDS = new Set(["para","con","sin","por","una","uno","unos","unas","del","las","los","que","como","muy","mas","menos","color","nuevo","nueva","usado","usada","este","esta","ese","esa","producto","productos","venta","vendo","comprar","quiero","donde","tienda","negocio","rosario","argentina","marca","modelo"]);

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
}
function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]\\]/g, "\\$&");
}
function seedForCategory(category) {
  const roots = CATEGORY_ROOTS[category] || [];
  const result = [];
  for (const root of roots) {
    result.push(root);
    for (const prefix of INTENT_PREFIXES) result.push(prefix + " " + root);
  }
  return [...new Set(result)].slice(0, 100);
}
let seedPromise = null;
let seedReady = false;

async function ensureCategories() {
  if (await Category.estimatedDocumentCount()) return;
  await Category.insertMany(
    DEFAULT_CATEGORIES.map(([name, slug, iconName], i) => ({
      name, slug, iconName, order: i, active: true,
    })),
    { ordered: false }
  ).catch(() => {});
}

async function seedDatabaseOnce() {
  await ensureCategories();

  // Upsert de semillas base: no depende de que la colección esté vacía.
  // Esto corrige instalaciones donde ya había palabras aprendidas pero faltaban
  // conceptos esenciales como "calzado" => "ropa-moda".
  const ops = [];
  for (const category of Object.keys(CATEGORY_ROOTS)) {
    for (const keyword of seedForCategory(category)) {
      const normalized = normalizeText(keyword);
      ops.push({
        updateOne: {
          filter: { normalized, category },
          update: {
            $setOnInsert: {
              keyword,
              normalized,
              category,
              source: "seed",
              usageCount: 1,
              active: true,
            },
          },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) {
    await SearchKeyword.bulkWrite(ops, { ordered: false }).catch(() => {});
  }

  const forbidden = [
    ["droga",[]],["drogas",[]],["porro",[]],["faso",[]],["cocaina",[]],
    ["prostitucion",[]],["prostituta",[]],["prostituto",[]],
    ["borracho",["palo borracho"]],["violacion",[]],["asesinato",[]],["asesino",[]],
    ["puta",[]],["puto",[]],["anal",[]],["cagar",[]],["cojer",[]],["coger",[]]
  ];
  await Promise.all(
    forbidden.map(([term, exceptions]) => {
      const normalized = normalizeText(term);
      return ForbiddenTerm.updateOne(
        { normalized },
        { $setOnInsert: { term, normalized, exceptions, source: "seed", active: true } },
        { upsert: true }
      ).catch(() => {});
    })
  );

  seedReady = true;
}

async function ensureSearchSeeds() {
  if (seedReady) return;
  if (!seedPromise) {
    seedPromise = seedDatabaseOnce().finally(() => {
      if (!seedReady) seedPromise = null;
    });
  }
  await seedPromise;
}

function staticIntent(query) {
  const normalized = normalizeText(query);
  const tokens = normalized.split(" ").filter(Boolean);
  const scores = new Map();
  const terms = new Set(tokens.filter(t => t.length >= 3 && !STOPWORDS.has(t)));

  for (const [category, roots] of Object.entries(CATEGORY_ROOTS)) {
    let score = 0;
    for (const root of roots) {
      const normalizedRoot = normalizeText(root);
      if (!normalizedRoot) continue;
      if (
        normalized === normalizedRoot ||
        tokens.includes(normalizedRoot) ||
        normalized.includes(normalizedRoot)
      ) {
        score += normalized === normalizedRoot ? 100 : 20;
        normalizedRoot.split(" ").forEach(t => terms.add(t));
      }
    }
    if (score > 0) scores.set(category, score);
  }

  return {
    normalized,
    categories: [...scores.entries()]
      .sort((a,b)=>b[1]-a[1])
      .slice(0,3)
      .map(([category])=>category),
    terms: [...terms].slice(0,30),
  };
}

function staticSuggestions(query, limit = 8) {
  const normalized = normalizeText(query);
  if (!normalized) return [];

  const candidates = [];
  for (const [category, roots] of Object.entries(CATEGORY_ROOTS)) {
    for (const root of roots) {
      const phrases = [root, ...INTENT_PREFIXES.map(prefix => prefix + " " + root)];
      for (const text of phrases) {
        const n = normalizeText(text);
        if (n.startsWith(normalized) || n.includes(normalized)) {
          candidates.push({ keyword: text, category, source: "seed", usageCount: 1000 });
        }
      }
    }
  }

  const seen = new Set();
  return candidates.filter(item => {
    const key = normalizeText(item.keyword);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

async function learnFromProduct({ name, description, category }) {
  await ensureSearchSeeds();
  const text = normalizeText(String(name || "") + " " + String(description || ""));
  const words = [...new Set(text.split(" ").filter(w => w.length >= 4 && !STOPWORDS.has(w)))].slice(0, 20);
  if (!category) return;
  for (const word of words) {
    await SearchKeyword.updateOne(
      { normalized: word, category },
      { $setOnInsert: { keyword: word, normalized: word, category, source: "product", active: true }, $inc: { usageCount: 1 } },
      { upsert: true }
    ).catch(()=>{});
  }
}
async function getSuggestions(query, limit = 8) {
  const normalized = normalizeText(query);
  const local = staticSuggestions(normalized, limit);

  // Para autocompletado no bloqueamos esperando la siembra. La iniciamos una vez
  // y consultamos Mongo solo para complementar aprendizaje/admin.
  ensureSearchSeeds().catch(() => {});

  if (!normalized) return local;

  const escaped = escapeRegex(normalized);
  const learned = await SearchKeyword.find({
    active: true,
    $or: [
      { normalized: { $regex: "^" + escaped, $options: "i" } },
      { normalized: { $regex: escaped, $options: "i" } },
    ],
  })
    .sort({ usageCount: -1, keyword: 1 })
    .limit(limit)
    .lean()
    .maxTimeMS(700)
    .catch(() => []);

  const combined = [...local, ...learned];
  const seen = new Set();
  return combined.filter(item => {
    const key = normalizeText(item.keyword);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

async function resolveIntent(query) {
  const fast = staticIntent(query);
  if (!fast.normalized) return fast;

  // La relación semántica principal sale del diccionario en memoria.
  // Mongo solo suma términos aprendidos/administrados y nunca debe demorar la búsqueda.
  ensureSearchSeeds().catch(() => {});

  // Solo usamos términos significativos para consultar el diccionario aprendido.
  // Palabras como "quiero", "comprar", "tienda", etc. no deben contaminar categorías.
  const tokens = fast.normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token));

  const tokenPattern = tokens.map(escapeRegex).join("|");
  const matches = tokens.length ? await SearchKeyword.find({
    active: true,
    $or: [
      { normalized: { $in: tokens } },
      { normalized: { $regex: tokenPattern, $options: "i" } },
    ],
  })
    .sort({ usageCount: -1 })
    .limit(40)
    .lean()
    .maxTimeMS(700)
    .catch(() => []) : [];

  const categoryScore = new Map();
  fast.categories.forEach((category, index) => {
    categoryScore.set(category, 10000 - index * 1000);
  });
  const terms = new Set(fast.terms);

  for (const m of matches) {
    if (fast.categories.length > 0 && !fast.categories.includes(m.category)) {
      continue;
    }
    categoryScore.set(
      m.category,
      (categoryScore.get(m.category) || 0) + Math.max(1, Number(m.usageCount || 1))
    );
    normalizeText(m.keyword)
      .split(" ")
      .filter(t => t.length >= 3 && !STOPWORDS.has(t))
      .forEach(t => terms.add(t));
  }

  return {
    normalized: fast.normalized,
    categories: [...categoryScore.entries()]
      .sort((a,b)=>b[1]-a[1])
      .slice(0,3)
      .map(([category])=>category),
    terms: [...terms].slice(0,30),
  };
}

module.exports = { normalizeText, ensureCategories, ensureSearchSeeds, learnFromProduct, getSuggestions, resolveIntent, seedForCategory, staticIntent, staticSuggestions };
