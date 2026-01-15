import express from "express";
import cors from "cors";
import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";

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
// 🔐 LOGIN
// ========================================================
app.post("/login", async (req, res) => {
    try {
        const { user, acesso } = req.body;

        if (!user || !acesso) {
            return res.status(400).json({ error: "Dados inválidos" });
        }

        const userSnap = await db.ref(`users/${user}`).get();

        if (!userSnap.exists()) {
            return res.status(401).json({ error: "Usuário não existe" });
        }

        const userData = userSnap.val();

        if (userData.acesso !== acesso) {
            return res.status(401).json({ error: "Acesso inválido" });
        }

        const token = jwt.sign(
            { user },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES || "2h" }
        );

        res.json({
            token,
            user
        });

    } catch (err) {
        console.error("❌ LOGIN ERRO:", err);
        res.status(500).json({ error: "Erro no login" });
    }
});

// ========================================================
// 🛡️ AUTH MIDDLEWARE
// ========================================================
function auth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: "Token não enviado" });
    }

    const [, token] = authHeader.split(" ");

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ error: "Token inválido ou expirado" });
    }
}


// ========================================================
// ⭐ GET /preview/:server (OBRAS EM DESTAQUE)
// ========================================================
// Esta rota retorna todas as obras que possuem "Destaque: true".
// Serve para montar telas iniciais (home/vitrine) sem executar
// scraping, reduzindo custo e tempo de carregamento.
app.get("/preview/:server", auth, async (req, res) => {
    try {
        const { server } = req.params;

        const catalogoSnap = await db
            .ref(`servers/${server}/catalogo`)
            .get();

        if (!catalogoSnap.exists()) {
            return res.status(404).json({ error: "Catálogo não encontrado" });
        }

        const catalogo = catalogoSnap.val();
        const destaques = [];

        for (const [anime, data] of Object.entries(catalogo)) {
            if (data.Destaque === true) {
                destaques.push({
                    anime,
                    titulo: data.Titulo || data.titulo || null,
                    sinopse: data.sinopse || null,
                    capa: data.Capa || data.obra?.capa || null,
                    generos: data.genero
                        ? Object.values(data.genero).filter(Boolean)
                        : []
                });
            }
        }

        res.json({
            server,
            total: destaques.length,
            obras: destaques
        });

    } catch (err) {
        console.error("❌ PREVIEW DESTAQUES ERRO:", err);
        res.status(500).json({ error: "Erro ao carregar destaques" });
    }
});


// ========================================================
// 👀 GET /preview/:server/:anime (PREVIEW LEVE)
// ========================================================
// Esta rota serve para um preview das obras antes de carregar
// os dados scrapped (episódios). A ideia é minimizar o
// carregamento inicial, retornando apenas informações básicas
// como título, sinopse, gêneros e capa.
app.get("/preview/:server/:anime", auth, async (req, res) => {
    try {
        const { server, anime } = req.params;

        const animeSnap = await db
            .ref(`servers/${server}/catalogo/${anime}`)
            .get();

        if (!animeSnap.exists()) {
            return res.status(404).json({ error: "Anime não encontrado" });
        }

        const data = animeSnap.val();

        const generos = data.genero
            ? Object.values(data.genero).filter(Boolean)
            : [];

        res.json({
            server,
            anime,
            titulo: data.Titulo || data.titulo || null,
            sinopse: data.sinopse || null,
            capa: data.Capa || data.obra?.capa || null,
            generos,
            destaque: data.Destaque || false
        });

    } catch (err) {
        console.error("❌ PREVIEW ERRO:", err);
        res.status(500).json({ error: "Erro ao carregar preview" });
    }
});

// ========================================================
// 📌 GET /get/:server/:anime (PROTEGIDO)
// ========================================================
app.get("/get/:server/:anime", auth, async (req, res) => {
    try {
        const { server, anime } = req.params;

        const obraSnap = await db
            .ref(`servers/${server}/catalogo/${anime}/obra`)
            .get();

        if (!obraSnap.exists()) {
            return res.status(404).json({ error: "Anime não encontrado" });
        }

        const obra = obraSnap.val();

        const generoSnap = await db
            .ref(`servers/${server}/catalogo/${anime}/genero`)
            .get();

        const generos = generoSnap.exists()
            ? Object.values(generoSnap.val()).filter(Boolean)
            : [];

        const linkSnap = await db
            .ref(`servers/${server}/link`)
            .get();

        const baseUrl = linkSnap.val();

        if (!baseUrl || !obra.temporada1) {
            return res.status(500).json({ error: "Configuração inválida no Firebase" });
        }

        const fullUrl = `${baseUrl}/${obra.temporada1}`;

        const episodes = await extractVideos(fullUrl);

        res.json({
            server,
            anime,
            titulo: obra.titulo,
            sinopse: obra.sinopse,
            capa: obra.capa,
            quantidadeEps: obra.quantidadeEps,
            generos,
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
