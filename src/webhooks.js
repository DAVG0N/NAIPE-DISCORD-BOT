const express = require('express');
const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LEADERBOARD_FILE = path.join(__dirname, '../data/bd.json');

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
            const premadeIds = getPremadeIds();
            const premadeInMatch = allPlayers.filter(player =>
                premadeIds.includes(player.id) ||
                premadeIds.includes(player.player_id)
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
                    .setTitle('🎮・Estamos a Jogar!')
                    .setColor('#313137')
                    .setDescription(`Malta de Premade está a jogar!\n### Jogadores em jogo: \n > ${playerNames}`)
                    .addFields(
                        { name: '\`🗺️\` Mapa', value: mapName, inline: true },
                        { name: '\`🔗\` Match Room', value: `[Clica aqui para ir para a sala](${matchUrl})`, inline: true }
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
