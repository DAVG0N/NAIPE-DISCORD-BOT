const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('limpardm')
        .setDescription('Comando útil para testes: O bot apaga as suas próprias mensagens na tua DM.'),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Abre (ou obtém) o canal de DM com quem usou o comando
            const dmChannel = await interaction.user.createDM();
            
            // Vai buscar as últimas 100 mensagens
            const messages = await dmChannel.messages.fetch({ limit: 100 });
            
            // Filtra apenas as mensagens enviadas pelo Bot
            const botMessages = messages.filter(m => m.author.id === interaction.client.user.id);
            
            let count = 0;
            // Apaga uma a uma (Discord não permite "bulkDelete" em DMs)
            for (const msg of botMessages.values()) {
                await msg.delete().catch(() => {});
                count++;
            }

            await interaction.editReply({ content: `✅ Limpeza concluída! Apaguei **${count}** mensagens do bot na tua DM.` });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '❌ Ocorreu um erro ao tentar limpar a tua DM.' });
        }
    },
};
