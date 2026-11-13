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

// --- 1. Ler o feed do Substack ---------------------------------------------
const xml = await (await fetch(FEED_URL)).text()
const pick = (chunk, re) => chunk.match(re)?.[1]?.trim() ?? null
const posts = xml.split("<item>").slice(1).map((chunk) => {
  const link = pick(chunk, /<link>([\s\S]*?)<\/link>/)
  return {
    title: pick(chunk, /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/),
    excerpt: pick(chunk, /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ?? "",
    link,
    slug: link.split("/p/")[1].replace(/\/$/, ""),
    date: new Date(pick(chunk, /<pubDate>([\s\S]*?)<\/pubDate>/)).toISOString(),
    cover: pick(chunk, /<enclosure url="([^"]+)"/),
  }
})
console.log(`Feed: ${posts.length} posts encontrados.`)

// --- 2. Ligar ao Framer -------------------------------------------------------
const framer = await connect(PROJECT_URL, API_KEY)
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
