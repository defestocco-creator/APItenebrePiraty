import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

// ========================================================
// 🔥  FIREBASE ADMIN (SERVIDOR)
// ========================================================
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    }),
    databaseURL: process.env.DATABASE_URL
});

const db = admin.database();

// ========================================================
// ⏳ ENCODING TEMPORÁRIO (expira automaticamente)
// ========================================================
function encodeTemp(str, minutos = 10) {
    const expires = Date.now() + minutos * 60 * 1000;
    const payload = `${str}::${expires}`;
    return Buffer.from(payload, "utf8").toString("base64");
}

// ========================================================
// 🔍 Função que faz scraping automático dos vídeos
// ========================================================
async function extractVideos(blogUrl) {
    const { data } = await axios.get(blogUrl);
    const $ = cheerio.load(data);

    const episodes = [];

    $(".post-body iframe").each((i, el) => {
        const video = $(el).attr("src") || "";
        const title = $(el).parent().next("b").text().trim();

        const descBlock = $(el).parent().nextAll("i").first().parent().html() || "";
        const cleanDesc = descBlock
            .replace(/<[^>]+>/g, "")
            .replace(/\n/g, " ")
            .trim();

        episodes.push({
            id: i + 1,
            title: title || `Episódio ${i + 1}`,
            video: encodeTemp(video, 10),
            description: cleanDesc
        });
    });

    return episodes;
}

// ========================================================
// 🚀 API EXPRESS
// ========================================================
const app = express();
app.use(cors());
app.use(express.json());

// ========================================================
// 📌  ENDPOINT: /get/:server/:anime
// Busca o link no Firebase, faz scraping e retorna JSON
// ========================================================
app.get("/get/:server/:anime", async (req, res) => {
    try {
        const { server, anime } = req.params;
        const ref = db.ref(`servers/${server}/conteudo/${anime}`);

        const snapshot = await ref.get();

        if (!snapshot.exists()) {
            return res.status(404).json({ error: "Registro não encontrado" });
        }

        const blogPath = snapshot.val(); // exemplo: 2025/12/blog-post_797.html
        const serverBase = (await db.ref(`servers/${server}/link`).get()).val();

        const fullUrl = `${serverBase}/${blogPath}`;

        console.log("🔍 Scraping:", fullUrl);

        const episodes = await extractVideos(fullUrl);

        res.json({
            anime,
            total: episodes.length,
            episodes
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});

// ========================================================
app.listen(process.env.PORT || 3000, () =>
    console.log("🔥 API rodando na porta", process.env.PORT || 3000)
);
