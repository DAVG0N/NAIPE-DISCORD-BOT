const express = require('express');
const { EmbedBuilder } = require('discord.js');

// Adiciona aqui os IDs dos jogadores da tua premade na Faceit
// Podes encontrar o ID na URL do perfil do jogador ou através da API da Faceit
const PREMADE_FACEIT_IDS = [
    '72c74380-ff90-4633-bae0-6fdb6d102031',
    'id_faceit_ficticio_2',
    'id_faceit_ficticio_3'
];

function setupWebhooks(client) {
    const app = express();
    app.use(express.json());

    app.post('/faceit-webhook', async (req, res) => {
        // A Faceit exige que os webhooks respondam com status 2xx o mais rápido possível
        res.status(200).send('OK');

        try {
            const { event, payload } = req.body;

            // Queremos apenas quando a partida está pronta ou começa
            if (event !== 'match_status_ready' && event !== 'match_status_playing') {
                return;
            }

            const teams = payload.teams;
            if (!teams || teams.length < 2) return;

            // Junta os rosters de ambas as equipas
            const allPlayers = [
                ...(teams[0].roster || []),
                ...(teams[1].roster || [])
            ];

            // Verifica se algum jogador na partida faz parte da nossa premade
            const premadeInMatch = allPlayers.filter(player =>
                PREMADE_FACEIT_IDS.includes(player.id) ||
                PREMADE_FACEIT_IDS.includes(player.nickname) // Fallback caso coloques o nickname em vez do ID
            );

            // Se pelo menos um membro estiver na partida, envia aviso
            if (premadeInMatch.length > 0) {
                const channelId = process.env.CANAL_AVISOS_ID;
                if (!channelId) {
                    console.error('[Faceit Webhook] ERRO: CANAL_AVISOS_ID não está configurado no ficheiro .env');
                    return;
                }

                const channel = await client.channels.fetch(channelId);
                if (!channel) {
                    console.error('[Faceit Webhook] ERRO: O canal configurado em CANAL_AVISOS_ID não foi encontrado.');
                    return;
                }

                // Extrair detalhes da partida
                const matchId = payload.id;
                // Os webhooks mais recentes da faceit têm a informação do mapa num sítio ou noutro dependendo da fase.
                // Na fase match_status_ready pode ainda não haver mapa, mas tenta recolher se existir
                const mapName = (payload.entity && payload.entity.name) ? payload.entity.name : 'Votação ou Desconhecido';
                const matchUrl = `https://www.faceit.com/en/cs2/room/${matchId}`;

                // Nomes dos membros da premade que foram encontrados
                const playerNames = premadeInMatch.map(p => p.nickname).join(', ');

                const embed = new EmbedBuilder()
                    .setTitle('🎮 Nova Partida Encontrada!')
                    .setColor('#FF5500') // Laranja característico da Faceit
                    .setDescription(`A nossa malta encontrou uma partida!\n**Jogadores em jogo:** ${playerNames}`)
                    .addFields(
                        { name: '🗺️ Mapa', value: mapName, inline: true },
                        { name: '🔗 Match Room', value: `[Clica aqui para ir para a sala](${matchUrl})`, inline: true }
                    )
                    .setTimestamp();

                await channel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('[Faceit Webhook] Ocorreu um erro ao processar o webhook:', error);
        }
    });

    // Em alojamentos Pterodactyl, é preferível usar as portas atribuídas e declaradas nas variáveis de ambiente
    const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`[Webhooks] Servidor Express a escutar Webhooks da Faceit na porta ${PORT}`);
    });
}

module.exports = { setupWebhooks };
