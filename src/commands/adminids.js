const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const TEU_ID_ADMIN = '408738678492364801';
const dataFile = path.join(__dirname, '../../data/bd.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminids')
        .setDescription('Comando para admins: Mostra os IDs da Faceit de todos os membros registados na base de dados.')
        .setDMPermission(true), // Garante que o comando pode ser usado em DMs
    async execute(interaction) {
        if (interaction.user.id !== TEU_ID_ADMIN) {
            console.log(`[/adminids] ACESSO NEGADO: ${interaction.user.tag} tentou usar /adminids sem ser admin.`);
            return interaction.reply({ content: 'Só o admin pode consultar a lista de IDs!', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            if (!fs.existsSync(dataFile)) {
                return interaction.editReply({ content: '⚠️ O ficheiro de base de dados `bd.json` não existe.' });
            }

            const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

            if (data.length === 0) {
                return interaction.editReply({ content: '⚠️ Nenhum jogador registado na base de dados.' });
            }

            const embed = new EmbedBuilder()
                .setTitle('📋・Lista de IDs da Faceit')
                .setColor('#FFD700') // Dourado
                .setTimestamp();

            let description = 'Lista de todos os membros registados:\n\n';

            data.forEach((p) => {
                description += `👤 **Discord:** <@${p.discord_id}> (${p.discord_id})\n`;
                description += `🎮 **Faceit Nick:** \`${p.nickname}\`\n`;
                description += `🆔 **Faceit ID:** \`${p.player_id}\`\n\n`;
            });

            // Limitar tamanho da descrição para evitar ultrapassar o limite do Discord (4096 caracteres)
            if (description.length > 4000) {
                description = description.slice(0, 3950) + '\n\n*... e mais. A lista foi truncada devido ao limite de caracteres.*';
            }

            embed.setDescription(description);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Erro ao ler bd.json:', error);
            await interaction.editReply({ content: '❌ Ocorreu um erro ao processar o pedido.' });
        }
    },
};
