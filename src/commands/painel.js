const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('painel')
        .setDescription('Comando para admins: Cria o painel de recrutamento para a premade.'),
    async execute(interaction) {
        // Apenas para não deixar o comando a pensar eternamente caso demore
        await interaction.deferReply({ ephemeral: true });

        // Embed simples com título Recrutamento
        const embed = new EmbedBuilder()
            .setTitle('Recrutamento')
            .setDescription('Clica no botão abaixo para propor a entrada de um novo membro na premade.')
            .setColor('DarkVividPink'); // Ou a cor que preferires

        // Botão btn_propor
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('btn_propor')
                    .setLabel('Propor Novo Membro')
                    .setStyle(ButtonStyle.Primary)
            );

        // Envia para o canal onde o admin usou o comando
        await interaction.channel.send({ embeds: [embed], components: [row] });
        
        // Responde de forma efémera ao admin para fechar a interação
        await interaction.editReply({ content: 'Painel criado com sucesso neste canal!' });
    },
};
