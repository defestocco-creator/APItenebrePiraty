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
// ⏳ ENCODE TEMPORÁRIO (expira)
// ========================================================
function encodeTemp(str, minutos = 10) {
    const expires = Date.now() + minutos * 60 * 1000;
    const payload = `${str}::${expires}`;
    return Buffer.from(payload, "utf8").toString("base64");
}

// ========================================================
// 🔍 SCRAPING DOS VÍDEOS
// ========================================================
async function extractVideos(blogUrl) {
    const { data } = await axios.get(blogUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const episodes = [];

    $(".post-body iframe").each((i, el) => {
        const video = $(el).attr("src") || "";

        const title =
            $(el).parent().next("b").text().trim() ||
            `Episódio ${i + 1}`;

        const descHtml =
            $(el).parent().nextAll("i").first().parent().html() || "";

        const description = descHtml
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim();

        episodes.push({
            id: i + 1,
            title,
            video: encodeTemp(video),
            description
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
// 📌 ENDPOINT CORRIGIDO
// GET /get/:server/:anime
// ========================================================
app.get("/get/:server/:anime", async (req, res) => {
    try {
        const { server, anime } = req.params;

        // 🔹 Busca OBRA
        const obraRef = db.ref(`servers/${server}/catalogo/${anime}/obra`);
        const obraSnap = await obraRef.get();

        if (!obraSnap.exists()) {
            return res.status(404).json({ error: "Anime não encontrado" });
        }

        const obra = obraSnap.val();

        // 🔹 Base do blog
        const linkSnap = await db.ref(`servers/${server}/link`).get();
        const serverBase = linkSnap.val();

        if (!serverBase || !obra.temporada1) {
            return res.status(500).json({ error: "Link inválido no Firebase" });
        }

        const fullUrl = `${serverBase}/${obra.temporada1}`;
        console.log("🔍 Scraping:", fullUrl);

        // 🔹 Scraping
        const episodes = await extractVideos(fullUrl);

        res.json({
            server,
            anime,
            titulo: obra.titulo,
            sinopse: obra.sinopse,
            quantidadeEps: obra.quantidadeEps,
            totalScraped: episodes.length,
            episodes
        });

    } catch (err) {
        console.error("❌ ERRO:", err.message);
        res.status(500).json({ error: "Erro interno no servidor" });
    }
});

// ========================================================
app.listen(process.env.PORT || 3000, () =>
    console.log("🔥 API rodando na porta", process.env.PORT || 3000)
);
