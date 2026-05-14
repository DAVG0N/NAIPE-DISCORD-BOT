const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recrutamento')
        .setDescription('Inicia um processo de votação para aceitar um novo membro na premade.'),
    
    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle('🎫 Proposta de Recrutamento')
            .setDescription('Clica no botão abaixo para propor um novo candidato para a premade.');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_propor')
                    .setLabel('Propor Candidato')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('➕')
            );

        await interaction.reply({ embeds: [embed], components: [row] });
    },
};
