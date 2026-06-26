const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = path.join(__dirname, '../data/bd.json');
const POLLING_INTERVAL_MS = 30 * 1000; // 30 segundos

// Mapa de partidas ativas: matchId -> { intervalId, message, playerNames, matchUrl }
const activeMatches = new Map();

// Mapa de alertas de partidas: matchId -> { halftimeSent, matchpointSent, overtimeSent }
const activeMatchesAlerts = new Map();

// Mapeamento de nome/código do mapa para a URL da imagem da thumbnail
const MAP_THUMBNAILS = {
    'de_mirage': 'https://static.wikia.nocookie.net/cswikia/images/f/f5/De_mirage_cs2.png/revision/latest?cb=20230807124319',
    'Mirage': 'https://static.wikia.nocookie.net/cswikia/images/f/f5/De_mirage_cs2.png/revision/latest?cb=20230807124319',
    'de_inferno': 'https://static.wikia.nocookie.net/cswikia/images/1/17/Cs2_inferno_remake.png/revision/latest/scale-to-width-down/1000?cb=20260304235624',
    'Inferno': 'https://static.wikia.nocookie.net/cswikia/images/1/17/Cs2_inferno_remake.png/revision/latest/scale-to-width-down/1000?cb=20260304235624',
    'de_dust2': 'https://static.wikia.nocookie.net/cswikia/images/1/16/Cs2_dust2.png/revision/latest/scale-to-width-down/1000?cb=20230913150804',
    'Dust2': 'https://static.wikia.nocookie.net/cswikia/images/1/16/Cs2_dust2.png/revision/latest/scale-to-width-down/1000?cb=20230913150804',
    'de_nuke': 'https://static.wikia.nocookie.net/cswikia/images/d/d6/De_nuke_cs2.png/revision/latest/scale-to-width-down/1000?cb=20240426010253',
    'Nuke': 'https://static.wikia.nocookie.net/cswikia/images/d/d6/De_nuke_cs2.png/revision/latest/scale-to-width-down/1000?cb=20240426010253',
    'de_ancient': 'https://static.wikia.nocookie.net/cswikia/images/5/5c/De_ancient_cs2.png/revision/latest/scale-to-width-down/1000?cb=20250815011913',
    'Ancient': 'https://static.wikia.nocookie.net/cswikia/images/5/5c/De_ancient_cs2.png/revision/latest/scale-to-width-down/1000?cb=20250815011913',
    'de_anubis': 'https://static.wikia.nocookie.net/cswikia/images/a/a0/CS2_Anubis_B_site.png/revision/latest/scale-to-width-down/1000?cb=20260122021359',
    'Anubis': 'https://static.wikia.nocookie.net/cswikia/images/a/a0/CS2_Anubis_B_site.png/revision/latest/scale-to-width-down/1000?cb=20260122021359',
    'de_vertigo': 'https://static.wikia.nocookie.net/cswikia/images/8/88/De_vertigo_cs2.jpg/revision/latest/scale-to-width-down/1000?cb=20231009185617',
    'Vertigo': 'https://static.wikia.nocookie.net/cswikia/images/8/88/De_vertigo_cs2.jpg/revision/latest/scale-to-width-down/1000?cb=20231009185617',
    'de_cache': 'https://static.wikia.nocookie.net/cswikia/images/5/5b/De_cache_cs2.png/revision/latest/scale-to-width-down/1000?cb=20260429100503',
    'Cache': 'https://static.wikia.nocookie.net/cswikia/images/5/5b/De_cache_cs2.png/revision/latest/scale-to-width-down/1000?cb=20260429100503',
    'de_overpass': 'https://static.wikia.nocookie.net/cswikia/images/5/55/Overpass_loading_screen.png/revision/latest/scale-to-width-down/1000?cb=20250730205333',
    'Overpass': 'https://static.wikia.nocookie.net/cswikia/images/5/55/Overpass_loading_screen.png/revision/latest/scale-to-width-down/1000?cb=20250730205333',
    'de_train': 'https://static.wikia.nocookie.net/cswikia/images/2/2c/De_train_cs2_new.png/revision/latest/scale-to-width-down/1000?cb=20250730205931',
    'Train': 'https://static.wikia.nocookie.net/cswikia/images/2/2c/De_train_cs2_new.png/revision/latest/scale-to-width-down/1000?cb=20250730205931'
};

const DEFAULT_MAP_THUMBNAIL = 'https://upload.wikimedia.org/wikipedia/commons/e/e3/Counter_Strike_2_Logo.png';


function getMapThumbnail(mapName) {
    if (!mapName) return null;
    const normalized = mapName.toLowerCase().trim();
    const key = Object.keys(MAP_THUMBNAILS).find(k => k.toLowerCase() === normalized);
    return key ? MAP_THUMBNAILS[key] : null;
}

function extractMapName(matchData) {
    if (!matchData) return null;
    const pickedMapCode = matchData.voting?.map?.pick?.[0];
    if (!pickedMapCode) return null;
    const mapEntity = matchData.voting?.map?.entities?.find(e =>
        e.guid === pickedMapCode ||
        e.game_map_id === pickedMapCode ||
        e.class_name === pickedMapCode
    );
    return mapEntity ? mapEntity.name : pickedMapCode;
}


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

    active.alertsLog = active.alertsLog || [];

    try {
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

            const alertText = `🔄 Mudança de lado! ${ourTeamName} ${ourTeamScore} - ${opponentScore} ${opponentName}`;
            active.alertsLog.push(alertText);
            console.log(`[Faceit Webhook] Alerta Half-Time registado para ${matchId}: ${ourTeamScore}-${opponentScore}`);
        }

        // 2. Match Point alert
        if (((score.team1 === 12 && score.team2 < 12) || (score.team2 === 12 && score.team1 < 12)) && !alerts.matchpointSent) {
            alerts.matchpointSent = true;
            activeMatchesAlerts.set(matchId, alerts);

            const matchPointTeamName = score.team1 === 12 ? score.team1Name : score.team2Name;
            const alertText = `🔥 MATCH POINT para ${matchPointTeamName}!`;
            active.alertsLog.push(alertText);
            console.log(`[Faceit Webhook] Alerta Match Point registado para ${matchId}: ${matchPointTeamName}`);
        }

        // 3. Overtime alert
        if (score.team1 === 12 && score.team2 === 12 && !alerts.overtimeSent) {
            alerts.overtimeSent = true;
            activeMatchesAlerts.set(matchId, alerts);

            const alertText = `🥵 OVERTIME! Puxem pelas cadeiras!`;
            active.alertsLog.push(alertText);
            console.log(`[Faceit Webhook] Alerta Overtime registado para ${matchId}`);
        }
    } catch (e) {
        console.error(`[Faceit Webhook] Erro ao processar alertas do Live Feed para ${matchId}:`, e);
    }
}

function startMatchPolling(client, matchId) {
    const active = activeMatches.get(matchId);
    if (active && active.intervalId) {
        clearInterval(active.intervalId);
    }

    const intervalId = setInterval(async () => {
        try {
            const matchData = await fetchMatchScore(matchId);
            if (!matchData) return;

            const activeState = activeMatches.get(matchId);
            if (!activeState) {
                clearInterval(intervalId);
                return;
            }

            // Tenta obter o nome real do mapa a partir da API se ainda não o tivermos
            if (!activeState.mapName || activeState.mapName === 'Desconhecido' || activeState.mapName.toLowerCase().includes('5v5')) {
                const apiMapName = extractMapName(matchData);
                if (apiMapName) {
                    activeState.mapName = apiMapName;
                    console.log(`[Faceit Webhook] Nome do mapa atualizado via API para a partida ${matchId}: ${apiMapName}`);
                }
            }

            if (!activeState.premadeFaction) {
                const premadeIds = getPremadeIds();
                activeState.premadeFaction = getPremadeFactionFromMatchData(matchData, premadeIds);
            }

            const status = matchData.status;
            const isLive = status === 'ONGOING' || status === 'LIVE';
            const score = extractScore(matchData);

            if (isLive) {
                if (activeState.state === 'ready') {
                    activeState.state = 'playing';
                    console.log(`[Faceit Webhook] Partida ${matchId} passou de READY a LIVE/ONGOING.`);
                }

                if (score) {
                    await checkAndSendLiveFeedAlerts(client, matchId, activeState, score);
                }

                await activeState.message.edit({
                    embeds: [buildPlayingEmbed(activeState.playerNames, activeState.mapName, score, activeState.alertsLog)],
                    components: [buildMatchButtons(activeState.matchUrl, null)]
                });
            }

            activeMatches.set(matchId, activeState);
        } catch (e) {
            console.error(`[Faceit Webhook] Erro no polling de score para a partida ${matchId}:`, e);
        }
    }, POLLING_INTERVAL_MS);

    return intervalId;
}

async function updateFinishedEmbedWithStats(client, matchId) {
    try {
        const statsData = await fetchMatchStats(matchId);
        if (!statsData || !statsData.rounds || statsData.rounds.length === 0) {
            console.warn(`[Faceit Webhook] Não foi possível obter estatísticas válidas para a partida ${matchId}.`);

            const active = activeMatches.get(matchId);
            if (active) {
                active.premadeStatsText = '⚠️ Não foi possível obter as estatísticas do jogo.';
                await active.message.edit({
                    embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.score, active.won, active.premadeStatsText, active.alertsLog)],
                    components: [buildMatchButtons(active.matchUrl, active.demoUrl || null)]
                });
                activeMatches.set(matchId, active);
            }
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
                        const deaths = parseInt(playerStats['Deaths'] || '0', 10);
                        const assists = parseInt(playerStats['Assists'] || '0', 10);
                        const ratingStr = playerStats['FACEIT Rating'] || playerStats['Match Rating'] || playerStats['rating'];
                        const rating = ratingStr && !isNaN(parseFloat(ratingStr)) ? parseFloat(ratingStr) : null;

                        if (!statsMap.has(playerId)) {
                            statsMap.set(playerId, {
                                nickname: player.nickname || dbPlayer.nickname,
                                discordId: dbPlayer.discordId,
                                kills: 0,
                                deaths: 0,
                                assists: 0,
                                ratings: []
                            });
                        }

                        const entry = statsMap.get(playerId);
                        entry.kills += kills;
                        entry.deaths += deaths;
                        entry.assists += assists;
                        if (rating !== null) {
                            entry.ratings.push(rating);
                        }
                    }
                }
            }
        }

        const active = activeMatches.get(matchId);
        if (!active) {
            console.log(`[Faceit Webhook] Partida ${matchId} já não está na memória para atualizar estatísticas.`);
            return;
        }

        if (statsMap.size === 0) {
            console.log(`[Faceit Webhook] Nenhum jogador da premade encontrado nas estatísticas da partida ${matchId}.`);
            active.premadeStatsText = 'Nenhum jogador da premade participou.';
            await active.message.edit({
                embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.score, active.won, active.premadeStatsText, active.alertsLog)],
                components: [buildMatchButtons(active.matchUrl, active.demoUrl || null)]
            });
            activeMatches.set(matchId, active);
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
                kills: entry.kills,
                deaths: entry.deaths,
                assists: entry.assists,
                rating: finalRating
            });
        }

        // Ordenar por Kills descrescente
        premadePlayersStats.sort((a, b) => b.kills - a.kills);

        let descriptionText = '';
        for (const pStats of premadePlayersStats) {
            const userMention = pStats.discordId ? `<@${pStats.discordId}>` : `**${pStats.nickname}**`;
            descriptionText += `> ${userMention} **K/D/A:** \`${pStats.kills}/${pStats.deaths}/${pStats.assists}\`  |  **Rating:** \`${pStats.rating}\`\n`;
        }

        active.premadeStatsText = descriptionText.trim();
        const demoUrl = active.demoUrl || null;

        await active.message.edit({
            embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.score, active.won, active.premadeStatsText, active.alertsLog)],
            components: [buildMatchButtons(active.matchUrl, demoUrl)]
        });

        activeMatches.set(matchId, active);
        console.log(`[Faceit Webhook] Embed de partida final editado com resumo de performance (ordenado por kills) para a partida ${matchId}.`);
    } catch (e) {
        console.error(`[Faceit Webhook] Erro ao atualizar embed final com stats para ${matchId}:`, e);
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

function buildPlayingEmbed(playerNames, mapName, score, alertsLog) {
    const scoreText = score
        ? `**${score.team1Name}** ${score.team1} — ${score.team2} **${score.team2Name}**`
        : '🔄 A aguardar score...';

    let titleText = '🔴・Live!';
    if (score) {
        titleText = `🔴・Live! — ${scoreText}`;
    }

    let description = `### Jogadores em campo:\n${playerNames}`;
    if (alertsLog && alertsLog.length > 0) {
        description += `\n\n\`\`\`\n${alertsLog.join('\n')}\n\`\`\``;
    }

    const embed = new EmbedBuilder()
        .setTitle(titleText)
        .setColor('#313137')
        .setDescription(description)
        .setFooter({ text: 'Embed atualizado em tempo real!' })
        .setTimestamp();

    const thumbnailUrl = getMapThumbnail(mapName);
    if (thumbnailUrl) {
        embed.setThumbnail(thumbnailUrl);
    } else {
        embed.setThumbnail(DEFAULT_MAP_THUMBNAIL);
        embed.addFields({ name: '`🗺️` Mapa', value: mapName, inline: true });
    }

    return embed;
}

function buildFinishedEmbed(playerNames, mapName, score, won, premadeStatsText = null, alertsLog = null) {
    const resultIcon = won === true ? '✅' : won === false ? '❌' : '🏁';
    const resultText = won === true ? 'Vitória' : won === false ? 'Derrota' : 'Resultado Final';
    const scoreText = score
        ? `**${score.team1Name}** ${score.team1} — ${score.team2} **${score.team2Name}**`
        : 'Sem dados';

    let titleText = `${resultIcon}・${resultText}`;
    if (score) {
        const winnerName = score.winnerId === 'faction1' ? score.team1Name : (score.winnerId === 'faction2' ? score.team2Name : 'outra equipa');
        titleText = `${resultIcon}・${resultText} — ${score.team1} - ${score.team2} para a equipa ${winnerName}`;
    }

    let description = `### Jogadores:\n${premadeStatsText || (playerNames + '\n\n🔄 *A carregar estatísticas...*')}`;
    if (alertsLog && alertsLog.length > 0) {
        description += `\n\n\`\`\`\n${alertsLog.join('\n')}\n\`\`\``;
    }

    const embed = new EmbedBuilder()
        .setTitle(titleText)
        .setColor(won === true ? '#57F287' : won === false ? '#ED4245' : '#313137')
        .setDescription(description)
        .setTimestamp();

    const thumbnailUrl = getMapThumbnail(mapName);
    if (thumbnailUrl) {
        embed.setThumbnail(thumbnailUrl);
    } else {
        embed.setThumbnail(DEFAULT_MAP_THUMBNAIL);
        embed.addFields({ name: '`🗺️` Mapa', value: mapName, inline: true });
    }

    return embed;
}

function buildWarmupEmbed(playerNames, mapName) {
    const embed = new EmbedBuilder()
        .setTitle('🔥・Partida Encontrada!')
        .setColor('#FF5500')
        .setDescription(`### Jogadores em campo:\n${playerNames}`)
        .addFields(
            { name: '`🚦` Estado', value: '🔄 No aquecimento / Vetoes prontos', inline: true }
        )
        .setTimestamp();

    const thumbnailUrl = getMapThumbnail(mapName);
    if (thumbnailUrl) {
        embed.setThumbnail(thumbnailUrl);
    } else {
        embed.setThumbnail(DEFAULT_MAP_THUMBNAIL);
        embed.addFields({ name: '`🗺️` Mapa', value: mapName, inline: true });
    }

    return embed;
}

function buildCancelledEmbed(playerNames, mapName, reason) {
    const embed = new EmbedBuilder()
        .setTitle('❌・Partida Cancelada')
        .setColor('#ED4245')
        .setDescription(`### Jogadores:\n${playerNames}`)
        .addFields(
            { name: '`ℹ️` Motivo', value: reason || 'Jogadores não se ligaram a tempo ou partida abortada.', inline: true }
        )
        .setTimestamp();

    const thumbnailUrl = getMapThumbnail(mapName);
    if (thumbnailUrl) {
        embed.setThumbnail(thumbnailUrl);
    } else {
        embed.setThumbnail(DEFAULT_MAP_THUMBNAIL);
        embed.addFields({ name: '`🗺️` Mapa', value: mapName, inline: true });
    }

    return embed;
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

                let mapName = payload.entity?.name || 'Desconhecido';
                // Tenta obter o mapa real da API logo no início
                const matchData = await fetchMatchScore(matchId);
                const apiMapName = extractMapName(matchData);
                if (apiMapName) {
                    mapName = apiMapName;
                }

                const matchUrl = `https://www.faceit.com/en/cs2/room/${matchId}`;

                const nicknames = premadeInMatch.map(p => p.nickname).join(', ');
                const mapping = getPremadeMapping();
                const playerNames = premadeInMatch.map(p => {
                    const pid = p.id || p.player_id;
                    const dbPlayer = mapping.get(pid);
                    return dbPlayer?.discordId ? `<@${dbPlayer.discordId}>` : (p.nickname || dbPlayer?.nickname || 'Jogador');
                }).map(name => `> ${name}`).join('\n');

                console.log(`[Faceit Webhook] Partida em aquecimento (Ready): ${matchId} | Premade: ${nicknames}`);

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
                    premadeFaction,
                    alertsLog: []
                });

                activeMatchesAlerts.set(matchId, {
                    halftimeSent: false,
                    matchpointSent: false,
                    overtimeSent: false
                });

                const intervalId = startMatchPolling(client, matchId);
                const activeState = activeMatches.get(matchId);
                if (activeState) {
                    activeState.intervalId = intervalId;
                    activeMatches.set(matchId, activeState);
                }

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

                    // Tenta obter o mapa real da API se ainda estiver genérico
                    if (!active.mapName || active.mapName === 'Desconhecido' || active.mapName.toLowerCase().includes('5v5')) {
                        const matchData = await fetchMatchScore(matchId);
                        const apiMapName = extractMapName(matchData);
                        if (apiMapName) {
                            active.mapName = apiMapName;
                        }
                    }

                    if (!active.premadeFaction) {
                        const premadeIds = getPremadeIds();
                        active.premadeFaction = getPremadeFaction(payload, premadeIds);
                    }

                    if (!active.alertsLog) {
                        active.alertsLog = [];
                    }

                    await active.message.edit({
                        embeds: [buildPlayingEmbed(active.playerNames, active.mapName, null, active.alertsLog)],
                        components: [buildMatchButtons(active.matchUrl, null)]
                    });

                    const intervalId = startMatchPolling(client, matchId);
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

                let mapName = payload.entity?.name || 'Desconhecido';
                // Tenta obter o mapa real da API logo no início (fallback)
                const matchData = await fetchMatchScore(matchId);
                const apiMapName = extractMapName(matchData);
                if (apiMapName) {
                    mapName = apiMapName;
                }
                const matchUrl = `https://www.faceit.com/en/cs2/room/${matchId}`;

                const nicknames = premadeInMatch.map(p => p.nickname).join(', ');
                const mapping = getPremadeMapping();
                const playerNames = premadeInMatch.map(p => {
                    const pid = p.id || p.player_id;
                    const dbPlayer = mapping.get(pid);
                    return dbPlayer?.discordId ? `<@${dbPlayer.discordId}>` : (p.nickname || dbPlayer?.nickname || 'Jogador');
                }).map(name => `> ${name}`).join('\n');

                console.log(`[Faceit Webhook] Partida live (Playing - fallback): ${matchId} | Premade: ${nicknames}`);

                const msg = await channel.send({
                    embeds: [buildPlayingEmbed(playerNames, mapName, null, [])],
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
                    premadeFaction,
                    alertsLog: []
                };

                const intervalId = startMatchPolling(client, matchId);
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

                active.score = score;
                active.won = won;
                active.demoUrl = demoUrl;

                await active.message.edit({
                    embeds: [buildFinishedEmbed(active.playerNames, active.mapName, score, won, null, active.alertsLog)],
                    components: [buildMatchButtons(active.matchUrl, demoUrl)]
                });

                // Inicia busca e atualização de estatísticas
                updateFinishedEmbedWithStats(client, matchId);

                if (demoUrl) {
                    // Dar 15 segundos para atualizar as estatísticas antes de apagar a partida da memória
                    setTimeout(() => {
                        activeMatches.delete(matchId);
                        activeMatchesAlerts.delete(matchId);
                    }, 15000);
                } else {
                    active.state = 'finished';
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
                    active.demoUrl = demoUrl;
                    await active.message.edit({
                        embeds: [buildFinishedEmbed(active.playerNames, active.mapName, active.score, active.won, active.premadeStatsText, active.alertsLog)],
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
