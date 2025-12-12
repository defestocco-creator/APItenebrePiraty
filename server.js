import express from "express";
import axios from "axios";
import cheerio from "cheerio";
import admin from "firebase-admin";

const app = express();
app.use(express.json());

// === FIREBASE INIT ===
admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
    databaseURL: process.env.DB_URL
});
const db = admin.database();

// === Função de codificação temporária ===
function encode(str) {
    return Buffer.from(str, "utf8").toString("base64");
}

// === Função principal: extrair + codificar ===
async function scrapeBlog(fullUrl) {
    const { data } = await axios.get(fullUrl);
    const $ = cheerio.load(data);

    let episodes = [];

    $(".post-body iframe").each((i, el) => {
        const video = $(el).attr("src") || "";
        const encodedVideo = encode(video);

        const title = $(el).parent().next("b").text().trim();
        const descBlock = $(el).parent().nextAll("i").first().parent().html();

        const cleanDesc = (descBlock || "")
            .replace(/<[^>]+>/g, "")
            .replace(/\n/g, " ")
            .trim();

        episodes.push({
            id: i + 1,
            title: title || `Episódio ${i + 1}`,
            video: encodedVideo,
            description: cleanDesc || ""
        });
    });

    return episodes;
}

// === ROTA: /traslink/:server/:conteudo ===
app.get("/traslink/:server/:conteudo", async (req, res) => {
    const { server, conteudo } = req.params;

    try {
        // 1. Carrega lista de servidores do Firebase
        const snap = await db.ref(`servers/${server}`).once("value");
        if (!snap.exists()) return res.status(404).json({ error: "Servidor não encontrado" });

        const srv = snap.val();

        // 2. Pega link do conteúdo
        const page = srv.conteudo[conteudo];
        if (!page) return res.status(404).json({ error: "Conteúdo não encontrado" });

        // 3. Monta o link real
        const fullUrl = `${srv.link}/${page}`;

        // 4. Faz scraper + codificação
        const episodes = await scrapeBlog(fullUrl);

        // 5. Retorna JSON final
        res.json({
            server,
            conteudo,
            total: episodes.length,
            episodes
        });

    } catch (e) {
        console.error("Erro:", e);
        res.status(500).json({ error: "Erro interno" });
    }
});

// === START SERVER ===
app.listen(3000, () => console.log("API rodando na porta 3000"));
