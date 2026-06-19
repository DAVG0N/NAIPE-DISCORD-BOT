const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Mapeamento dos Níveis da Faceit para Emojis Customizados do Discord
const faceitEmojis = {
    1: '<:lvl1:1504619290442203257>',
    2: '<:lvl2:1504619315570413728>',
    3: '<:lvl3:1504619338429108254>',
    4: '<:lvl4:1504619365977423972>',
    5: '<:lvl5:1504619396864282665>',
    6: '<:lvl6:1504619430888345680>',
    7: '<:lvl7:1504619468335223065>',
    8: '<:lvl8:1504619505400418394>',
    9: '<:lvl9:1504619535146422354>',
    10: '<:lvl10:1504619565701660854>'
};

// Caminhos
const dataDir = path.join(__dirname, '../../data');
const dataFile = path.join(dataDir, 'bd.json');
const configFile = path.join(dataDir, 'leaderboard_config.json');

// Garante que a pasta e o ficheiro existem
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, JSON.stringify([]));

function getLeaderboard() {
    const data = fs.readFileSync(dataFile, 'utf-8');
    return JSON.parse(data);
}

function saveLeaderboard(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function getLeaderboardConfig() {
    if (!fs.existsSync(configFile)) return null;
    const data = fs.readFileSync(configFile, 'utf-8');
    return JSON.parse(data);
}

function saveLeaderboardConfig(channelId, messageId) {
    fs.writeFileSync(configFile, JSON.stringify({ channelId, messageId }, null, 2));
}

async function updateLeaderboardMessage(client) {
    const config = getLeaderboardConfig();
    if (!config || !config.channelId || !config.messageId) return;

    const apiKey = process.env.FACEIT_API_KEY;
    if (!apiKey) return;

    try {
        const channel = await client.channels.fetch(config.channelId);
        if (!channel) return;
        const message = await channel.messages.fetch(config.messageId);
        if (!message) return;

        // Feedback visual de "A atualizar..."
        const originalEmbed = message.embeds[0];
        if (originalEmbed) {
            const tempEmbed = EmbedBuilder.from(originalEmbed)
                .setFooter({ text: 'A atualizar Faceit... ⏳' });
            await message.edit({ embeds: [tempEmbed] });
        }

        const leaderboard = getLeaderboard();
        
        if (leaderboard.length === 0) {
            const embed = new EmbedBuilder()
                .setTitle('🏆 ・Leaderboard ')
                .setColor('#FF5500')
                .setDescription('Ranking da malta da Premade ♥️♣️♦️♠️\n\n*Nenhum jogador registado.*')
                .setTimestamp()
                .setFooter({ text: 'Ultimo Update' });
            await message.edit({ embeds: [embed] });
            return;
        }

        const playersData = [];
        for (const player of leaderboard) {
            try {
                // Detalhes base
                const detailsRes = await fetch(`https://open.faceit.com/data/v4/players/${player.player_id}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
                const details = await detailsRes.json();
                const elo = details.games?.cs2?.faceit_elo || 0;
                const level = details.games?.cs2?.skill_level || 1;

                // Estatísticas
                const statsRes = await fetch(`https://open.faceit.com/data/v4/players/${player.player_id}/stats/cs2`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
                const stats = await statsRes.json();
                const kd = stats.lifetime?.['Average K/D Ratio'] || 'N/A';

                // Histórico
                const historyRes = await fetch(`https://open.faceit.com/data/v4/players/${player.player_id}/history?game=cs2&offset=0&limit=10`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
                const history = await historyRes.json();
                
                let historyEmojis = '';
                let streakSuffix = '';
                let faceitRating = 'N/A';
                if (history && history.items && history.items.length > 0) {
                    const results = history.items.map(match => {
                        const faction1Ids = match.teams.faction1.players.map(p => p.player_id);
                        const playerFaction = faction1Ids.includes(player.player_id) ? 'faction1' : 'faction2';
                        return (match.results && match.results.winner === playerFaction) ? 'W' : 'L';
                    });

                    // Calcular streak atual (a partir do jogo mais recente)
                    const firstResult = results[0];
                    let streakCount = 0;
                    for (const r of results) {
                        if (r === firstResult) streakCount++;
                        else break;
                    }

                    if (streakCount >= 5) {
                        streakSuffix = firstResult === 'W' ? `🔥${streakCount}` : `⚰️${streakCount}`;
                    }

                    // Mostrar apenas os últimos 5 círculos
                    for (const r of results.slice(0, 5)) {
                        historyEmojis += r === 'W' ? '🟢' : '🔴';
                    }

                    // Obter as estatísticas da partida mais recente para extrair o Rating
                    const latestMatchId = history.items[0].match_id;
                    try {
                        const matchStatsResponse = await fetch(`https://open.faceit.com/data/v4/matches/${latestMatchId}/stats`, {
                            headers: { 'Authorization': `Bearer ${apiKey}` }
                        });
                        if (matchStatsResponse.ok) {
                            const matchStatsData = await matchStatsResponse.json();
                            if (matchStatsData.rounds && matchStatsData.rounds[0] && matchStatsData.rounds[0].teams) {
                                let foundRating = null;
                                for (const team of matchStatsData.rounds[0].teams) {
                                    if (team.players) {
                                        const p = team.players.find(pl => pl.player_id === player.player_id);
                                        if (p && p.player_stats) {
                                            foundRating = p.player_stats['FACEIT Rating'] || p.player_stats['Match Rating'] || p.player_stats['rating'];
                                            break;
                                        }
                                    }
                                }
                                if (foundRating) {
                                    faceitRating = foundRating;
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Erro ao obter rating da partida para ${player.nickname}:`, err);
                    }
                }
                if (!historyEmojis) historyEmojis = 'Sem dados';

                playersData.push({ nickname: player.nickname, elo: elo, level: level, kd: kd, rating: faceitRating, history: historyEmojis, streakSuffix });
            } catch (err) {
                console.error(`Erro ao buscar dados para ${player.nickname}:`, err);
                playersData.push({ nickname: player.nickname, elo: 'Erro', level: '?', kd: 'Erro', rating: 'Erro', history: 'Erro' });
            }
        }

        playersData.sort((a, b) => {
            if (typeof a.elo === 'number' && typeof b.elo === 'number') return b.elo - a.elo;
            return 0;
        });

        const embed = new EmbedBuilder()
            .setTitle('🏆 ・Leaderboard ')
            .setColor('#FF5500')
            .setDescription('Ranking da malta da Premade ♥️♣️♦️♠️')
            .setTimestamp()
            .setFooter({ text: 'Ultimo Update' });

        playersData.forEach((p, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
            const emojiNivel = faceitEmojis[p.level] || `Lvl ${p.level}`;
            embed.addFields({
                name: `\n`,
                value: `${medal} ${emojiNivel} **${p.nickname}** - \`${p.elo}\` | Rating: \`${p.rating}\` K/D: \`${p.kd}\` \`${p.history}\` ${p.streakSuffix ? ` \`${p.streakSuffix}\`` : ''}`,
                inline: false
            });
        });

        await message.edit({ embeds: [embed] });
    } catch (e) {
        console.error("Erro a atualizar leaderboard message:", e);
    }
}

module.exports = {
    getLeaderboard,
    saveLeaderboard,
    updateLeaderboardMessage,
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Gere e mostra a leaderboard de jogadores de CS2 na Faceit.')
        .addSubcommand(subcommand =>
            subcommand.setName('adicionar').setDescription('Adiciona um jogador à leaderboard.')
                .addStringOption(option => option.setName('nick').setDescription('Nickname na Faceit').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand.setName('remover').setDescription('Remove um jogador da leaderboard.')
                .addStringOption(option => option.setName('nick').setDescription('Nickname na leaderboard').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand.setName('mostrar').setDescription('Cria a mensagem âncora da leaderboard no canal atual.')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('forcereload').setDescription('Força o recarregamento da leaderboard no canal configurado, recriando a mensagem.')
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const apiKey = process.env.FACEIT_API_KEY;

        if (!apiKey) return interaction.reply({ content: '❌ **Erro**: A chave de API da FACEIT não está configurada.', flags: 64 });

        if (subcommand === 'adicionar') {
            await interaction.deferReply({ flags: 64 });
            const nick = interaction.options.getString('nick');
            const leaderboard = getLeaderboard();

            if (leaderboard.find(p => p.nickname.toLowerCase() === nick.toLowerCase())) {
                return interaction.editReply(`⚠️ O jogador **${nick}** já está na leaderboard.`);
            }

            try {
                const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${nick}`, { headers: { 'Authorization': `Bearer ${apiKey}` } });

                if (playerResponse.status === 404) return interaction.editReply(`❌ Não foi possível encontrar o jogador **${nick}** na Faceit.`);
                if (!playerResponse.ok) return interaction.editReply(`❌ Erro da API da Faceit (Status: ${playerResponse.status}).`);

                const playerData = await playerResponse.json();
                if (!playerData.games?.cs2) return interaction.editReply(`❌ O jogador **${nick}** não tem perfil de CS2 registado.`);

                leaderboard.push({ nickname: playerData.nickname, player_id: playerData.player_id });
                saveLeaderboard(leaderboard);

                await interaction.editReply(`✅ O jogador **${playerData.nickname}** foi adicionado à leaderboard!`);
                
                // Atualizar a mensagem âncora
                await updateLeaderboardMessage(interaction.client);
            } catch (error) {
                console.error(error);
                await interaction.editReply('❌ Ocorreu um erro ao adicionar o jogador.');
            }
        } 
        else if (subcommand === 'remover') {
            const nick = interaction.options.getString('nick');
            const leaderboard = getLeaderboard();
            
            const index = leaderboard.findIndex(p => p.nickname.toLowerCase() === nick.toLowerCase());
            if (index === -1) return interaction.reply({ content: `⚠️ O jogador **${nick}** não está na leaderboard.`, flags: 64 });

            const entry = leaderboard[index];
            leaderboard.splice(index, 1);
            saveLeaderboard(leaderboard);
            console.log(`[Leaderboard] Removido via /leaderboard remover — nick: ${entry.nickname} | discord_id: ${entry.discord_id || 'sem discord_id'}`);

            let cargoRemovido = false;
            if (entry.discord_id) {
                try {
                    const member = await interaction.guild.members.fetch(entry.discord_id).catch(() => null);
                    if (member && member.roles.cache.has('1504240255296081920')) {
                        await member.roles.remove('1504240255296081920');
                        cargoRemovido = true;
                        console.log(`[Leaderboard] Cargo de premade removido a <@${entry.discord_id}> ao remover ${entry.nickname} da leaderboard.`);
                    }
                } catch (e) {
                    console.error(`Erro a remover cargo de premade ao remover ${nick} da leaderboard:`, e);
                }
            }

            const msg = cargoRemovido
                ? `🗑️ O jogador **${nick}** foi removido da leaderboard e o cargo de premade foi retirado a <@${entry.discord_id}>.`
                : `🗑️ O jogador **${nick}** foi removido da leaderboard.${entry.discord_id ? ' *(Cargo não encontrado ou já não tinha)*' : ''}`;

            await interaction.reply({ content: msg, flags: 64 });
            
            await updateLeaderboardMessage(interaction.client);
        } 
        else if (subcommand === 'mostrar') {
            await interaction.deferReply({ flags: 64 });
            
            const initEmbed = new EmbedBuilder()
                .setTitle('🏆 ・Leaderboard ')
                .setColor('#FF5500')
                .setDescription('A preparar a Leaderboard... ⏳')
                .setTimestamp();
                
            const anchorMessage = await interaction.channel.send({ embeds: [initEmbed] });
            saveLeaderboardConfig(interaction.channel.id, anchorMessage.id);
            
            await interaction.editReply('✅ Mensagem âncora criada! A carregar os dados...');
            
            // Forçar primeira atualização imediatamente
            await updateLeaderboardMessage(interaction.client);
        }
        else if (subcommand === 'forcereload') {
            await interaction.deferReply({ flags: 64 });
            
            const config = getLeaderboardConfig();
            if (!config || !config.channelId) {
                return interaction.editReply('❌ **Erro**: O canal da leaderboard ainda não foi configurado. Usa `/leaderboard mostrar` no canal pretendido primeiro.');
            }

            try {
                const channel = await interaction.client.channels.fetch(config.channelId);
                if (!channel) {
                    return interaction.editReply('❌ **Erro**: Não consegui encontrar o canal configurado. Foi apagado? Usa `/leaderboard mostrar` num novo canal.');
                }

                const initEmbed = new EmbedBuilder()
                    .setTitle('🏆 ・Leaderboard ')
                    .setColor('#FF5500')
                    .setDescription('A recriar a Leaderboard... ⏳')
                    .setTimestamp();
                    
                const anchorMessage = await channel.send({ embeds: [initEmbed] });
                
                // Guardar nova mensagem âncora
                saveLeaderboardConfig(channel.id, anchorMessage.id);
                
                await interaction.editReply(`✅ Mensagem recriada com sucesso no canal <#${channel.id}>! A atualizar os dados...`);
                
                await updateLeaderboardMessage(interaction.client);
            } catch (error) {
                console.error("Erro no forcereload:", error);
                await interaction.editReply('❌ Ocorreu um erro ao forçar o recarregamento da leaderboard.');
            }
        }
    },
};
