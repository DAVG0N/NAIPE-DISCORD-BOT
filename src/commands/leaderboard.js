const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Mapeamento dos Níveis da Faceit para Emojis Customizados do Discord
// O formato de um emoji custom é '<:nome_do_emoji:ID_DO_EMOJI>'
// Terás de colocar aqui os IDs reais dos emojis que tiveres no teu servidor!
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

// Caminho para o ficheiro JSON
const dataDir = path.join(__dirname, '../../data');
const dataFile = path.join(dataDir, 'leaderboard.json');

// Garante que a pasta e o ficheiro existem
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify([]));
}

// Funções auxiliares para ler/escrever no JSON
function getLeaderboard() {
    const data = fs.readFileSync(dataFile, 'utf-8');
    return JSON.parse(data);
}

function saveLeaderboard(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

module.exports = {
    getLeaderboard,
    saveLeaderboard,
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Gere e mostra a leaderboard de jogadores de CS2 na Faceit.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('adicionar')
                .setDescription('Adiciona um jogador à leaderboard.')
                .addStringOption(option =>
                    option.setName('nick')
                        .setDescription('Nickname do jogador na Faceit')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remover')
                .setDescription('Remove um jogador da leaderboard.')
                .addStringOption(option =>
                    option.setName('nick')
                        .setDescription('Nickname do jogador na leaderboard')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('mostrar')
                .setDescription('Envia a leaderboard atualizada para o canal.')
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const apiKey = process.env.FACEIT_API_KEY;

        if (!apiKey) {
            return interaction.reply({ content: '❌ **Erro**: A chave de API da FACEIT não está configurada.', ephemeral: true });
        }

        if (subcommand === 'adicionar') {
            await interaction.deferReply({ ephemeral: true });
            const nick = interaction.options.getString('nick');
            const leaderboard = getLeaderboard();

            // Verificar se já existe
            if (leaderboard.find(p => p.nickname.toLowerCase() === nick.toLowerCase())) {
                return interaction.editReply(`⚠️ O jogador **${nick}** já está na leaderboard.`);
            }

            try {
                // Verificar na Faceit e obter o player_id
                const playerResponse = await fetch(`https://open.faceit.com/data/v4/players?nickname=${nick}`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });

                if (playerResponse.status === 404) {
                    return interaction.editReply(`❌ Não foi possível encontrar o jogador **${nick}** na Faceit.`);
                }
                if (!playerResponse.ok) {
                    return interaction.editReply(`❌ Erro da API da Faceit (Status: ${playerResponse.status}).`);
                }

                const playerData = await playerResponse.json();

                if (!playerData.games?.cs2) {
                    return interaction.editReply(`❌ O jogador **${nick}** não tem perfil de CS2 registado.`);
                }

                // Guardar no JSON
                leaderboard.push({
                    nickname: playerData.nickname,
                    player_id: playerData.player_id
                });
                saveLeaderboard(leaderboard);

                await interaction.editReply(`✅ O jogador **${playerData.nickname}** foi adicionado à leaderboard!`);

            } catch (error) {
                console.error(error);
                await interaction.editReply('❌ Ocorreu um erro ao adicionar o jogador.');
            }
        }
        else if (subcommand === 'remover') {
            const nick = interaction.options.getString('nick');
            const leaderboard = getLeaderboard();

            const index = leaderboard.findIndex(p => p.nickname.toLowerCase() === nick.toLowerCase());
            if (index === -1) {
                return interaction.reply({ content: `⚠️ O jogador **${nick}** não está na leaderboard.`, ephemeral: true });
            }

            leaderboard.splice(index, 1);
            saveLeaderboard(leaderboard);

            await interaction.reply({ content: `🗑️ O jogador **${nick}** foi removido da leaderboard.`, ephemeral: true });
        }
        else if (subcommand === 'mostrar') {
            await interaction.deferReply({ ephemeral: true });
            const leaderboard = getLeaderboard();

            if (leaderboard.length === 0) {
                return interaction.editReply('⚠️ A leaderboard está vazia. Usa `/leaderboard adicionar` para colocar jogadores.');
            }

            await interaction.editReply('A gerar a leaderboard, isto pode demorar uns segundos...');

            const playersData = [];

            // Buscar os dados de cada jogador
            for (const player of leaderboard) {
                try {
                    // Detalhes base (ELO, Nível)
                    const detailsRes = await fetch(`https://open.faceit.com/data/v4/players/${player.player_id}`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    const details = await detailsRes.json();
                    const elo = details.games?.cs2?.faceit_elo || 0;
                    const level = details.games?.cs2?.skill_level || 1;

                    // Estatísticas (K/D)
                    const statsRes = await fetch(`https://open.faceit.com/data/v4/players/${player.player_id}/stats/cs2`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    const stats = await statsRes.json();
                    const kd = stats.lifetime?.['Average K/D Ratio'] || 'N/A';

                    // Histórico (Últimas 5 partidas) para calcular W/L
                    const historyRes = await fetch(`https://open.faceit.com/data/v4/players/${player.player_id}/history?game=cs2&offset=0&limit=5`, {
                        headers: { 'Authorization': `Bearer ${apiKey}` }
                    });
                    const history = await historyRes.json();

                    let historyEmojis = '';
                    if (history && history.items) {
                        for (const match of history.items) {
                            // Para cada match, vemos a equipa do jogador e se essa equipa venceu
                            const faction1Ids = match.teams.faction1.players.map(p => p.player_id);
                            const playerFaction = faction1Ids.includes(player.player_id) ? 'faction1' : 'faction2';

                            if (match.results && match.results.winner === playerFaction) {
                                historyEmojis += '🟢'; // Vitória
                            } else {
                                historyEmojis += '🔴'; // Derrota
                            }
                        }
                    }
                    if (!historyEmojis) historyEmojis = 'Sem dados';

                    playersData.push({
                        nickname: player.nickname,
                        elo: elo,
                        level: level,
                        kd: kd,
                        history: historyEmojis,
                    });
                } catch (err) {
                    console.error(`Erro ao buscar dados para ${player.nickname}:`, err);
                    playersData.push({
                        nickname: player.nickname,
                        elo: 'Erro',
                        level: '?',
                        kd: 'Erro',
                        history: 'Erro'
                    });
                }
            }

            // Ordenar por ELO decrescente
            playersData.sort((a, b) => {
                if (typeof a.elo === 'number' && typeof b.elo === 'number') {
                    return b.elo - a.elo;
                }
                return 0;
            });

            // Criar o Embed
            const embed = new EmbedBuilder()
                .setTitle('🏆 ・Leaderboard ')
                .setColor('#FF5500') // Laranja característico da Faceit
                .setDescription('Ranking da malta da Premade ♥️♣️♦️♠️')
                .setTimestamp()
                .setFooter({ text: 'Ultimo Update' });

            playersData.forEach((p, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                const emojiNivel = faceitEmojis[p.level] || `Lvl ${p.level}`;

                embed.addFields({
                    name: `\n`,
                    value: `${medal} ${emojiNivel} **${p.nickname}** - \`${p.elo}\` | Rating: \`N/A\` K/D: \`${p.kd}\` \`${p.history}\``,
                    inline: false
                });
            });

            // Enviar para o canal
            await interaction.channel.send({ embeds: [embed] });

            // Apagar ou atualizar a mensagem efémera
            await interaction.editReply('✅ Leaderboard enviada com sucesso para o canal!');
        }
    },
};
