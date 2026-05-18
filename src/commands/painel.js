const { SlashCommandBuilder, ActionRowBuilder, UserSelectMenuBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('painel')
        .setDescription('Comando para admins: Cria o painel de recrutamento para a premade.'),
    async execute(interaction) {
        // Apenas para não deixar o comando a pensar eternamente caso demore
        await interaction.deferReply({ flags: 64 });

        // Embed simples com título Recrutamento
        const embed = new EmbedBuilder()
            .setTitle('🙍・𝖠𝖽𝗂𝖼𝗂𝗈𝗇𝖺𝗋 𝖯𝖾𝗌𝗌𝗈𝖺𝗅')
            .setDescription('### Propõe a entrada de um novo jogador na premade.\n ・Basta selecionares a pessoa no menu abaixo!\n ・70% da Premade tem de estar de acordo!')
            .setColor('#313137'); // Ou a cor que preferires

        // Menu Select de Utilizadores
        const row = new ActionRowBuilder()
            .addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId('select_candidato')
                    .setPlaceholder('Seleciona o membro a propor...')
            );

        // Envia para o canal onde o admin usou o comando
        await interaction.channel.send({ embeds: [embed], components: [row] });

        // Responde de forma efémera ao admin para fechar a interação
        await interaction.editReply({ content: 'Painel criado com sucesso neste canal!' });
    },
};
