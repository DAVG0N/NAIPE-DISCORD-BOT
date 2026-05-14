const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Procura as estatísticas de um jogador de CS2 na Faceit.')
        .addStringOption(option =>
            option.setName('nick')
                .setDescription('O nickname do jogador na Faceit')
                .setRequired(true)
        ),
    async execute(interaction) {
        // Envia um estado de carregamento "O bot está a pensar..."
        await interaction.deferReply();

        const nick = interaction.options.getString('nick');
        const apiKey = process.env.FACEIT_API_KEY;

        if (!apiKey) {
            return interaction.editReply('❌ **Erro**: A chave de API da FACEIT não está configurada.');
        }

        try {
            // 1. Procurar os dados base do jogador
            const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${nick}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (playerResponse.status === 404) {
                return interaction.editReply(`❌ Não foi possível encontrar o jogador **${nick}** na Faceit.`);
            }

            if (!playerResponse.ok) {
                return interaction.editReply(`❌ Ocorreu um erro ao comunicar com a Faceit (Status: ${playerResponse.status}).`);
            }

            const playerData = await playerResponse.json();

            // Extrair os dados associados ao CS2
            const playerId = playerData.player_id;
            const cs2Data = playerData.games?.cs2;

            if (!cs2Data) {
                return interaction.editReply(`❌ O jogador **${nick}** não tem perfil de CS2 registado na Faceit.`);
            }

            const skillLevel = cs2Data.skill_level;
            const elo = cs2Data.faceit_elo;

            // 2. Pedir as estatísticas detalhadas de CS2
            const statsResponse = await fetch(`https://open.faceit.com/data/v4/players/${playerId}/stats/cs2`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });

            if (!statsResponse.ok) {
                return interaction.editReply(`❌ Não foi possível obter as estatísticas de CS2 para o jogador **${nick}**.`);
            }

            const statsData = await statsResponse.json();
            
            // Extrair métricas específicas (K/D Médio e % de Headshots) do objeto "lifetime"
            const lifetime = statsData.lifetime;
            const averageKd = lifetime['Average K/D Ratio'];
            const averageHs = lifetime['Average Headshots %'];

            // Formatar a resposta visual sem embeds (com emojis como pedido)
            const replyMessage = 
                `📊 **Estatísticas de CS2 na FACEIT**\n\n` +
                `👤 **Nickname:** ${playerData.nickname}\n` +
                `⭐ **Nível:** ${skillLevel}\n` +
                `📈 **ELO:** ${elo}\n` +
                `🔫 **K/D Médio:** ${averageKd}\n` +
                `🎯 **Headshots (%):** ${averageHs}%`;

            await interaction.editReply(replyMessage);

        } catch (error) {
            console.error('Erro no comando stats:', error);
            await interaction.editReply('❌ Ocorreu um erro inesperado ao processar o teu pedido.');
        }
    },
};
