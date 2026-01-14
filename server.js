import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config();

// ========================================================
// 🔥 FIREBASE ADMIN
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
// ⏳ TOKEN TEMPORÁRIO DE VÍDEO
// ========================================================
function encodeTemp(str, minutos = 10) {
    const expires = Date.now() + minutos * 60 * 1000;
    return Buffer.from(`${str}::${expires}`, "utf8").toString("base64");
}

// ========================================================
// 🔍 SCRAPING CORRETO (DESCRIÇÃO POR EPISÓDIO)
// ========================================================
async function extractVideos(blogUrl) {
    const { data } = await axios.get(blogUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const episodes = [];

    $(".post-body iframe").each((index, el) => {
        const iframe = $(el);

        const video = iframe.attr("src") || "";

        const title =
            iframe.nextAll("b").first().text().trim() ||
            `Episódio ${index + 1}`;

        const description =
            iframe.nextAll("i").first().text().trim() || "";
        console.log("DESC:", description);

        episodes.push({
            id: index + 1,
            title,
            description,
            video: encodeTemp(video)
        });
    });

    return episodes;
}
// ========================================================
// 🚀 EXPRESS
// ========================================================
const app = express();
app.use(cors());
app.use(express.json());

// ========================================================
// 📌 GET /get/:server/:anime
// ========================================================
app.get("/get/:server/:anime", async (req, res) => {
    try {
        const { server, anime } = req.params;

        // 🔹 OBRA
        const obraSnap = await db
            .ref(`servers/${server}/catalogo/${anime}/obra`)
            .get();

        if (!obraSnap.exists()) {
            return res.status(404).json({ error: "Anime não encontrado" });
        }

        const obra = obraSnap.val();

        // 🔹 LINK BASE
        const linkSnap = await db
            .ref(`servers/${server}/link`)
            .get();

        const baseUrl = linkSnap.val();

        if (!baseUrl || !obra.temporada1) {
            return res.status(500).json({ error: "Configuração inválida no Firebase" });
        }

        const fullUrl = `${baseUrl}/${obra.temporada1}`;
        console.log("🔍 Scraping:", fullUrl);

        const episodes = await extractVideos(fullUrl);

        res.json({
            server,
            anime,
            titulo: obra.titulo,
            sinopse: obra.sinopse,
            capa: obra.capa,
            quantidadeEps: obra.quantidadeEps,
            totalScraped: episodes.length,
            episodes
        });

    } catch (err) {
        console.error("❌ ERRO:", err);
        res.status(500).json({ error: "Erro interno" });
    }
});

// ========================================================
app.listen(process.env.PORT || 3000, () => {
    console.log("🔥 API rodando na porta", process.env.PORT || 3000);
});
