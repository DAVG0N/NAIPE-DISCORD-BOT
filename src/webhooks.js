const express = require('express');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = path.join(__dirname, '../data/bd.json');
const POLLING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos

// Mapa de partidas ativas: matchId -> { intervalId, message, playerNames, matchUrl }
const activeMatches = new Map();

function getPremadeIds() {
    try {
        if (!fs.existsSync(LEADERBOARD_FILE)) return [];
        const data = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf-8'));
        return data.map(p => p.player_id).filter(Boolean);
    } catch (e) {
        console.error('[Faceit Webhook] Erro a ler bd.json:', e);
        return [];
    }
}

async function fetchMatchScore(matchId) {
    const apiKey = process.env.FACEIT_API_KEY;
    if (!apiKey) return null;
    try {
        const res = await fetch(`https://open.faceit.com/data/v4/matches/${matchId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data;
    } catch (e) {
        console.error('[Faceit Webhook] Erro a buscar score:', e);
        return null;
    }
}

function buildPlayingEmbed(playerNames, mapName, matchUrl, score) {
    const scoreText = score
        ? `**${score.team1Name}** ${score.team1} — ${score.team2} **${score.team2Name}**`
        : '🔄 A aguardar score...';

    return new EmbedBuilder()
        .setTitle('🎮・Estamos a Jogar!')
        .setColor('#313137')
        .setDescription(`A Premade está a jogar!\n### Jogadores em campo:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`📊` Score Atual', value: scoreText, inline: true },
            { name: '`🔗` Match Room', value: `[Clica aqui](${matchUrl})`, inline: true }
        )
        .setFooter({ text: 'Score atualizado a cada 2 minutos' })
        .setTimestamp();
}

function buildFinishedEmbed(playerNames, mapName, matchUrl, score, won) {
    const resultIcon = won === true ? '✅' : won === false ? '❌' : '🏁';
    const resultText = won === true ? 'Vitória!' : won === false ? 'Derrota' : 'Resultado Final';
    const scoreText = score
        ? `**${score.team1Name}** ${score.team1} — ${score.team2} **${score.team2Name}**`
        : 'Sem dados';

    return new EmbedBuilder()
        .setTitle(`${resultIcon}・${resultText}`)
        .setColor(won === true ? '#57F287' : won === false ? '#ED4245' : '#313137')
        .setDescription(`A Premade terminou a partida!\n### Jogadores:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`📊` Resultado Final', value: scoreText, inline: true },
            { name: '`🔗` Match Room', value: `[Clica aqui](${matchUrl})`, inline: true }
        )
        .setTimestamp();
}

function extractScore(matchData) {
    try {
        const results = matchData.results;
        if (!results || !results.score) return null;

        const teamIds = Object.keys(results.score);
        if (teamIds.length < 2) return null;

        const team1Id = teamIds[0];
        const team2Id = teamIds[1];
        const team1Score = results.score[team1Id];
        const team2Score = results.score[team2Id];

        const team1Name = matchData.teams?.[team1Id]?.name || 'Equipa 1';
        const team2Name = matchData.teams?.[team2Id]?.name || 'Equipa 2';

        return { team1: team1Score, team2: team2Score, team1Name, team2Name, winnerId: results.winner };
    } catch (e) {
        return null;
    }
}

function didPremadeWin(matchData, premadeIds) {
    try {
        const winnerId = matchData.results?.winner;
        if (!winnerId) return null;

        const winningTeam = matchData.teams?.[winnerId];
        if (!winningTeam) return null;

        const winningRoster = winningTeam.roster || [];
        return winningRoster.some(p => premadeIds.includes(p.id) || premadeIds.includes(p.player_id));
    } catch (e) {
        return null;
    }
}

function setupWebhooks(client) {
    const app = express();
    app.use(express.json());

    app.post('/faceit-webhook', async (req, res) => {
        res.status(200).send('OK');

        try {
            const { event, payload } = req.body;

            // ── Partida a começar ──────────────────────────────────────────
            if (event === 'match_status_playing') {
                const teams = payload.teams;
                const teamValues = teams ? Object.values(teams) : [];
                if (teamValues.length < 2) return;

                const allPlayers = [
                    ...(teamValues[0].roster || []),
                    ...(teamValues[1].roster || [])
                ];

                const premadeIds = getPremadeIds();
                const premadeInMatch = allPlayers.filter(p =>
                    premadeIds.includes(p.id) || premadeIds.includes(p.player_id)
                );

                if (premadeInMatch.length === 0) return;

                const channelId = process.env.CANAL_AVISOS_ID;
                if (!channelId) { console.error('[Faceit Webhook] ERRO: CANAL_AVISOS_ID não configurado.'); return; }

                const channel = await client.channels.fetch(channelId);
                if (!channel) { console.error('[Faceit Webhook] ERRO: Canal não encontrado.'); return; }

                const matchId = payload.id;
                const mapName = payload.entity?.name || 'Desconhecido';
                const matchUrl = `https://www.faceit.com/en/cs2/room/${matchId}`;
                const playerNames = premadeInMatch.map(p => p.nickname).join(', ');

                console.log(`[Faceit Webhook] Partida iniciada: ${matchId} | Premade: ${playerNames}`);

                const msg = await channel.send({ embeds: [buildPlayingEmbed(playerNames, mapName, matchUrl, null)] });

                // Inicia polling para atualizar o score
                const intervalId = setInterval(async () => {
                    try {
                        const matchData = await fetchMatchScore(matchId);
                        if (!matchData) return;
                        const score = extractScore(matchData);
                        await msg.edit({ embeds: [buildPlayingEmbed(playerNames, mapName, matchUrl, score)] });
                        console.log(`[Faceit Webhook] Score atualizado para ${matchId}: ${score ? `${score.team1}-${score.team2}` : 'sem dados'}`);
                    } catch (e) {
                        console.error('[Faceit Webhook] Erro no polling:', e);
                    }
                }, POLLING_INTERVAL_MS);

                activeMatches.set(matchId, { intervalId, message: msg, playerNames, mapName, matchUrl });
                return;
            }

            // ── Partida terminada ──────────────────────────────────────────
            if (event === 'match_status_finished') {
                const matchId = payload.id;
                const active = activeMatches.get(matchId);

                if (!active) return; // Não era uma partida da premade

                clearInterval(active.intervalId);
                activeMatches.delete(matchId);

                console.log(`[Faceit Webhook] Partida terminada: ${matchId}`);

                const matchData = await fetchMatchScore(matchId);
                const score = matchData ? extractScore(matchData) : null;
                const premadeIds = getPremadeIds();
                const won = matchData ? didPremadeWin(matchData, premadeIds) : null;

                await active.message.edit({
                    embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.matchUrl, score, won)]
                });
                return;
            }

        } catch (error) {
            console.error('[Faceit Webhook] Ocorreu um erro ao processar o webhook:', error);
        }
    });

    const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[Webhooks] Servidor Express a escutar Webhooks da Faceit na porta ${PORT}`);
    });
}

module.exports = { setupWebhooks };
