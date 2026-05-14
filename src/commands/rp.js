const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const ROLE_PREMADE_ID = '1504240255296081920';
const TEU_ID_ADMIN = '408738678492364801';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rp')
        .setDescription('Comando para admins: Remove um membro da premade.')
        .addUserOption(option =>
            option.setName('membro')
                .setDescription('O membro que queres remover da premade')
                .setRequired(true)),
    async execute(interaction) {
        // Verifica se é o admin
        if (interaction.user.id !== TEU_ID_ADMIN) {
            return interaction.reply({ content: 'Só o admin pode remover membros da premade!', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: false }); // Resposta pública ou efémera consoante queiras

        const targetUser = interaction.options.getUser('membro');
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: 'Membro não encontrado no servidor.' });
        }

        // Verifica se o membro realmente tem o cargo
        if (!targetMember.roles.cache.has(ROLE_PREMADE_ID)) {
            return interaction.editReply({ content: `O <@${targetUser.id}> não está na premade.` });
        }

        try {
            await targetMember.roles.remove(ROLE_PREMADE_ID);
            
            const embed = new EmbedBuilder()
                .setTitle('🗑️・Membro Removido')
                .setDescription(`O <@${targetUser.id}> foi removido da premade com sucesso.`)
                .setColor('#313137'); // Cor escura para seguir o teu estilo minimalista

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: 'Ocorreu um erro ao tentar remover o cargo. (Talvez o Bot precise de permissões mais altas na hierarquia!)' });
        }
    },
};
