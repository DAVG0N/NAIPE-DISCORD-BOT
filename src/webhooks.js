const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = path.join(__dirname, '../data/bd.json');
const POLLING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutos

// Mapa de partidas ativas: matchId -> { intervalId, message, playerNames, matchUrl }
const activeMatches = new Map();

// Mapa de alertas de partidas: matchId -> { halftimeSent, matchpointSent, overtimeSent }
const activeMatchesAlerts = new Map();

function buildMatchButtons(matchUrl, demoUrl = null) {
    const row = new ActionRowBuilder();
    
    // Botão 1: Match Room (Sempre ativo)
    const matchRoomBtn = new ButtonBuilder()
        .setLabel('Match Room')
        .setStyle(ButtonStyle.Link)
        .setURL(matchUrl);
        
    // Botão 2: GOTV Demo
    let demoBtn;
    if (demoUrl) {
        demoBtn = new ButtonBuilder()
            .setLabel('GOTV Demo')
            .setStyle(ButtonStyle.Link)
            .setURL(demoUrl)
            .setDisabled(false);
    } else {
        demoBtn = new ButtonBuilder()
            .setCustomId('disabled_demo')
            .setLabel('GOTV Demo')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true);
    }
    
    row.addComponents(matchRoomBtn, demoBtn);
    return row;
}

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

function getPremadeFaction(payload, premadeIds) {
    try {
        const teams = payload.teams;
        if (!teams) return null;
        for (const faction of ['faction1', 'faction2']) {
            const roster = teams[faction]?.roster || [];
            if (roster.some(p => premadeIds.includes(p.id) || premadeIds.includes(p.player_id))) {
                return faction;
            }
        }
    } catch (e) {
        console.error('[Faceit Webhook] Erro ao obter fação da premade:', e);
    }
    return null;
}

function getPremadeFactionFromMatchData(matchData, premadeIds) {
    try {
        const teams = matchData.teams;
        if (!teams) return null;
        for (const faction of ['faction1', 'faction2']) {
            const roster = teams[faction]?.roster || [];
            if (roster.some(p => premadeIds.includes(p.id) || premadeIds.includes(p.player_id))) {
                return faction;
            }
        }
    } catch (e) {
        console.error('[Faceit Webhook] Erro ao obter fação da premade do matchData:', e);
    }
    return null;
}

function getPremadeMapping() {
    try {
        if (!fs.existsSync(LEADERBOARD_FILE)) return new Map();
        const data = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf-8'));
        const mapping = new Map();
        for (const p of data) {
            if (p.player_id) {
                mapping.set(p.player_id, {
                    discordId: p.discord_id,
                    nickname: p.nickname
                });
            }
        }
        return mapping;
    } catch (e) {
        console.error('[Faceit Webhook] Erro a ler bd.json para mapeamento:', e);
        return new Map();
    }
}

async function fetchMatchStats(matchId) {
    const apiKey = process.env.FACEIT_API_KEY;
    if (!apiKey) return null;
    
    const url = `https://open.faceit.com/data/v4/matches/${matchId}/stats`;
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            console.log(`[Faceit Webhook] A tentar obter estatísticas da partida ${matchId} (Tentativa ${attempt}/4)...`);
            const res = await fetch(url, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.rounds && data.rounds.length > 0) {
                    console.log(`[Faceit Webhook] Estatísticas da partida ${matchId} obtidas com sucesso na tentativa ${attempt}.`);
                    return data;
                }
            }
            console.warn(`[Faceit Webhook] Tentativa ${attempt} falhou com status ${res.status}.`);
        } catch (e) {
            console.error(`[Faceit Webhook] Erro na tentativa ${attempt} de obter stats para ${matchId}:`, e);
        }
        
        if (attempt < 4) {
            await sleep(3000);
        }
    }
    return null;
}

async function checkAndSendLiveFeedAlerts(client, matchId, active, score) {
    if (!score) return;
    
    if (!activeMatchesAlerts.has(matchId)) {
        activeMatchesAlerts.set(matchId, {
            halftimeSent: false,
            matchpointSent: false,
            overtimeSent: false
        });
    }

    const alerts = activeMatchesAlerts.get(matchId);
    const totalScore = score.team1 + score.team2;
    const channelId = process.env.CANAL_AVISOS_ID;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        // 1. Half-Time alert
        if (totalScore === 12 && !alerts.halftimeSent) {
            alerts.halftimeSent = true;
            activeMatchesAlerts.set(matchId, alerts);

            let ourTeamName = 'Premade';
            let opponentName = 'Adversário';
            let ourTeamScore = 0;
            let opponentScore = 0;

            if (active.premadeFaction === 'faction1') {
                ourTeamName = score.team1Name;
                ourTeamScore = score.team1;
                opponentName = score.team2Name;
                opponentScore = score.team2;
            } else if (active.premadeFaction === 'faction2') {
                ourTeamName = score.team2Name;
                ourTeamScore = score.team2;
                opponentName = score.team1Name;
                opponentScore = score.team1;
            } else {
                ourTeamName = score.team1Name;
                ourTeamScore = score.team1;
                opponentName = score.team2Name;
                opponentScore = score.team2;
            }

            await channel.send(`🔄 Mudança de lado! **${ourTeamName}** ${ourTeamScore} - ${opponentScore} **${opponentName}**`);
            console.log(`[Faceit Webhook] Alerta Half-Time enviado para ${matchId}: ${ourTeamScore}-${opponentScore}`);
        }

        // 2. Match Point alert
        if (((score.team1 === 12 && score.team2 < 12) || (score.team2 === 12 && score.team1 < 12)) && !alerts.matchpointSent) {
            alerts.matchpointSent = true;
            activeMatchesAlerts.set(matchId, alerts);

            const matchPointTeamName = score.team1 === 12 ? score.team1Name : score.team2Name;

            await channel.send(`🔥 MATCH POINT para **${matchPointTeamName}**!`);
            console.log(`[Faceit Webhook] Alerta Match Point enviado para ${matchId}: ${matchPointTeamName}`);
        }

        // 3. Overtime alert
        if (score.team1 === 12 && score.team2 === 12 && !alerts.overtimeSent) {
            alerts.overtimeSent = true;
            activeMatchesAlerts.set(matchId, alerts);

            await channel.send(`🥵 OVERTIME! Puxem pelas cadeiras!`);
            console.log(`[Faceit Webhook] Alerta Overtime enviado para ${matchId}`);
        }
    } catch (e) {
        console.error(`[Faceit Webhook] Erro ao enviar alertas do Live Feed para ${matchId}:`, e);
    }
}

async function sendPremadePerformanceSummary(client, matchId, channel) {
    try {
        const statsData = await fetchMatchStats(matchId);
        if (!statsData || !statsData.rounds || statsData.rounds.length === 0) {
            console.warn(`[Faceit Webhook] Não foi possível obter estatísticas válidas para a partida ${matchId}.`);
            return;
        }

        const premadeMapping = getPremadeMapping();
        const statsMap = new Map();

        for (const round of statsData.rounds) {
            const teams = round.teams || [];
            for (const team of teams) {
                const players = team.players || [];
                for (const player of players) {
                    const playerId = player.player_id;
                    if (premadeMapping.has(playerId)) {
                        const dbPlayer = premadeMapping.get(playerId);
                        const playerStats = player.player_stats || {};
                        const kills = parseInt(playerStats['Kills'] || '0', 10);
                        const ratingStr = playerStats['FACEIT Rating'] || playerStats['Match Rating'] || playerStats['rating'];
                        const rating = ratingStr && !isNaN(parseFloat(ratingStr)) ? parseFloat(ratingStr) : null;
                        
                        if (!statsMap.has(playerId)) {
                            statsMap.set(playerId, {
                                nickname: player.nickname || dbPlayer.nickname,
                                discordId: dbPlayer.discordId,
                                kills: 0,
                                ratings: []
                            });
                        }
                        
                        const entry = statsMap.get(playerId);
                        entry.kills += kills;
                        if (rating !== null) {
                            entry.ratings.push(rating);
                        }
                    }
                }
            }
        }

        if (statsMap.size === 0) {
            console.log(`[Faceit Webhook] Nenhum jogador da premade encontrado nas estatísticas da partida ${matchId}.`);
            return;
        }

        const premadePlayersStats = [];
        for (const [playerId, entry] of statsMap.entries()) {
            let finalRating = 'N/A';
            if (entry.ratings.length > 0) {
                const sum = entry.ratings.reduce((a, b) => a + b, 0);
                const avg = sum / entry.ratings.length;
                finalRating = avg.toFixed(2);
            }
            premadePlayersStats.push({
                nickname: entry.nickname,
                discordId: entry.discordId,
                kills: entry.kills.toString(),
                rating: finalRating
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('📊・Resumo de Desempenho da Premade')
            .setColor('#FFD700')
            .setTimestamp();

        let descriptionText = 'Estatísticas individuais da nossa premade nesta partida:\n\n';
        for (const pStats of premadePlayersStats) {
            const userMention = pStats.discordId ? `<@${pStats.discordId}>` : `**${pStats.nickname}**`;
            descriptionText += `👤 ${userMention}\n└ 🔫 **Kills:** \`${pStats.kills}\`  •  ⭐ **Rating:** \`${pStats.rating}\`\n\n`;
        }
        
        embed.setDescription(descriptionText);

        await channel.send({ embeds: [embed] });
        console.log(`[Faceit Webhook] Resumo de performance enviado para a partida ${matchId}.`);
    } catch (e) {
        console.error(`[Faceit Webhook] Erro ao enviar resumo de performance para ${matchId}:`, e);
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

function buildPlayingEmbed(playerNames, mapName, score) {
    const scoreText = score
        ? `**${score.team1Name}** ${score.team1} — ${score.team2} **${score.team2Name}**`
        : '🔄 A aguardar score...';

    return new EmbedBuilder()
        .setTitle('🎮・Estamos a Jogar!')
        .setColor('#313137')
        .setDescription(`A Premade está a jogar!\n### Jogadores em campo:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`📊` Score Atual', value: scoreText, inline: true }
        )
        .setFooter({ text: 'Score atualizado a cada 2 minutos' })
        .setTimestamp();
}

function buildFinishedEmbed(playerNames, mapName, score, won) {
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
            { name: '`📊` Resultado Final', value: scoreText, inline: true }
        )
        .setTimestamp();
}

function buildWarmupEmbed(playerNames, mapName) {
    return new EmbedBuilder()
        .setTitle('🔥・Partida Encontrada!')
        .setColor('#FF5500')
        .setDescription(`A Premade está em aquecimento!\n### Jogadores em campo:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`🚦` Estado', value: '🔄 No aquecimento / Vetoes prontos', inline: true }
        )
        .setTimestamp();
}

function buildCancelledEmbed(playerNames, mapName, reason) {
    return new EmbedBuilder()
        .setTitle('❌・Partida Cancelada')
        .setColor('#ED4245')
        .setDescription(`A partida da Premade foi cancelada.\n### Jogadores:\n > ${playerNames}`)
        .addFields(
            { name: '`🗺️` Mapa', value: mapName, inline: true },
            { name: '`ℹ️` Motivo', value: reason || 'Jogadores não se ligaram a tempo ou partida abortada.', inline: true }
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

                const msg = await channel.send({ 
                    embeds: [buildWarmupEmbed(playerNames, mapName)],
                    components: [buildMatchButtons(matchUrl, null)]
                });

                const premadeFaction = getPremadeFaction(payload, premadeIds);

                activeMatches.set(matchId, {
                    message: msg,
                    playerNames,
                    mapName,
                    matchUrl,
                    state: 'ready',
                    intervalId: null,
                    premadeFaction
                });

                activeMatchesAlerts.set(matchId, {
                    halftimeSent: false,
                    matchpointSent: false,
                    overtimeSent: false
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

                    if (!active.premadeFaction) {
                        const premadeIds = getPremadeIds();
                        active.premadeFaction = getPremadeFaction(payload, premadeIds);
                    }

                    await active.message.edit({ 
                        embeds: [buildPlayingEmbed(active.playerNames, active.mapName, null)],
                        components: [buildMatchButtons(active.matchUrl, null)]
                    });

                    // Inicia polling para atualizar o score
                    const intervalId = setInterval(async () => {
                        try {
                            const matchData = await fetchMatchScore(matchId);
                            if (!matchData) return;

                            if (!active.premadeFaction) {
                                const premadeIds = getPremadeIds();
                                active.premadeFaction = getPremadeFactionFromMatchData(matchData, premadeIds);
                            }

                            const score = extractScore(matchData);
                            await active.message.edit({ 
                                embeds: [buildPlayingEmbed(active.playerNames, active.mapName, score)],
                                components: [buildMatchButtons(active.matchUrl, null)]
                            });
                            console.log(`[Faceit Webhook] Score atualizado para ${matchId}: ${score ? `${score.team1}-${score.team2}` : 'sem dados'}`);

                            if (score) {
                                await checkAndSendLiveFeedAlerts(client, matchId, active, score);
                            }
                        } catch (e) {
                            console.error('[Faceit Webhook] Erro no polling:', e);
                        }
                    }, POLLING_INTERVAL_MS);

                    active.intervalId = intervalId;
                    active.state = 'playing';
                    activeMatches.set(matchId, active);

                    if (!activeMatchesAlerts.has(matchId)) {
                        activeMatchesAlerts.set(matchId, {
                            halftimeSent: false,
                            matchpointSent: false,
                            overtimeSent: false
                        });
                    }
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

                const msg = await channel.send({ 
                    embeds: [buildPlayingEmbed(playerNames, mapName, null)],
                    components: [buildMatchButtons(matchUrl, null)]
                });

                const premadeFaction = getPremadeFaction(payload, premadeIds);
                const activeState = {
                    intervalId: null,
                    message: msg,
                    playerNames,
                    mapName,
                    matchUrl,
                    state: 'playing',
                    premadeFaction
                };

                // Inicia polling para atualizar o score
                const intervalId = setInterval(async () => {
                    try {
                        const matchData = await fetchMatchScore(matchId);
                        if (!matchData) return;

                        if (!activeState.premadeFaction) {
                            activeState.premadeFaction = getPremadeFactionFromMatchData(matchData, premadeIds);
                        }

                        const score = extractScore(matchData);
                        await msg.edit({ 
                            embeds: [buildPlayingEmbed(playerNames, mapName, score)],
                            components: [buildMatchButtons(matchUrl, null)]
                        });
                        console.log(`[Faceit Webhook] Score atualizado para ${matchId}: ${score ? `${score.team1}-${score.team2}` : 'sem dados'}`);

                        if (score) {
                            await checkAndSendLiveFeedAlerts(client, matchId, activeState, score);
                        }
                    } catch (e) {
                        console.error('[Faceit Webhook] Erro no polling:', e);
                    }
                }, POLLING_INTERVAL_MS);

                activeState.intervalId = intervalId;
                activeMatches.set(matchId, activeState);

                activeMatchesAlerts.set(matchId, {
                    halftimeSent: false,
                    matchpointSent: false,
                    overtimeSent: false
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
                    embeds: [buildFinishedEmbed(active.playerNames, active.mapName, score, won)],
                    components: [buildMatchButtons(active.matchUrl, demoUrl)]
                });

                const channelId = process.env.CANAL_AVISOS_ID;
                if (channelId) {
                    const channel = await client.channels.fetch(channelId).catch(() => null);
                    if (channel) {
                        sendPremadePerformanceSummary(client, matchId, channel);
                    }
                }

                if (demoUrl) {
                    activeMatches.delete(matchId);
                    activeMatchesAlerts.delete(matchId);
                } else {
                    active.state = 'finished';
                    active.won = won;
                    active.score = score;
                    active.intervalId = null;
                    activeMatches.set(matchId, active);
                    activeMatchesAlerts.delete(matchId);

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
                        embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.score, active.won)],
                        components: [buildMatchButtons(active.matchUrl, demoUrl)]
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
                    embeds: [buildCancelledEmbed(active.playerNames, active.mapName, 'Partida Cancelada ou Abortada na Faceit.')],
                    components: [buildMatchButtons(active.matchUrl, null)]
                });

                activeMatches.delete(matchId);
                activeMatchesAlerts.delete(matchId);
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
