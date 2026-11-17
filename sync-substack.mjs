// Sincroniza os posts do Substack com a coleção "Journal" do Framer e publica o site.
// Corre via GitHub Actions (ver .github/workflows/sync-substack.yml).

import { connect } from "framer-api"

const FEED_URL = process.env.SUBSTACK_FEED_URL || "https://arianaparrilha.substack.com/feed"
const PROJECT_URL = process.env.FRAMER_PROJECT_URL
const API_KEY = process.env.FRAMER_API_KEY
const COLLECTION_NAME = "Journal"
const AUTO_DEPLOY = (process.env.AUTO_DEPLOY || "true") === "true"

if (!PROJECT_URL || !API_KEY) {
  console.error("Faltam FRAMER_PROJECT_URL ou FRAMER_API_KEY.")
  process.exit(1)
}

// --- 1. Ler os posts do Substack ---------------------------------------------
// O Substack às vezes bloqueia pedidos de servidores (como os do GitHub).
// Por isso: (a) identificamo-nos como um browser normal, (b) tentamos o feed RSS
// e, se não vier nada, (c) tentamos a API pública do Substack.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept": "application/rss+xml, application/xml, application/json, text/xml, */*",
}
const BASE_URL = new URL(FEED_URL).origin
const slugFromLink = (link) => link.split("/p/")[1].replace(/\/$/, "").split("?")[0]

async function fromRss() {
  const res = await fetch(FEED_URL, { headers: HEADERS })
  const text = await res.text()
  console.log(`RSS: estado ${res.status}`)
  if (!res.ok) { console.log(text.slice(0, 300)); return [] }
  const pick = (chunk, re) => chunk.match(re)?.[1]?.trim() ?? null
  const cdata = (s) => s?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() ?? null
  return text.split(/<item[\s>]/).slice(1).map((chunk) => {
    const link = pick(chunk, /<link>([\s\S]*?)<\/link>/)
    return {
      title: cdata(pick(chunk, /<title>([\s\S]*?)<\/title>/)),
      excerpt: cdata(pick(chunk, /<description>([\s\S]*?)<\/description>/)) ?? "",
      link,
      slug: slugFromLink(link),
      date: new Date(pick(chunk, /<pubDate>([\s\S]*?)<\/pubDate>/)).toISOString(),
      cover: pick(chunk, /<enclosure[^>]*url="([^"]+)"/),
    }
  })
}

async function fromApi() {
  const res = await fetch(`${BASE_URL}/api/v1/posts?limit=50`, { headers: HEADERS })
  console.log(`API: estado ${res.status}`)
  if (!res.ok) { console.log((await res.text()).slice(0, 300)); return [] }
  const data = await res.json()
  return data
    .filter((p) => p.canonical_url && p.post_date)
    .map((p) => ({
      title: p.title,
      excerpt: p.subtitle ?? p.description ?? "",
      link: p.canonical_url,
      slug: p.slug ?? slugFromLink(p.canonical_url),
      date: new Date(p.post_date).toISOString(),
      cover: p.cover_image ?? null,
    }))
}

let posts = []
try { posts = await fromRss() } catch (e) { console.log("RSS falhou:", e.message) }
if (posts.length === 0) {
  try { posts = await fromApi() } catch (e) { console.log("API falhou:", e.message) }
}
console.log(`Substack: ${posts.length} posts encontrados.`)

// Se não encontrámos nenhum post, algo está errado: falhar em vez de fingir que está tudo bem.
if (posts.length === 0) {
  console.error("Não foi possível ler nenhum post do Substack. Ver as mensagens acima.")
  process.exit(1)
}

// --- 2. Ligar ao Framer -------------------------------------------------------
// A ligação ao Framer às vezes falha por timeout do lado deles (a API está em beta).
// Tentamos até 3 vezes, com uma pausa entre tentativas.
async function connectWithRetry(attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`A ligar ao Framer (tentativa ${i} de ${attempts})...`)
      return await connect(PROJECT_URL, API_KEY)
    } catch (e) {
      console.log(`Falhou: ${e.message}`)
      if (i === attempts) throw e
      await new Promise((r) => setTimeout(r, 30_000))
    }
  }
}
const framer = await connectWithRetry()
console.log("Ligado ao Framer.")
try {
  const collections = await framer.getCollections()
  const collection = collections.find((c) => c.name === COLLECTION_NAME)
  if (!collection) throw new Error(`Coleção "${COLLECTION_NAME}" não encontrada.`)

  const fields = await collection.getFields()
  const field = (name) => {
    const f = fields.find((x) => x.name === name)
    if (!f) throw new Error(`Campo "${name}" não encontrado na coleção.`)
    return f.id
  }
  const F = {
    title: field("Title"),
    cover: field("Cover"),
    excerpt: field("Excerpt"),
    date: field("Date"),
    link: field("Substack link"),
  }

  // --- 3. Adicionar só os posts que ainda não existem -------------------------
  const existing = await collection.getItems()
  const existingSlugs = new Set(existing.map((i) => i.slug))
  const newPosts = posts.filter((p) => !existingSlugs.has(p.slug))

  if (newPosts.length === 0) {
    console.log("Nada de novo. A sair sem publicar.")
  } else {
    for (const p of newPosts) {
      const fieldData = {
        [F.title]: { type: "string", value: p.title },
        [F.excerpt]: { type: "string", value: p.excerpt },
        [F.date]: { type: "date", value: p.date },
        [F.link]: { type: "link", value: p.link },
      }
      if (p.cover) {
        const asset = await framer.uploadImage({ image: p.cover, name: p.slug })
        fieldData[F.cover] = { type: "image", value: asset.url }
      }
      await collection.addItems([{ slug: p.slug, fieldData }])
      console.log(`+ Adicionado: ${p.title}`)
    }

    // --- 4. Ordenar do mais recente para o mais antigo ------------------------
    const items = await collection.getItems()
    const dateOf = (i) => new Date(i.fieldData?.[F.date]?.value ?? 0).getTime()
    await collection.setItemOrder([...items].sort((a, b) => dateOf(b) - dateOf(a)).map((i) => i.id))

    // --- 5. Publicar ---------------------------------------------------------
    const result = await framer.publish()
    console.log("Preview publicada:", result.hostnames)
    if (AUTO_DEPLOY) {
      await framer.deploy(result.deployment.id)
      console.log("Publicado em produção.")
    } else {
      console.log("AUTO_DEPLOY=false: confirma a preview e publica no Framer.")
    }
  }
} finally {
  await framer.disconnect()
}
