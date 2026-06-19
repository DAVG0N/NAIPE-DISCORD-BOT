const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../../data/bd.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Procura as estatísticas de um jogador da premade no CS2 na Faceit.')
        .addUserOption(option =>
            option.setName('membro')
                .setDescription('O membro do Discord para ver as estatísticas')
                .setRequired(true)
        ),
    async execute(interaction) {
        // Envia um estado de carregamento "O bot está a pensar..."
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('membro');
        const discordId = targetUser.id;
        const apiKey = process.env.FACEIT_API_KEY;

        if (!apiKey) {
            return interaction.editReply('❌ **Erro**: A chave de API da FACEIT não está configurada.');
        }

        // 1. Procurar o jogador no bd.json
        let playerEntry = null;
        try {
            if (fs.existsSync(dataFile)) {
                const leaderboard = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
                playerEntry = leaderboard.find(p => p.discord_id === discordId);
            }
        } catch (e) {
            console.error('Erro a ler bd.json no stats:', e);
        }

        if (!playerEntry) {
            return interaction.editReply(`❌ O utilizador <@${discordId}> não está associado à premade ou não registou a sua conta Faceit.`);
        }

        const playerId = playerEntry.player_id;

        try {
            // 2. Procurar os dados base do jogador pelo player_id
            const playerResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (playerResponse.status === 404) {
                return interaction.editReply(`❌ Não foi possível encontrar o perfil do jogador na Faceit.`);
            }

            if (!playerResponse.ok) {
                return interaction.editReply(`❌ Ocorreu um erro ao comunicar com a Faceit (Status: ${playerResponse.status}).`);
            }

            const playerData = await playerResponse.json();

            // Extrair os dados associados ao CS2
            const cs2Data = playerData.games?.cs2;

            if (!cs2Data) {
                return interaction.editReply(`❌ O jogador **${playerData.nickname}** não tem perfil de CS2 registado na Faceit.`);
            }

            const skillLevel = cs2Data.skill_level;
            const elo = cs2Data.faceit_elo;

            // 3. Pedir as estatísticas detalhadas de CS2
            const statsResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (!statsResponse.ok) {
                return interaction.editReply(`❌ Não foi possível obter as estatísticas de CS2 para o jogador **${playerData.nickname}**.`);
            }

            const statsData = await statsResponse.json();
            
            // Extrair métricas específicas (K/D Médio e % de Headshots) do objeto "lifetime"
            const lifetime = statsData.lifetime;
            const averageKd = lifetime['Average K/D Ratio'];
            const averageHs = lifetime['Average Headshots %'];

            // 4. Obter o histórico de partidas para extrair o match_id do jogo mais recente
            const historyResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/history?game=cs2&offset=0&limit=1`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            let faceitRating = 'N/A';
            if (historyResponse.ok) {
                const historyData = await historyResponse.json();
                if (historyData.items && historyData.items.length > 0) {
                    const latestMatchId = historyData.items[0].match_id;

                    // 5. Obter as estatísticas da partida mais recente
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
                                        const p = team.players.find(pl => pl.player_id === playerId);
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
                        console.error('Erro ao obter rating da partida:', err);
                    }
                }
            }

            // Formatar a resposta visual sem embeds (com emojis como pedido)
            const replyMessage = 
                `📊 **Estatísticas de CS2 na FACEIT**\n\n` +
                `👤 **Jogador:** <@${discordId}>\n` +
                `🎮 **Faceit Nick:** ${playerData.nickname}\n` +
                `⭐ **Nível:** ${skillLevel}\n` +
                `📈 **ELO:** ${elo}\n` +
                `🔫 **K/D Médio:** ${averageKd}\n` +
                `🎯 **Headshots (%):** ${averageHs}%\n` +
                `⭐ **Rating Recente:** ${faceitRating}`;

            await interaction.editReply(replyMessage);

        } catch (error) {
            console.error('Erro no comando stats:', error);
            await interaction.editReply('❌ Ocorreu um erro inesperado ao processar o teu pedido.');
        }
    },
};
