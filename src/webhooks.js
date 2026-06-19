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

function buildFinishedEmbed(playerNames, mapName, matchUrl, score, won, demoUrl) {
    const resultIcon = won === true ? '✅' : won === false ? '❌' : '🏁';
    const resultText = won === true ? 'Vitória!' : won === false ? 'Derrota' : 'Resultado Final';
    const scoreText = score
        ? `**${score.team1Name}** ${score.team1} — ${score.team2} **${score.team2Name}**`
        : 'Sem dados';

    const embed = new EmbedBuilder()
        .setTitle(`${resultIcon}・${resultText}`)
        .setColor(won === true ? '#57F287' : won === false ? '#ED4245' : '#313137')
        .setDescription(`A Premade terminou a partida!\n### Jogadores:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`📊` Resultado Final', value: scoreText, inline: true },
            { name: '`🔗` Match Room', value: `[Clica aqui](${matchUrl})`, inline: true }
        );

    if (demoUrl) {
        embed.addFields({ name: '`🎥` GOTV Demo', value: `[Descarregar Demo](${demoUrl})`, inline: true });
    } else {
        embed.addFields({ name: '`🎥` GOTV Demo', value: '🔄 A processar demo...', inline: true });
    }

    embed.setTimestamp();
    return embed;
}

function buildWarmupEmbed(playerNames, mapName, matchUrl) {
    return new EmbedBuilder()
        .setTitle('🔥・Partida Encontrada!')
        .setColor('#FF5500')
        .setDescription(`A Premade está em aquecimento!\n### Jogadores em campo:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`🚦` Estado', value: '🔄 No aquecimento / Vetoes prontos', inline: true },
            { name: '`🔗` Match Room', value: `[Clica aqui](${matchUrl})`, inline: true }
        )
        .setTimestamp();
}

function buildCancelledEmbed(playerNames, mapName, matchUrl, reason) {
    return new EmbedBuilder()
        .setTitle('❌・Partida Cancelada')
        .setColor('#ED4245')
        .setDescription(`A partida da Premade foi cancelada.\n### Jogadores:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`ℹ️` Motivo', value: reason || 'Jogadores não se ligaram a tempo ou partida abortada.', inline: true },
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
            console.log(`[Faceit Webhook Debug] Webhook recebido — event: "${event}"`);

            // ── Partida em Aquecimento / Vetoes Prontos ────────────────────
            if (event === 'match_status_ready') {
                const teams = payload.teams;
                const teamValues = teams ? Object.values(teams) : [];
                if (teamValues.length < 2) {
                    console.log(`[Faceit Webhook Debug] Ignorado: Menos de 2 equipas (teamValues.length=${teamValues.length})`);
                    return;
                }

                const allPlayers = [
                    ...(teamValues[0].roster || []),
                    ...(teamValues[1].roster || [])
                ];

                const premadeIds = getPremadeIds();
                const premadeInMatch = allPlayers.filter(p =>
                    premadeIds.includes(p.id) || premadeIds.includes(p.player_id)
                );

                if (premadeInMatch.length === 0) {
                    console.log(`[Faceit Webhook Debug] Ignorado: Ninguém da premade na partida (premadeIds: [${premadeIds.join(', ')}])`);
                    return;
                }

                const channelId = process.env.CANAL_AVISOS_ID;
                if (!channelId) {
                    console.error('[Faceit Webhook Debug] Ignorado: CANAL_AVISOS_ID não configurado.');
                    return;
                }

                const channel = await client.channels.fetch(channelId);
                if (!channel) {
                    console.error(`[Faceit Webhook Debug] Ignorado: Canal não encontrado (id: ${channelId}).`);
                    return;
                }

                const matchId = payload.id;
                if (activeMatches.has(matchId)) {
                    console.log(`[Faceit Webhook Debug] Partida ${matchId} já está a ser monitorizada.`);
                    return;
                }

                const mapName = payload.entity?.name || 'Desconhecido';
                const matchUrl = `https://www.faceit.com/en/cs2/room/${matchId}`;
                const playerNames = premadeInMatch.map(p => p.nickname).join(', ');

                console.log(`[Faceit Webhook] Partida em aquecimento (Ready): ${matchId} | Premade: ${playerNames}`);

                const msg = await channel.send({ embeds: [buildWarmupEmbed(playerNames, mapName, matchUrl)] });

                activeMatches.set(matchId, {
                    message: msg,
                    playerNames,
                    mapName,
                    matchUrl,
                    state: 'ready',
                    intervalId: null
                });
                return;
            }

            // ── Partida a começar / Live ───────────────────────────────────
            if (event === 'match_status_playing') {
                const matchId = payload.id;
                let active = activeMatches.get(matchId);

                // Se já estiver na memória (veio do ready), atualizamos a mensagem existente
                if (active) {
                    console.log(`[Faceit Webhook] Partida live (Playing): ${matchId} | A atualizar mensagem existente.`);
                    
                    if (active.intervalId) {
                        clearInterval(active.intervalId);
                    }

                    await active.message.edit({ embeds: [buildPlayingEmbed(active.playerNames, active.mapName, active.matchUrl, null)] });

                    // Inicia polling para atualizar o score
                    const intervalId = setInterval(async () => {
                        try {
                            const matchData = await fetchMatchScore(matchId);
                            if (!matchData) return;
                            const score = extractScore(matchData);
                            await active.message.edit({ embeds: [buildPlayingEmbed(active.playerNames, active.mapName, active.matchUrl, score)] });
                            console.log(`[Faceit Webhook] Score atualizado para ${matchId}: ${score ? `${score.team1}-${score.team2}` : 'sem dados'}`);
                        } catch (e) {
                            console.error('[Faceit Webhook] Erro no polling:', e);
                        }
                    }, POLLING_INTERVAL_MS);

                    active.intervalId = intervalId;
                    active.state = 'playing';
                    activeMatches.set(matchId, active);
                    return;
                }

                // Fallback: Se não estiver na memória (por ex. bot reiniciou ou perdeu ready), criamos do zero
                const teams = payload.teams;
                const teamValues = teams ? Object.values(teams) : [];
                if (teamValues.length < 2) {
                    console.log(`[Faceit Webhook Debug] Ignorado: Menos de 2 equipas (teamValues.length=${teamValues.length})`);
                    return;
                }

                const allPlayers = [
                    ...(teamValues[0].roster || []),
                    ...(teamValues[1].roster || [])
                ];

                const premadeIds = getPremadeIds();
                const premadeInMatch = allPlayers.filter(p =>
                    premadeIds.includes(p.id) || premadeIds.includes(p.player_id)
                );

                if (premadeInMatch.length === 0) {
                    console.log(`[Faceit Webhook Debug] Ignorado: Ninguém da premade na partida (premadeIds: [${premadeIds.join(', ')}])`);
                    return;
                }

                const channelId = process.env.CANAL_AVISOS_ID;
                if (!channelId) {
                    console.error('[Faceit Webhook Debug] Ignorado: CANAL_AVISOS_ID não configurado.');
                    return;
                }

                const channel = await client.channels.fetch(channelId);
                if (!channel) {
                    console.error(`[Faceit Webhook Debug] Ignorado: Canal não encontrado (id: ${channelId}).`);
                    return;
                }

                const mapName = payload.entity?.name || 'Desconhecido';
                const matchUrl = `https://www.faceit.com/en/cs2/room/${matchId}`;
                const playerNames = premadeInMatch.map(p => p.nickname).join(', ');

                console.log(`[Faceit Webhook] Partida live (Playing - fallback): ${matchId} | Premade: ${playerNames}`);

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

                activeMatches.set(matchId, {
                    intervalId,
                    message: msg,
                    playerNames,
                    mapName,
                    matchUrl,
                    state: 'playing'
                });
                return;
            }

            // ── Partida terminada ──────────────────────────────────────────
            if (event === 'match_status_finished') {
                const matchId = payload.id;
                const active = activeMatches.get(matchId);

                if (!active) {
                    console.log(`[Faceit Webhook Debug] Ignorado: Partida "${matchId}" não estava a ser monitorizada (não era da premade ou bot reiniciou).`);
                    return;
                }

                if (active.intervalId) {
                    clearInterval(active.intervalId);
                }

                console.log(`[Faceit Webhook] Partida terminada: ${matchId}`);

                const matchData = await fetchMatchScore(matchId);
                const score = matchData ? extractScore(matchData) : null;
                const premadeIds = getPremadeIds();
                const won = matchData ? didPremadeWin(matchData, premadeIds) : null;
                const demoUrl = matchData?.demo_url?.[0] || (matchData?.demo_url && typeof matchData.demo_url === 'string' ? matchData.demo_url : null);

                await active.message.edit({
                    embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.matchUrl, score, won, demoUrl)]
                });

                if (demoUrl) {
                    // Se já temos a demo, completamos o fluxo e removemos
                    activeMatches.delete(matchId);
                } else {
                    // Se a demo ainda não estiver pronta, guardamos o estado final para o evento match_demo_ready
                    active.state = 'finished';
                    active.won = won;
                    active.score = score;
                    active.intervalId = null;
                    activeMatches.set(matchId, active);

                    // Segurança: Timeout de limpeza após 2 horas se o webhook da demo falhar
                    setTimeout(() => {
                        if (activeMatches.has(matchId) && activeMatches.get(matchId).state === 'finished') {
                            activeMatches.delete(matchId);
                            console.log(`[Faceit Webhook Debug] Limpeza automática da partida ${matchId} (timeout sem demo).`);
                        }
                    }, 2 * 60 * 60 * 1000);
                }
                return;
            }

            // ── Demo da partida pronta ─────────────────────────────────────
            if (event === 'match_demo_ready') {
                const matchId = payload.match_id || payload.id;
                const active = activeMatches.get(matchId);

                if (!active) {
                    console.log(`[Faceit Webhook Debug] Ignorado: Demo pronta para partida "${matchId}", mas a partida não estava em monitorização final.`);
                    return;
                }

                console.log(`[Faceit Webhook] Demo pronta para partida: ${matchId}`);

                const matchData = await fetchMatchScore(matchId);
                const demoUrl = matchData?.demo_url?.[0] || (matchData?.demo_url && typeof matchData.demo_url === 'string' ? matchData.demo_url : null) || payload.demo_url;

                if (demoUrl) {
                    await active.message.edit({
                        embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.matchUrl, active.score, active.won, demoUrl)]
                    });
                    console.log(`[Faceit Webhook] Embed editado com o link final da demo: ${demoUrl}`);
                } else {
                    console.log(`[Faceit Webhook Debug] Não foi possível obter o URL da demo para a partida ${matchId}.`);
                }

                activeMatches.delete(matchId);
                return;
            }

            // ── Partida cancelada ou abortada ──────────────────────────────
            if (event === 'match_status_cancelled' || event === 'match_status_aborted') {
                const matchId = payload.id;
                const active = activeMatches.get(matchId);

                if (!active) {
                    console.log(`[Faceit Webhook Debug] Ignorado: Partida "${matchId}" foi cancelada/abortada mas não estava a ser monitorizada.`);
                    return;
                }

                if (active.intervalId) {
                    clearInterval(active.intervalId);
                }

                console.log(`[Faceit Webhook] Partida cancelada/abortada: ${matchId}`);

                await active.message.edit({
                    embeds: [buildCancelledEmbed(active.playerNames, active.mapName, active.matchUrl, 'Partida Cancelada ou Abortada na Faceit.')]
                });

                activeMatches.delete(matchId);
                return;
            }

            console.log(`[Faceit Webhook Debug] Ignorado: Evento "${event}" não é tratado por este bot.`);

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
