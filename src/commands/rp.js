const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getLeaderboard, saveLeaderboard, updateLeaderboardMessage } = require('./leaderboard.js');

const ROLE_PREMADE_ID = '1504240255296081920';
const TEU_ID_ADMIN = '408738678492364801';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rp')
        .setDescription('Comando para admins: Remove um membro da premade e da leaderboard.')
        .addUserOption(option =>
            option.setName('membro')
                .setDescription('O membro que queres remover da premade')
                .setRequired(true)),
    async execute(interaction) {
        if (interaction.user.id !== TEU_ID_ADMIN) {
            console.log(`[/rp] ACESSO NEGADO: ${interaction.user.tag} tentou usar /rp sem ser admin.`);
            return interaction.reply({ content: 'Só o admin pode remover membros da premade!', flags: 64 });
        }

        await interaction.deferReply();

        const targetUser = interaction.options.getUser('membro');
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            console.log(`[/rp] ${interaction.user.tag} tentou remover ${targetUser.tag} mas o membro não foi encontrado.`);
            return interaction.editReply({ content: 'Membro não encontrado no servidor.' });
        }

        if (!targetMember.roles.cache.has(ROLE_PREMADE_ID)) {
            console.log(`[/rp] ${interaction.user.tag} tentou remover ${targetUser.tag} mas este não está na premade.`);
            return interaction.editReply({ content: `O <@${targetUser.id}> não está na premade.` });
        }

        try {
            await targetMember.roles.remove(ROLE_PREMADE_ID);
            console.log(`[/rp] ${interaction.user.tag} removeu ${targetUser.tag} (${targetUser.id}) da premade.`);

            // Remove da leaderboard pelo discord_id
            const leaderboard = getLeaderboard();
            const index = leaderboard.findIndex(p => p.discord_id === targetUser.id);
            let removedNick = null;
            if (index !== -1) {
                removedNick = leaderboard[index].nickname;
                leaderboard.splice(index, 1);
                saveLeaderboard(leaderboard);
                console.log(`[/rp] Entrada da leaderboard removida — nick: ${removedNick} | discord_id: ${targetUser.id}`);
                await updateLeaderboardMessage(interaction.client);
            } else {
                console.log(`[/rp] ${targetUser.tag} (${targetUser.id}) não tinha entrada na leaderboard.`);
            }

            const desc = removedNick
                ? `O <@${targetUser.id}> foi removido da premade e da leaderboard.\n> Faceit removido: **${removedNick}**`
                : `O <@${targetUser.id}> foi removido da premade.\n> *Não tinha entrada na leaderboard.*`;

            const embed = new EmbedBuilder()
                .setTitle('🗑️・Membro Removido')
                .setDescription(desc)
                .setColor('#313137');

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: 'Ocorreu um erro ao tentar remover o cargo. (Talvez o Bot precise de permissões mais altas na hierarquia!)' });
        }
    },
};
