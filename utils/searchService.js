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
  "electronica": ["celular","telefono","smartphone","notebook","computadora","pc","monitor","televisor","tv","auriculares","parlante","cargador","tablet","teclado","mouse","impresora","camara","consola","joystick","router"],
  "ropa-moda": ["zapatillas","zapatos","pollera","remera","camisa","pantalon","jean","vestido","campera","buzo","gorra","sombrero","cartera","mochila","cinturon","medias","ropa","moda","calzado","accesorios"],
  "hogar": ["mesa","silla","sillon","mueble","colchon","cama","almohada","sabana","cortina","lampara","decoracion","cocina","heladera","freezer","microondas","vajilla","termo","mate","organizador","limpieza"],
  "deportes": ["pelota","futbol","basquet","voley","tenis","raqueta","pesas","mancuernas","bicicleta","casco","botines","camiseta","short","fitness","gimnasio","running","yoga","protector","guantes","deporte"],
  "alimentos": ["comida","alimentos","pan","facturas","torta","galletitas","chocolate","cafe","te","yerba","mate","frutas","verduras","carne","pollo","pasta","queso","fiambre","bebidas","delivery"],
  "salud-belleza": ["perfume","maquillaje","crema","shampoo","acondicionador","jabon","desodorante","labial","mascara","esmalte","cepillo","salud","belleza","cosmetica","skincare","protector solar","barberia","peluqueria","uñas","spa"],
  "automotriz": ["auto","moto","cubierta","neumatico","bateria","aceite","filtro","repuesto","amortiguador","freno","llanta","casco","lavado","detailing","accesorios auto","stereo","alarma","motor","taller","automotor"],
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
async function ensureCategories() {
  if (await Category.estimatedDocumentCount()) return;
  await Category.insertMany(DEFAULT_CATEGORIES.map(([name,slug,iconName],i)=>({name,slug,iconName,order:i,active:true})), { ordered: false }).catch(()=>{});
}
async function ensureSearchSeeds() {
  await ensureCategories();
  if (!(await SearchKeyword.estimatedDocumentCount())) {
    const docs = [];
    for (const category of Object.keys(CATEGORY_ROOTS)) {
      for (const keyword of seedForCategory(category)) docs.push({ keyword, normalized: normalizeText(keyword), category, source: "seed", usageCount: 1, active: true });
    }
    await SearchKeyword.insertMany(docs, { ordered: false }).catch(()=>{});
  }
  const forbidden = [
    ["droga",[]],["drogas",[]],["porro",[]],["faso",[]],["cocaina",[]],
    ["prostitucion",[]],["prostituta",[]],["prostituto",[]],
    ["borracho",["palo borracho"]],["violacion",[]],["asesinato",[]],["asesino",[]],
    ["puta",[]],["puto",[]],["anal",[]],["cagar",[]],["cojer",[]],["coger",[]]
  ];
  for (const [term, exceptions] of forbidden) {
    const normalized = normalizeText(term);
    await ForbiddenTerm.updateOne({ normalized }, { $setOnInsert: { term, normalized, exceptions, source: "seed", active: true } }, { upsert: true }).catch(()=>{});
  }
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
  await ensureSearchSeeds();
  const normalized = normalizeText(query);
  if (!normalized) return SearchKeyword.find({ active: true }).sort({ usageCount: -1, keyword: 1 }).limit(limit).lean();
  const escaped = escapeRegex(normalized);
  return SearchKeyword.find({ active: true, $or: [
    { normalized: { $regex: "^" + escaped, $options: "i" } },
    { normalized: { $regex: escaped, $options: "i" } },
  ]}).sort({ usageCount: -1, keyword: 1 }).limit(limit).lean();
}
async function resolveIntent(query) {
  await ensureSearchSeeds();
  const normalized = normalizeText(query);
  if (!normalized) return { normalized, categories: [], terms: [] };
  const tokens = normalized.split(" ").filter(Boolean);
  const matches = await SearchKeyword.find({ active: true, $or: [
    { normalized: { $in: tokens } },
    { normalized: { $regex: tokens.map(escapeRegex).join("|"), $options: "i" } },
  ]}).sort({ usageCount: -1 }).limit(60).lean();
  const categoryScore = new Map();
  const terms = new Set(tokens.filter(t => t.length >= 3 && !STOPWORDS.has(t)));
  for (const m of matches) {
    categoryScore.set(m.category, (categoryScore.get(m.category) || 0) + Math.max(1, Number(m.usageCount || 1)));
    normalizeText(m.keyword).split(" ").filter(t => t.length >= 3 && !STOPWORDS.has(t)).forEach(t => terms.add(t));
  }
  const categories = [...categoryScore.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([category])=>category);
  return { normalized, categories, terms: [...terms].slice(0,30) };
}

module.exports = { normalizeText, ensureCategories, ensureSearchSeeds, learnFromProduct, getSuggestions, resolveIntent, seedForCategory };
